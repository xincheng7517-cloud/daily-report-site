const { Pool } = require('pg');
const dns = require('dns');
const { promisify } = require('util');
const net = require('net');
const fs = require('fs');
const path = require('path');

const USERS_FILE = path.join(__dirname, 'users.json');
const REPORTS_FILE = path.join(__dirname, 'reports.json');

const lookup = promisify(dns.lookup);

// Railway 连接策略：
// 1. Railway 公网代理（DATABASE_PUBLIC_URL）：sslmode=require，最可靠
// 2. Railway 内部 DNS（postgres.railway.internal）：sslmode=prefer
// 3. 本地开发：DATABASE_PUBLIC_URL + SSL

const pgHost = process.env.PGHOST || 'postgres.railway.internal';
const pgPassword = process.env.PGPASSWORD;
const pgUser = process.env.PGUSER || 'postgres';
const pgDatabase = process.env.PGDATABASE || 'railway';
const mainUrl = process.env.DATABASE_URL;
const publicUrl = process.env.DATABASE_PUBLIC_URL;

console.log('[DB] 检测环境变量:');
console.log('   PGHOST:', pgHost);
console.log('   PGPASSWORD:', pgPassword ? '有 ✓' : '无 ✗（密码在 DATABASE_URL 中）');
console.log('   DATABASE_URL:', mainUrl ? '有 ✓' : '无 ✗');
console.log('   DATABASE_PUBLIC_URL:', publicUrl ? '有 ✓' : '无 ✗');
if (publicUrl) {
  try {
    const u = new URL(publicUrl);
    console.log('   DATABASE_PUBLIC_URL 解析: host=' + u.hostname + ', user=' + u.username + ', db=' + u.pathname.replace(/^\//,''));
  } catch(e) { console.log('   DATABASE_PUBLIC_URL 解析失败:', e.message); }
}

// 解析 DATABASE_URL 的各部分
function parseDatabaseUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    return {
      hostname: u.hostname,
      port: parseInt(u.port) || 5432,
      user: u.username,
      password: u.password,
      database: u.pathname.replace(/^\//, '') || 'railway',
    };
  } catch (e) {
    return null;
  }
}

// 解析 mainUrl
const parsedMain = mainUrl ? parseDatabaseUrl(mainUrl) : null;
const parsedPublic = publicUrl ? parseDatabaseUrl(publicUrl) : null;

// Railway 公网代理格式: turntable.proxy.rlwy.net:31704
// 来自 DATABASE_PUBLIC_URL 的 pg 连接串格式: postgresql://user:pass@host:port/db
// 如果有公网 URL，优先用公网代理方式连接（SSL 可靠）
// Railway 的公网代理通过 HTTPS/WebSocket 转发，更稳定

let pool = null;
let useFallback = false;
let fallbackUsers = [];
let fallbackReports = [];

// 加载 JSON 备份文件
function loadFallbackFiles() {
  console.log(`[DB][Fallback] 加载文件: ${USERS_FILE}`);
  try {
    fallbackUsers = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    console.log(`[DB][Fallback] users.json 加载成功: ${fallbackUsers.length} 个用户`);
  } catch (e) {
    console.error(`[DB][Fallback] users.json 加载失败: ${e.message}`);
    fallbackUsers = [];
  }
  console.log(`[DB][Fallback] 加载文件: ${REPORTS_FILE}`);
  try {
    fallbackReports = JSON.parse(fs.readFileSync(REPORTS_FILE, 'utf8'));
    console.log(`[DB][Fallback] reports.json 加载成功: ${fallbackReports.length} 条日报`);
  } catch (e) {
    console.error(`[DB][Fallback] reports.json 加载失败: ${e.message}`);
    fallbackReports = [];
  }
}

async function initPool() {
  // --- 策略1：有 DATABASE_PUBLIC_URL → 用公网代理 + SSL ---
  if (parsedPublic) {
    const p = parsedPublic;
    console.log(`[DB] → 使用 DATABASE_PUBLIC_URL 公网代理 + SSL`);
    console.log(`[DB] 代理: ${p.hostname}:${p.port}`);
    console.log(`[DB] 用户: ${p.user}, 数据库: ${p.database}`);
    console.log(`[DB] 密码长度: ${p.password ? p.password.length : 0}`);

    // Railway 公网代理必须使用 SSL，但证书可能不被系统信任
    // pg@8.x 需要 ssl: { rejectUnauthorized: false }
    pool = new Pool({
      host: p.hostname,
      port: p.port,
      user: p.user,
      password: p.password,
      database: p.database,
      ssl: {
        rejectUnauthorized: false,
      },
      connectionTimeoutMillis: 30000,
    });
  }

  // --- 策略2：无公网URL但有内部URL → Railway 内部网络 ---
  else if (parsedMain) {
    const p = parsedMain;

    // Railway 内部 DNS 解析（强制 IPv4）
    let targetHost = pgHost;
    if (pgHost !== 'postgres.railway.internal' && !/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(pgHost)) {
      // pgHost 是 postgres.railway.internal 或其他主机名，需要 DNS 解析
      try {
        const { address } = await lookup(pgHost, { family: 4 });
        targetHost = address;
        console.log(`[DB] DNS IPv4 解析: ${pgHost} → ${address}`);
      } catch (e) {
        console.log(`[DB] DNS IPv4 解析失败: ${e.message}，尝试 IPv6`);
        try {
          const { address } = await lookup(pgHost, { family: 6 });
          targetHost = address;
          console.log(`[DB] DNS IPv6 解析: ${pgHost} → ${address}`);
        } catch (e2) {
          console.error(`[DB] DNS 解析全部失败: ${e2.message}`);
          targetHost = pgHost;
        }
      }
    }

    console.log(`[DB] → Railway 内部连接: ${targetHost}:5432`);
    console.log(`[DB] 密码: ${p.password ? '已设置' : '未设置！'}`);

    // Railway 内部 PostgreSQL：尝试 sslmode=prefer
    pool = new Pool({
      host: targetHost,
      port: 5432,
      user: p.user,
      password: p.password,
      database: p.database,
      // Railway 内部网络：同私有网络无需 SSL
      ssl: false,
      connectionTimeoutMillis: 20000,
    });
  }

  // --- 策略3：纯手动参数（只有 PGHOST+PGPASSWORD） ---
  else if (pgHost && pgPassword) {
    let targetHost = pgHost;
    if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(pgHost)) {
      try {
        const { address } = await lookup(pgHost, { family: 4 });
        targetHost = address;
      } catch (e) { targetHost = pgHost; }
    }
    console.log(`[DB] → 使用 PGHOST+PGPASSWORD: ${targetHost}:5432`);
    pool = new Pool({
      host: targetHost,
      port: 5432,
      user: pgUser,
      password: pgPassword,
      database: pgDatabase,
      // 纯参数方式连接：无需 SSL
      ssl: false,
      connectionTimeoutMillis: 20000,
    });
  }

  if (!pool) {
    console.error('⚠️ 未找到数据库连接信息，启用文件备份模式');
    useFallback = true;
    loadFallbackFiles();
    console.log(`[DB][Fallback] 已加载 ${fallbackUsers.length} 个用户, ${fallbackReports.length} 条日报`);
  }

  // 立即测试连接（仅当 pool 存在时）
  if (pool) {
    console.log('[DB] 正在连接...');
    try {
      const client = await pool.connect();
      console.log('✅ 数据库连接成功！');
      client.release();
    } catch (err) {
      console.error('❌ 数据库连接失败，切换到文件备份模式:', err.message);
      useFallback = true;
      pool = null;
      loadFallbackFiles();
    }
  }

  return pool;
}

