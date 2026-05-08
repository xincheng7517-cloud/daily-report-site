const { Pool } = require('pg');

// Railway 数据库连接
const publicUrl = process.env.DATABASE_PUBLIC_URL;
const mainUrl = process.env.DATABASE_URL;

console.log('[DB] 检测到的环境变量:');
console.log('   DATABASE_URL:', mainUrl ? '有 ✓' : '无 ✗');
console.log('   DATABASE_PUBLIC_URL:', publicUrl ? '有 ✓' : '无 ✗');

// 优先使用 DATABASE_URL（Railway 内部通信，无需 SSL）
if (mainUrl) {
  console.log('[DB] → 使用 DATABASE_URL（内部连接）');
  var pool = new Pool({
    connectionString: mainUrl,
    ssl: false,
    connectionTimeoutMillis: 15000,
  });
} else if (publicUrl) {
  console.log('[DB] → 使用 DATABASE_PUBLIC_URL（公网连接）');

  // 使用 Node.js URL 解析器，正确处理密码中的冒号等特殊字符
  const parsedUrl = new URL(publicUrl);
  const host = parsedUrl.hostname;
  const port = parseInt(parsedUrl.port) || 5432;
  const user = parsedUrl.username;
  const password = parsedUrl.password;
  const database = parsedUrl.pathname.replace(/^\//, '') || 'railway';

  console.log('[DB] URL 解析结果:');
  console.log('   主机:', host);
  console.log('   端口:', port);
  console.log('   用户:', user || '(无)');
  console.log('   密码:', password ? `有 ✓ (${password.length}字符)` : '无 ✗');
  console.log('   数据库:', database);

  if (!password) {
    console.error('❌ 密码为空，请检查 Railway DATABASE_PUBLIC_URL 配置');
    process.exit(1);
  }

  // pg v8 将 sslmode=require 当作 verify-full（全验证），无法绕过
  // Railway 代理证书不在 Node 信任链，验证必败
  // 解决方案：sslmode=disable，连接走明文 TCP，Frp SSH 隧道本身已加密
  const connectionString = `postgresql://${user}:${password}@${host}:${port}/${database}?sslmode=disable`;

  var pool = new Pool({
    connectionString,
    ssl: false,
    connectionTimeoutMillis: 15000,
  });

  console.log('[DB] SSL: sslmode=disable（数据通过 Frp SSH 隧道加密）');
  console.log('[DB] 连接: postgresql://...@', host + ':' + port + '/', database);
} else {
  console.error('❌ 未找到数据库连接信息');
  process.exit(1);
}

// 立即测试连接
pool.connect((err, client, release) => {
  if (err) {
    console.error('❌ 数据库连接失败:', err.message);
    console.error('   错误代码:', err.code);
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
      const fs = require('fs');

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
            ts ? [u.id, u.name, u.password, u.active || 1, !!u.isAdmin, ts] : [u.id, u.name, u.password, u.active || 1, !!u.isAdmin]
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
