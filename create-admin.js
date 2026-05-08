const fs = require('fs');
const path = require('path');

const USERS_FILE = path.join(__dirname, 'users.json');

const adminName = '管理员';
const adminPassword = 'admin888';

function loadUsers() {
  if (!fs.existsSync(USERS_FILE)) return [];
  return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
}
function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

const users = loadUsers();
const existing = users.find(u => u.name === adminName);

if (existing) {
  // 确保是管理员
  if (!existing.isAdmin) {
    existing.isAdmin = true;
    saveUsers(users);
    console.log(`✓ 已将 "${adminName}" 升级为管理员`);
  } else {
    console.log(`✓ "${adminName}" 已是管理员（密码: ${adminPassword}）`);
  }
} else {
  const newId = users.length > 0 ? Math.max(...users.map(u => u.id)) + 1 : 1;
  users.push({
    id: newId,
    name: adminName,
    password: adminPassword,
    active: 1,
    isAdmin: true,
    created_at: new Date().toISOString()
  });
  saveUsers(users);
  console.log(`✓ 管理员账号创建成功！`);
}

console.log(`\n管理员登录信息：`);

console.log(`  姓名：${adminName}`);
console.log(`  密码：${adminPassword}`);
console.log(`\n登录后可在"汇总查看"页面使用导出功能和成员管理。`);