// 异步 pool 初始化
const poolReady = initPool();

// 带重试的初始化（等待 poolReady 完成后再重试）
async function initDBWithRetry(maxRetries = 10, intervalMs = 3000) {
  // Fallback 模式：跳过数据库初始化
  if (useFallback) {
    console.log('[DB][Fallback] 跳过数据库初始化，使用文件模式');
    return;
  }

  // 先等待 pool 初始化
  const p = await poolReady;
  if (!p) {
    console.error('[DB] pool 初始化失败，切换到文件备份模式');
    useFallback = true;
    loadFallbackFiles();
    return;
  }

  for (let i = 1; i <= maxRetries; i++) {
    let client;
    try {
      client = await p.connect();

      let existingUsers = [];
      try { existingUsers = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); } catch (e) {}
      let existingReports = [];
      try { existingReports = JSON.parse(fs.readFileSync(REPORTS_FILE, 'utf8')); } catch (e) {}

      await client.query(`
        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          name VARCHAR(50) UNIQUE NOT NULL,
          password VARCHAR(100) NOT NULL,
          active INTEGER DEFAULT 1,
          is_admin BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMP DEFAULT NOW()
        )
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS reports (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL,
          date DATE NOT NULL,
          mileage VARCHAR(200),
          content TEXT,
          submitted_at VARCHAR(100),
          UNIQUE(user_id, date)
        )
      `);

      for (const u of existingUsers) {
        const ts = u.created_at ? new Date(u.created_at).getTime() / 1000 : null;
        try {
          await client.query(
            `INSERT INTO users (id, name, password, active, is_admin, created_at)
             VALUES ($1,$2,$3,$4,$5,${ts ? 'to_timestamp($6)' : 'NOW()'})
             ON CONFLICT (id) DO NOTHING`,
            ts ? [u.id, u.name, u.password, u.active || 1, !!u.isAdmin, ts]
                : [u.id, u.name, u.password, u.active || 1, !!u.isAdmin]
          );
        } catch(e) { /* 跳过冲突 */ }
      }

      // 迁移：将旧的管理员账号"管理员/admin888"改为"xincheng/admin"
      await client.query(
        `UPDATE users SET name = 'xincheng', password = 'admin' WHERE name = '管理员' AND is_admin = true`
      );

      for (const r of existingReports) {
        try {
          await client.query(
            `INSERT INTO reports (id, user_id, date, mileage, content, submitted_at)
             VALUES ($1,$2,$3,$4,$5,$6)
             ON CONFLICT (id) DO NOTHING`,
            [r.id, r.user_id, r.date, r.mileage, r.content, r.submitted_at]
          );
        } catch(e) { /* 跳过冲突 */ }
      }

      console.log(`✅ 数据库初始化完成（第${i}次尝试）`);
      return;
    } catch (err) {
      console.log(`⚠️ 数据库连接尝试 ${i}/${maxRetries} 失败: ${err.message}`);
      if (i < maxRetries) {
        console.log(`   ${intervalMs / 1000}秒后重试...`);
        await new Promise(r => setTimeout(r, intervalMs));
      } else {
        console.error('❌ 数据库初始化最终失败');
      }
    } finally {
      if (client) try { client.release(); } catch (e) {}
    }
  }
}

