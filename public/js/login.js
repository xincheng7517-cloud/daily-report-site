let API = '';

window.onload = function() {
  loadMembers();
};

function loadMembers() {
  fetch('/api/members')
    .then(r => r.json())
    .then(data => {
      const sel = document.getElementById('name');
      sel.innerHTML = '<option value="">-- 请选择姓名 --</option>';
      (data.members || []).filter(m => m.active).forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.name;
        opt.textContent = m.name;
        sel.appendChild(opt);
      });
    })
    .catch(() => {});
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
    window.location.href = 'dashboard.html';
  })
  .catch(() => { msg.textContent = '网络错误，请重试'; });
}
