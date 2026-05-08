const fs = require('fs');
const path = require('path');

const USERS_FILE = path.join(__dirname, 'users.json');

// 成员名单
const names = [
  '杨文宗', '国林忠', '王涛', '牛德国', '李可聚',
  '孔宪杰', '崔彦峰', '邓涛', '徐继广', '马宝祥',
  '李志明', '毕振江', '郑维涛', '宋宏志', '王会鑫',
  '王金波', '丁善武', '康斌', '王柏声'
];

const password = '000000';

function loadUsers() {
  if (!fs.existsSync(USERS_FILE)) return [];
  return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
}
function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

const users = loadUsers();
let nextId = users.length > 0 ? Math.max(...users.map(u => u.id)) + 1 : 1;
let added = 0;

names.forEach(name => {
  if (!users.find(u => u.name === name)) {
    users.push({
      id: nextId++,
      name: name,
      password: password,
      active: 1,
      created_at: new Date().toISOString()
    });
    added++;
    console.log(`✓ 已创建: ${name}`);
  } else {
    console.log(`○ 已存在: ${name}`);
  }
});

saveUsers(users);
console.log(`\n完成！新增 ${added} 人，共 ${users.length} 人。`);
