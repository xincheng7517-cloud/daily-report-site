const { Pool } = require('pg');
const dns = require('dns');
const { promisify } = require('util');
const fs = require('fs');

const lookup = promisify(dns.lookup);

// Railway 连接策略：
// 1. 用 dns.lookup(family:4) 强制解析 PGHOST 为 IPv4
// 2. 用独立参数（非 connectionString）传入 Pool，使 family:4 生效
// 3. 本地开发：用 DATABASE_PUBLIC_URL + SSL

const pgHost = process.env.PGHOST || 'postgres.railway.internal';
const pgPassword = process.env.PGPASSWORD;
const pgUser = process.env.PGUSER || 'postgres';
const pgDatabase = process.env.PGDATABASE || 'railway';
const mainUrl = process.env.DATABASE_URL;
const publicUrl = process.env.DATABASE_PUBLIC_URL;

console.log('[DB] 检测环境变量:');
console.log('   PGHOST:', pgHost);
console.log('   PGPASSWORD:', pgPassword ? '有 ✓' : '无 ✗');
console.log('   DATABASE_URL:', mainUrl ? '有 ✓' : '无 ✗');
console.log('   DATABASE_PUBLIC_URL:', publicUrl ? '有 ✓' : '无 ✗');

// 异步初始化 pool，所有查询函数在使用 pool 前会先 await poolReady
let pool = null;
let poolReady = null;

async function initPool() {
  // --- 策略1 & 2：Railway 内部网络，强制 IPv4 ---
  if (pgHost || mainUrl) {
    // 用 dns.lookup 强制解析为 IPv4
    let ipv4Host = pgHost;  // 如果 PGHOST 已经是 IP 地址，直接用
    const isIpv4 = /^(\d{1,3}\.){3}\d{1,3}$/.test(pgHost);

    if (!isIpv4) {
      try {
        const { address } = await lookup(pgHost, { family: 4 });
        ipv4Host = address;
        console.log(`[DB] DNS解析 ${pgHost} → ${ipv4Host} (IPv4)`);
      } catch (e) {
        console.error(`[DB] ⚠️ DNS IPv4解析失败: ${e.message}，尝试直接用主机名`);
        ipv4Host = pgHost; // fallback: 直接用原始主机名
      }
    } else {
      console.log(`[DB] PGHOST 已是 IPv4 地址: ${pgHost}`);
    }

    // 确定密码和用户
    let user = pgUser;
    let password = pgPassword;
    let database = pgDatabase;

    if (!password && mainUrl) {
      try {
        const url = new URL(mainUrl);
        password = url.password;
        user = url.username || pgUser;
        database = url.pathname.replace(/^\//, '') || pgDatabase;
        console.log('[DB] 从 DATABASE_URL 解析密码/用户/数据库');
      } catch (e) {
        console.error('[DB] 解析 DATABASE_URL 失败:', e.message);
      }
    }

    if (!password) {
      console.error('❌ 未找到数据库密码（需要 PGPASSWORD 或 DATABASE_URL）');
      process.exit(1);
    }

    console.log(`[DB] → 使用 IPv4 连接: ${ipv4Host}:5432`);
    pool = new Pool({
      host: ipv4Host,
      port: 5432,
      user,
      password,
      database,
      ssl: false,
      connectionTimeoutMillis: 15000,
      family: 4,
    });
  }

  // --- 策略3：本地开发用公网连接 ---
  if (!pool && publicUrl) {
    console.log('[DB] → 使用 DATABASE_PUBLIC_URL（公网 SSL 连接）');
    const parsed = new URL(publicUrl);
    const host = parsed.hostname;
    const port = parseInt(parsed.port) || 5432;
    const user = parsed.username;
    const password = parsed.password;
    const database = parsed.pathname.replace(/^\//, '') || 'railway';

    if (!password) {
      console.error('❌ 密码为空，请检查 DATABASE_PUBLIC_URL');
      process.exit(1);
    }

    pool = new Pool({
      host,
      port,
      user,
      password,
      database,
      ssl: {
        rejectUnauthorized: false,
        checkServerIdentity: () => undefined,
      },
      connectionTimeoutMillis: 15000,
      family: 4,
    });
    console.log('[DB] SSL: rejectUnauthorized=false');
  }

  if (!pool) {
    console.error('❌ 未找到数据库连接信息');
    console.error('   需要 PGHOST + PGPASSWORD 或 DATABASE_URL 或 DATABASE_PUBLIC_URL');
    process.exit(1);
  }

  // 立即测试连接
  try {
    const client = await pool.connect();
    console.log('✅ 数据库连接成功！');
    client.release();
  } catch (err) {
    console.error('❌ 数据库连接失败:', err.message);
    console.error('   错误代码:', err.code);
    // 不立即退出，让重试逻辑处理
  }

  return pool;
}

poolReady = initPool();

// 带重试的初始化
async function initDBWithRetry(maxRetries = 10, intervalMs = 3000) {
  const p = await poolReady;  // 等待 pool 初始化完成
  for (let i = 1; i <= maxRetries; i++) {
    let client;
    try {
      client = await p.connect();

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

// 确保 pool 已就绪的辅助函数
async function getPool() {
  if (!pool) await poolReady;
  return pool;
}

// ========== 用户查询 ==========

async function findUser(name, password) {
  const p = await getPool();
  return p.query(
    'SELECT id, name, active, is_admin as "isAdmin" FROM users WHERE name = $1 AND password = $2 AND active = 1',
    [name, password]
  );
}

async function getUsers() {
  const p = await getPool();
  return p.query(
    'SELECT id, name, password, active, is_admin as "isAdmin", created_at as "created_at" FROM users ORDER BY id'
  );
}

async function getActiveUsers() {
  const p = await getPool();
  return p.query('SELECT id, name, is_admin as "isAdmin", active FROM users WHERE active = 1 ORDER BY id');
}

async function addUser(name, password) {
  const p = await getPool();
  return p.query(
    'INSERT INTO users (name, password, active, is_admin) VALUES ($1,$2,1,FALSE) RETURNING id',
    [name.trim(), password.trim()]
  );
}

async function toggleUser(id) {
  const p = await getPool();
  return p.query(
    `UPDATE users SET active = CASE WHEN active=1 THEN 0 ELSE 1 END WHERE id = $1 RETURNING active`,
    [id]
  );
}

// ========== 日报查询 ==========

async function getReports() {
  const p = await getPool();
  return p.query('SELECT id, user_id, date, mileage, content, submitted_at FROM reports ORDER BY id');
}

async function getReport(userId, date) {
  const p = await getPool();
  return p.query(
    'SELECT id, user_id, date, mileage, content, submitted_at FROM reports WHERE user_id = $1 AND date = $2',
    [userId, date]
  );
}

async function addReport(report) {
  const p = await getPool();
  return p.query(
    `INSERT INTO reports (user_id, date, mileage, content, submitted_at)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [report.user_id, report.date, report.mileage, report.content, report.submitted_at]
  );
}

async function updateReport(userId, date, mileage, content, submittedAt) {
  const p = await getPool();
  return p.query(
    `UPDATE reports SET mileage = $1, content = $2, submitted_at = $3
     WHERE user_id = $4 AND date = $5`,
    [mileage, content, submittedAt, userId, date]
  );
}

module.exports = {
  findUser, getUsers, getActiveUsers, addUser, toggleUser,
  getReports, getReport, addReport, updateReport,
};
