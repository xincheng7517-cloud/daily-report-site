let API = '';
let isAdminMode = false;

window.onload = function() {
  loadMembers();
  fetchUptime();
};

// 每30秒刷新运行时间
function fetchUptime() {
  fetch('/api/uptime')
    .then(r => r.json())
    .then(d => {
      document.getElementById('uptimeBar').textContent = '🟢 系统已运行 ' + d.uptime;
    })
    .catch(() => {});
  setTimeout(fetchUptime, 30000);
}

function loadMembers() {
  fetch('/api/members')
    .then(r => r.json())
    .then(data => {
      const sel = document.getElementById('name');
      sel.innerHTML = '<option value="">-- 请选择姓名 --</option>';
      (data.members || []).filter(m => m.active && !m.isAdmin).forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.name;
        opt.textContent = m.name;
        sel.appendChild(opt);
      });
    })
    .catch(() => {});
}

function toggleAdminLogin() {
  isAdminMode = !isAdminMode;
  document.getElementById('memberLogin').style.display = isAdminMode ? 'none' : '';
  document.getElementById('adminLogin').style.display = isAdminMode ? '' : 'none';
  document.getElementById('toggleAdmin').textContent = isAdminMode ? '' : '🔑 管理员登录';
  document.getElementById('pageSubtitle').textContent = isAdminMode ? '管理员登录后进入后台管理' : '登录后提交每日工作日报';
  document.getElementById('errorMsg').textContent = '';
}

function doLogin() {
  const name = document.getElementById('name').value;
  const password = document.getElementById('password').value;
  const msg = document.getElementById('errorMsg');
  msg.textContent = '';

  if (!name || !password) {
    msg.textContent = '请选择姓名并输入密码';
    return;
  }

  fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, password })
  })
  .then(r => r.json().then(d => ({ status: r.status, body: d })))
  .then(({ status, body }) => {
    if (status !== 200) {
      msg.textContent = body.error || '登录失败';
      return;
    }
    localStorage.setItem('token', body.token);
    localStorage.setItem('userName', body.user.name);
    localStorage.setItem('isAdmin', body.user.isAdmin ? '1' : '0');
    // 成员跳转到日报提交页
    window.location.href = 'dashboard.html';
  })
  .catch(() => { msg.textContent = '网络错误，请重试'; });
}

function doAdminLogin() {
  const name = document.getElementById('adminName').value;
  const password = document.getElementById('adminPassword').value;
  const msg = document.getElementById('errorMsg');
  msg.textContent = '';

  if (!name || !password) {
    msg.textContent = '请输入管理员账号和密码';
    return;
  }

  fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, password })
  })
  .then(r => r.json().then(d => ({ status: r.status, body: d })))
  .then(({ status, body }) => {
    if (status !== 200) {
      msg.textContent = body.error || '登录失败';
      return;
    }
    if (!body.user.isAdmin) {
      msg.textContent = '该账号不是管理员，请使用成员登录';
      return;
    }
    localStorage.setItem('token', body.token);
    localStorage.setItem('userName', body.user.name);
    localStorage.setItem('isAdmin', '1');
    // 管理员跳转到后台
    window.location.href = 'admin.html';
  })
  .catch(() => { msg.textContent = '网络错误，请重试'; });
}
