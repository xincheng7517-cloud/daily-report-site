const { Pool } = require('pg');
const fs = require('fs');
const tls = require('tls');

// Railway 连接
const mainUrl = process.env.DATABASE_URL;       // 内部网络（ Railway 部署时）
const publicUrl = process.env.DATABASE_PUBLIC_URL; // 公网连接（本地开发时）

console.log('[DB] 检测环境变量:');
console.log('   DATABASE_URL:', mainUrl ? '有 ✓' : '无 ✗');
console.log('   DATABASE_PUBLIC_URL:', publicUrl ? '有 ✓' : '无 ✗');

let pool;

if (mainUrl) {
  // ===== Railway 内部网络，无需 SSL =====
  console.log('[DB] → 使用 DATABASE_URL（Railway 内部网络）');
  pool = new Pool({
    connectionString: mainUrl,
    ssl: false,
    connectionTimeoutMillis: 15000,
  });

} else if (publicUrl) {
  // ===== 公网连接，必须走 SSL =====
  console.log('[DB] → 使用 DATABASE_PUBLIC_URL（公网连接）');

  const parsed = new URL(publicUrl);
  const host = parsed.hostname;
  const port = parseInt(parsed.port) || 5432;
  const user = parsed.username;
  const password = parsed.password;
  const database = parsed.pathname.replace(/^\//, '') || 'railway';

  console.log('   主机:', host, '端口:', port, '数据库:', database);

  if (!password) {
    console.error('❌ 密码为空，请检查 DATABASE_PUBLIC_URL');
    process.exit(1);
  }

  // pg v8 的 sslmode=require 会做 hostname 验证
  // 改用 connectionString + ssl: true + rejectUnauthorized 仍会验证主机名
  // 用自定义 tls.connect 绕过 hostname 验证
  const connectionString = `postgresql://${user}:${password}@${host}:${port}/${database}`;

  // Railway 公网代理使用 SSL，pg v8 + Node.js tls 会验证主机名
  // Railway 证书 CN 是 *.railway.dev，与 turntable.proxy.rlwy.net 不匹配
  // 用 checkServerIdentity 强制跳过主机名验证
  let sslConfig;
  try {
    const caCert = fs.readFileSync('/etc/ssl/certs/ca-certificates.crt');
    sslConfig = { ca: caCert, rejectUnauthorized: false, checkServerIdentity: () => undefined };
    console.log('[DB] SSL: 系统 CA + 跳过主机名验证');
  } catch (e) {
    sslConfig = { rejectUnauthorized: false, checkServerIdentity: () => undefined };
    console.log('[DB] SSL: rejectUnauthorized=false + 跳过主机名验证');
  }

  pool = new Pool({
    connectionString,
    ssl: sslConfig,
    connectionTimeoutMillis: 15000,
  });

} else {
  console.error('❌ 未找到数据库连接信息（DATABASE_URL 和 DATABASE_PUBLIC_URL 都缺失）');
  process.exit(1);
}

// 立即测试连接
pool.connect((err, client, release) => {
  if (err) {
    console.error('❌ 数据库连接失败:', err.message);
    console.error('   错误代码:', err.code);
    if (err.code === 'ENOTFOUND') console.error('   → 主机名解析失败，检查网络');
    if (err.message.includes('Connection terminated')) {
      console.error('   → 连接被重置，Railway 公网代理要求 SSL，请确认 ssl 配置正确');
    }
  } else {
    console.log('✅ 数据库连接成功！');
    release();
  }
});

// 带重试的初始化
async function initDBWithRetry(maxRetries = 10, intervalMs = 3000) {
  for (let i = 1; i <= maxRetries; i++) {
    let client;
    try {
      client = await pool.connect();

      let existingUsers = [];
      try { existingUsers = JSON.parse(fs.readFileSync('./users.json', 'utf8')); } catch (e) {}
      let existingReports = [];
      try { existingReports = JSON.parse(fs.readFileSync('./reports.json', 'utf8')); } catch (e) {}

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
        const exist = await client.query('SELECT id FROM users WHERE id = $1', [u.id]);
        if (exist.rows.length === 0) {
          const ts = u.created_at ? new Date(u.created_at).getTime() / 1000 : null;
          await client.query(
            `INSERT INTO users (id, name, password, active, is_admin, created_at)
             VALUES ($1,$2,$3,$4,$5,${ts ? 'to_timestamp($6)' : 'NOW()'})`,
            ts ? [u.id, u.name, u.password, u.active || 1, !!u.isAdmin, ts]
                : [u.id, u.name, u.password, u.active || 1, !!u.isAdmin]
          );
        }
      }

      for (const r of existingReports) {
        const exist = await client.query(
          'SELECT id FROM reports WHERE user_id = $1 AND date = $2',
          [r.user_id, r.date]
        );
        if (exist.rows.length === 0) {
          await client.query(
            `INSERT INTO reports (id, user_id, date, mileage, content, submitted_at)
             VALUES ($1,$2,$3,$4,$5,$6)`,
            [r.id, r.user_id, r.date, r.mileage, r.content, r.submitted_at]
          );
        }
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
        throw err;
      }
    } finally {
      if (client) try { client.release(); } catch (e) {}
    }
  }
}

initDBWithRetry().catch(err => {
  console.error('❌ 数据库初始化失败:', err.message);
});

// ========== 用户查询 ==========

function findUser(name, password) {
  return pool.query(
    'SELECT id, name, active, is_admin as "isAdmin" FROM users WHERE name = $1 AND password = $2 AND active = 1',
    [name, password]
  );
}

function getUsers() {
  return pool.query(
    'SELECT id, name, password, active, is_admin as "isAdmin", created_at as "created_at" FROM users ORDER BY id'
  );
}

function getActiveUsers() {
  return pool.query('SELECT id, name, is_admin as "isAdmin", active FROM users WHERE active = 1 ORDER BY id');
}

function addUser(name, password) {
  return pool.query(
    'INSERT INTO users (name, password, active, is_admin) VALUES ($1,$2,1,FALSE) RETURNING id',
    [name.trim(), password.trim()]
  );
}

function toggleUser(id) {
  return pool.query(
    `UPDATE users SET active = CASE WHEN active=1 THEN 0 ELSE 1 END WHERE id = $1 RETURNING active`,
    [id]
  );
}

// ========== 日报查询 ==========

function getReports() {
  return pool.query('SELECT id, user_id, date, mileage, content, submitted_at FROM reports ORDER BY id');
}

function getReport(userId, date) {
  return pool.query(
    'SELECT id, user_id, date, mileage, content, submitted_at FROM reports WHERE user_id = $1 AND date = $2',
    [userId, date]
  );
}

function addReport(report) {
  return pool.query(
    `INSERT INTO reports (user_id, date, mileage, content, submitted_at)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [report.user_id, report.date, report.mileage, report.content, report.submitted_at]
  );
}

function updateReport(userId, date, mileage, content, submittedAt) {
  return pool.query(
    `UPDATE reports SET mileage = $1, content = $2, submitted_at = $3
     WHERE user_id = $4 AND date = $5`,
    [mileage, content, submittedAt, userId, date]
  );
}

module.exports = {
  findUser, getUsers, getActiveUsers, addUser, toggleUser,
  getReports, getReport, addReport, updateReport, pool
};