initDBWithRetry().catch(err => {
  console.error('❌ 数据库初始化失败:', err.message);
});

// ========== 辅助函数 ==========

async function getPool() {
  if (useFallback) return null; // fallback 模式下返回 null
  if (!pool) await poolReady;
  return pool;
}

// ========== 用户查询 ==========

async function findUser(name, password) {
  if (useFallback) {
    const u = fallbackUsers.find(x => x.name === name && x.password === password && x.active);
    return { rows: u ? [u] : [] };
  }
  const p = await getPool();
  return p.query(
    'SELECT id, name, active, is_admin as "isAdmin" FROM users WHERE name = $1 AND password = $2 AND active = 1',
    [name, password]
  );
}

async function getUsers() {
  if (useFallback) return { rows: fallbackUsers };
  const p = await getPool();
  return p.query(
    'SELECT id, name, password, active, is_admin as "isAdmin", created_at as "created_at" FROM users ORDER BY id'
  );
}

async function getActiveUsers() {
  if (useFallback) return { rows: fallbackUsers.filter(u => u.active) };
  const p = await getPool();
  return p.query('SELECT id, name, is_admin as "isAdmin", active FROM users WHERE active = 1 ORDER BY id');
}

async function addUser(name, password) {
  if (useFallback) {
    const maxId = fallbackUsers.length > 0 ? Math.max(...fallbackUsers.map(u => u.id)) : 0;
    const newUser = { id: maxId + 1, name, password, active: 1, isAdmin: false };
    fallbackUsers.push(newUser);
    try { fs.writeFileSync(USERS_FILE, JSON.stringify(fallbackUsers, null, 2)); } catch(e) {}
    return { rows: [{ id: newUser.id }] };
  }
  const p = await getPool();
  return p.query(
    'INSERT INTO users (name, password, active, is_admin) VALUES ($1,$2,1,FALSE) RETURNING id',
    [name.trim(), password.trim()]
  );
}

