const token = localStorage.getItem('token');
const userName = localStorage.getItem('userName');

if (!token) window.location.href = 'index.html';

document.getElementById('userInfo').textContent = '👤 ' + userName;
document.getElementById('submittedDate').textContent = '提交日期：' + new Date().toISOString().slice(0, 10);

function api(path, opts = {}) {
  return fetch(path, {
    ...opts,
    headers: { 'Authorization': token, 'Content-Type': 'application/json', ...(opts.headers || {}) }
  }).then(r => {
    if (r.status === 401) { localStorage.clear(); window.location.href = 'index.html'; }
    return r.json().then(d => ({ status: r.status, body: d }));
  });
}

window.onload = function() {
  loadTodayReport();
};

function loadTodayReport() {
  api('/api/report/today').then(({ body }) => {
    if (!body.submitted) {
      // 没提交？跳回提交页
      window.location.href = 'dashboard.html';
      return;
    }
    document.getElementById('previewMileage').textContent = body.report.mileage || '—';
    document.getElementById('previewContent').textContent = body.report.content || '—';
    document.getElementById('previewTime').textContent = body.report.submitted_at || '—';
  }).catch(() => {
    document.getElementById('err').textContent = '加载失败，请刷新重试';
  });
}

function goModify() {
  window.location.href = 'dashboard.html?modify=1';
}

function goReturn() {
  location.reload();
}

function doLogout() {
  api('/api/logout', { method: 'POST' }).then(() => {
    localStorage.clear();
    window.location.href = 'index.html';
  });
}
