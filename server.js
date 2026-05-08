const express = require('express');
const cors = require('cors');
const path = require('path');
const { findUser, getUsers, getActiveUsers, getReports, getReport, addReport, updateReport, pool } = require('./database');

const app = express();
const PORT = parseInt(process.env.PORT) || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 简易 session 存储
const sessions = {};

function genToken() {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

function auth(req, res, next) {
  const token = req.headers['authorization'];
  if (!token || !sessions[token]) {
    return res.status(401).json({ error: '请先登录' });
  }
  req.user = sessions[token];
  next();
}

function requireAdmin(req, res, next) {
  const token = req.headers['authorization'];
  if (!token || !sessions[token]) {
    return res.status(401).json({ error: '请先登录' });
  }
  const user = sessions[token];
  if (!user.isAdmin) {
    return res.status(403).json({ error: '需要管理员权限' });
  }
  req.user = user;
  next();
}

// 健康检查端点（Railway 必需）
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// ========== API 接口 ==========

// 登录
app.post('/api/login', async (req, res) => {
  const { name, password } = req.body;
  if (!name || !password) {
    return res.status(400).json({ error: '请填写姓名和密码' });
  }
  const result = await findUser(name, password);
  if (result.rows.length === 0) {
    return res.status(401).json({ error: '姓名或密码错误' });
  }
  const user = result.rows[0];
  const token = genToken();
  sessions[token] = { id: user.id, name: user.name, isAdmin: user.isAdmin };
  res.json({ token, user: { id: user.id, name: user.name, isAdmin: user.isAdmin } });
});

// 获取当前用户信息
app.get('/api/me', auth, (req, res) => {
  res.json({ user: req.user });
});

// 注册新成员（仅管理员可操作）
app.post('/api/register', requireAdmin, async (req, res) => {
  const { name, password } = req.body;
  if (!name || !password) {
    return res.status(400).json({ error: '姓名和密码不能为空' });
  }
  const result = await pool.query(
    'INSERT INTO users (name, password, active, is_admin) VALUES ($1,$2,1,FALSE) RETURNING id',
    [name.trim(), password.trim()]
  );
  res.json({ success: true, id: result.rows[0].id });
});

// 提交日报
app.post('/api/report', auth, async (req, res) => {
  const { mileage, content } = req.body;
  if (!mileage || !mileage.trim()) {
    return res.status(400).json({ error: '请填写明日工作里程' });
  }
  if (!content || !content.trim()) {
    return res.status(400).json({ error: '请填写明日工作内容' });
  }
  const today = new Date().toISOString().slice(0, 10);
  const now = new Date().toLocaleString('zh-CN', { hour12: false });

  const existing = await getReport(req.user.id, today);
  if (existing.rows.length > 0) {
    return res.status(400).json({ error: '今天已经提交过了' });
  }

  await addReport({
    user_id: req.user.id,
    date: today,
    mileage: mileage.trim(),
    content: content.trim(),
    submitted_at: now
  });
  res.json({ success: true, message: '提交成功' });
});

// 查询今日是否已提交
app.get('/api/report/today', auth, async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const result = await getReport(req.user.id, today);
  const row = result.rows[0] || null;
  res.json({ submitted: !!row, report: row });
});

// 修改今日已提交的日报
app.put('/api/report', auth, async (req, res) => {
  const { mileage, content } = req.body;
  if (!mileage || !mileage.trim()) {
    return res.status(400).json({ error: '请填写明日工作里程' });
  }
  if (!content || !content.trim()) {
    return res.status(400).json({ error: '请填写明日工作内容' });
  }
  const today = new Date().toISOString().slice(0, 10);
  const now = new Date().toLocaleString('zh-CN', { hour12: false });

  const existing = await getReport(req.user.id, today);
  if (existing.rows.length === 0) {
    return res.status(400).json({ error: '今日尚未提交，无法修改' });
  }

  await updateReport(req.user.id, today, mileage.trim(), content.trim(), now + ' (已修改)');
  res.json({ success: true, message: '修改成功' });
});

// 获取汇总
app.get('/api/reports/summary', auth, async (req, res) => {
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const currentHour = now.getHours();
  const afterDeadline = (date === todayStr && currentHour >= 18) || (date < todayStr);

  const usersResult = await getActiveUsers();
  const reportsResult = await getReports();

  const users = usersResult.rows.filter(u => !u.isAdmin);
  const reports = reportsResult.rows.filter(r => r.date === date);

  const reportMap = {};
  reports.forEach(r => { reportMap[r.user_id] = r; });

  const result = users.map(m => {
    const r = reportMap[m.id];
    return {
      id: m.id,
      name: m.name,
      submitted: !!r,
      mileage: r ? r.mileage : null,
      content: r ? r.content : null,
      submitted_at: r ? r.submitted_at : null,
      status: (!r && afterDeadline) ? '未完成' : (r ? '已完成' : '待提交')
    };
  });

  res.json({ date, afterDeadline, members: result });
});

// 获取所有成员（登录页下拉框用，无需鉴权）
app.get('/api/members', async (req, res) => {
  const result = await getUsers();
  res.json({ members: result.rows });
});

// 添加新成员（仅管理员）
app.post('/api/members', requireAdmin, async (req, res) => {
  const { name, password } = req.body;
  if (!name || !password) {
    return res.status(400).json({ error: '姓名和密码不能为空' });
  }
  const result = await pool.query(
    'INSERT INTO users (name, password, active, is_admin) VALUES ($1,$2,1,FALSE) RETURNING id',
    [name.trim(), password.trim()]
  );
  res.json({ success: true, id: result.rows[0].id });
});

// 切换成员状态（仅管理员）
app.put('/api/members/:id/toggle', requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id);
  const exist = await pool.query('SELECT id, active FROM users WHERE id = $1', [id]);
  if (exist.rows.length === 0) return res.status(404).json({ error: '成员不存在' });
  const newActive = exist.rows[0].active ? 0 : 1;
  await pool.query('UPDATE users SET active = $1 WHERE id = $2', [newActive, id]);
  res.json({ success: true, active: newActive });
});

// 免登录汇总查询（供自动化任务调用，需要 serviceKey）
const SERVICE_KEY = process.env.SERVICE_KEY || 'daily-report-secret-key';
app.get('/api/public/summary', async (req, res) => {
  const key = req.query.key;
  if (key !== SERVICE_KEY) {
    return res.status(403).json({ error: '无效密钥' });
  }
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const currentHour = now.getHours();
  const afterDeadline = (date === todayStr && currentHour >= 18) || (date < todayStr);

  const usersResult = await getActiveUsers();
  const reportsResult = await getReports();

  const users = usersResult.rows.filter(u => !u.isAdmin);
  const reports = reportsResult.rows.filter(r => r.date === date);
  const reportMap = {};
  reports.forEach(r => { reportMap[r.user_id] = r; });

  const unsubmitted = users.filter(m => !reportMap[m.id]).map(m => m.name);
  const submitted = users.filter(m => !!reportMap[m.id]).map(m => m.name);

  res.json({
    date,
    afterDeadline,
    total: users.length,
    submitted: submitted,
    unsubmitted: unsubmitted,
    submitted_count: submitted.length,
    unsubmitted_count: unsubmitted.length
  });
});

// 登出
app.post('/api/logout', (req, res) => {
  const token = req.headers['authorization'];
  if (token) delete sessions[token];
  res.json({ success: true });
});

// 启动
app.listen(PORT, '0.0.0.0', () => {
  console.log(`日报提交网站已启动：http://0.0.0.0:${PORT}`);
  console.log(`本地访问：http://localhost:${PORT}`);
});