async function toggleUser(id) {
  if (useFallback) {
    const u = fallbackUsers.find(x => x.id === id);
    if (u) {
      u.active = u.active ? 0 : 1;
      try { fs.writeFileSync(USERS_FILE, JSON.stringify(fallbackUsers, null, 2)); } catch(e) {}
      return { rows: [{ active: u.active }] };
    }
    return { rows: [] };
  }
  const p = await getPool();
  return p.query(
    `UPDATE users SET active = CASE WHEN active=1 THEN 0 ELSE 1 END WHERE id = $1 RETURNING active`,
    [id]
  );
}

async function updatePassword(id, newPassword) {
  if (useFallback) {
    const u = fallbackUsers.find(x => x.id === id);
    if (u) {
      u.password = newPassword;
      try { fs.writeFileSync(USERS_FILE, JSON.stringify(fallbackUsers, null, 2)); } catch(e) {}
    }
    return;
  }
  const p = await getPool();
  return p.query('UPDATE users SET password = $1 WHERE id = $2', [newPassword, id]);
}

// ========== 日报查询 ==========

async function getReports() {
  if (useFallback) return { rows: fallbackReports };
  const p = await getPool();
  return p.query('SELECT id, user_id, date, mileage, content, submitted_at FROM reports ORDER BY id');
}

async function getReport(userId, date) {
  if (useFallback) {
    const r = fallbackReports.find(x => x.user_id === userId && x.date === date);
    return { rows: r ? [r] : [] };
  }
  const p = await getPool();
  return p.query(
    'SELECT id, user_id, date, mileage, content, submitted_at FROM reports WHERE user_id = $1 AND date = $2',
    [userId, date]
  );
}

async function addReport(report) {
  if (useFallback) {
    const maxId = fallbackReports.length > 0 ? Math.max(...fallbackReports.map(r => r.id)) : 0;
    const newReport = { ...report, id: maxId + 1 };
    fallbackReports.push(newReport);
    try { fs.writeFileSync(REPORTS_FILE, JSON.stringify(fallbackReports, null, 2)); } catch(e) {}
    return { rows: [{ id: newReport.id }] };
  }
  const p = await getPool();
  return p.query(
    `INSERT INTO reports (user_id, date, mileage, content, submitted_at)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [report.user_id, report.date, report.mileage, report.content, report.submitted_at]
  );
}

async function updateReport(userId, date, mileage, content, submittedAt) {
  if (useFallback) {
    const r = fallbackReports.find(x => x.user_id === userId && x.date === date);
    if (r) {
      r.mileage = mileage;
      r.content = content;
      r.submitted_at = submittedAt;
      try { fs.writeFileSync(REPORTS_FILE, JSON.stringify(fallbackReports, null, 2)); } catch(e) {}
    }
    return;
  }
  const p = await getPool();
  return p.query(
    `UPDATE reports SET mileage = $1, content = $2, submitted_at = $3
     WHERE user_id = $4 AND date = $5`,
    [mileage, content, submittedAt, userId, date]
  );
}

async function deleteReport(id) {
  if (useFallback) {
    const idx = fallbackReports.findIndex(r => r.id === id);
    if (idx !== -1) {
      fallbackReports.splice(idx, 1);
      try { fs.writeFileSync(REPORTS_FILE, JSON.stringify(fallbackReports, null, 2)); } catch(e) {}
    }
    return;
  }
  const p = await getPool();
  return p.query('DELETE FROM reports WHERE id = $1', [id]);
}

module.exports = {
  findUser, getUsers, getActiveUsers, addUser, toggleUser, updatePassword,
  getReports, getReport, addReport, updateReport, deleteReport,
};
