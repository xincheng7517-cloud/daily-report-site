const token = localStorage.getItem('token');
const userName = localStorage.getItem('userName');

if (!token) window.location.href = 'index.html';

document.getElementById('userInfo').textContent = '👤 ' + userName;

// 今日日期
document.getElementById('todayDate').textContent = '日报日期：' + new Date().toISOString().slice(0, 10);

// 页面加载时检查今日是否已提交
window.onload = function() {
  checkToday();
};

function api(path, opts = {}) {
  return fetch(path, {
    ...opts,
    headers: { 'Authorization': token, 'Content-Type': 'application/json', ...(opts.headers || {}) }
  }).then(r => {
    if (r.status === 401) { localStorage.clear(); window.location.href = 'index.html'; }
    return r.json().then(d => ({ status: r.status, body: d }));
  });
}

function checkToday() {
  api('/api/report/today').then(({ body }) => {
    if (body.submitted) {
      // 已提交 -> 跳转到已提交页面
      window.location.href = 'submitted.html';
    }
  });
}

function doSubmit() {
  const mileage = document.getElementById('mileage').value;
  const content = document.getElementById('content').value;
  const msg = document.getElementById('msg');
  const err = document.getElementById('err');
  msg.textContent = ''; err.textContent = '';

  if (!mileage.trim()) { err.textContent = '请填写今日工作里程'; return; }
  if (!content.trim()) { err.textContent = '请填写今日工作内容'; return; }

  api('/api/report', { method: 'POST', body: JSON.stringify({ mileage, content }) })
    .then(({ status, body }) => {
      if (status !== 200) { err.textContent = body.error || '提交失败'; return; }
      msg.textContent = '✅ 提交成功！';
      // 跳转到已提交页面
      setTimeout(() => { window.location.href = 'submitted.html'; }, 500);
    });
}

function doUpdate() {
  const mileage = document.getElementById('mileage').value;
  const content = document.getElementById('content').value;
  const msg = document.getElementById('msg');
  const err = document.getElementById('err');
  msg.textContent = ''; err.textContent = '';

  if (!mileage.trim()) { err.textContent = '请填写今日工作里程'; return; }
  if (!content.trim()) { err.textContent = '请填写今日工作内容'; return; }

  api('/api/report', { method: 'PUT', body: JSON.stringify({ mileage, content }) })
    .then(({ status, body }) => {
      if (status !== 200) { err.textContent = body.error || '修改失败'; return; }
      msg.textContent = '✅ 修改成功！';
      // 跳转到已提交页面
      setTimeout(() => { window.location.href = 'submitted.html'; }, 500);
    });
}

function doLogout() {
  api('/api/logout', { method: 'POST' }).then(() => {
    localStorage.clear();
    window.location.href = 'index.html';
  });
}
