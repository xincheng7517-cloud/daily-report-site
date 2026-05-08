const token = localStorage.getItem('token');
const userName = localStorage.getItem('userName');
const isAdmin = localStorage.getItem('isAdmin') === '1';

if (!token) window.location.href = 'index.html';

// 默认日期为今天
document.getElementById('datePicker').value = new Date().toISOString().slice(0, 10);
document.getElementById('pageTitle').textContent = '日报汇总 — ' + new Date().toISOString().slice(0, 10);

// 管理员可见内容
if (isAdmin) {
  document.getElementById('exportBtn').style.display = '';
  document.getElementById('adminPanel').style.display = '';
  loadMembers();
}

let currentMembers = [];
let currentDate = '';

window.onload = function() { loadSummary(); };

function api(path, opts = {}) {
  return fetch(path, {
    ...opts,
    headers: { 'Authorization': token, 'Content-Type': 'application/json', ...(opts.headers || {}) }
  }).then(r => {
    if (r.status === 401) { localStorage.clear(); window.location.href = 'index.html'; }
    return r.json().then(d => ({ status: r.status, body: d }));
  });
}

function loadSummary() {
  const date = document.getElementById('datePicker').value;
  currentDate = date;
  document.getElementById('pageTitle').textContent = '明日计划汇总 — ' + date;
  document.getElementById('loadMsg').style.display = 'block';
  document.getElementById('tbody').innerHTML = '';
  document.getElementById('stats').innerHTML = '';

  api('/api/reports/summary?date=' + date).then(({ body }) => {
    document.getElementById('loadMsg').style.display = 'none';
    const members = body.members || [];
    currentMembers = members;
    let done = 0, undone = 0, pending = 0;
    members.forEach(m => {
      if (m.status === '已完成') done++;
      else if (m.status === '未完成') undone++;
      else pending++;
    });

    document.getElementById('stats').innerHTML = `
      <div class="stat-card blue"><div class="num">${members.length}</div><div class="label">应提交人数</div></div>
      <div class="stat-card green"><div class="num">${done}</div><div class="label">已提交</div></div>
      <div class="stat-card red"><div class="num">${undone}</div><div class="label">未完成</div></div>
      <div class="stat-card orange"><div class="num">${pending}</div><div class="label">待提交</div></div>
    `;

    const tbody = document.getElementById('tbody');
    if (members.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#999;padding:20px;">暂无成员数据</td></tr>';
      return;
    }
    members.forEach((m, i) => {
      let statusClass = 'status-pending';
      if (m.status === '已完成') statusClass = 'status-done';
      if (m.status === '未完成') statusClass = 'status-undone';
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${i + 1}</td>
        <td><b>${m.name}</b></td>
        <td class="${statusClass}">${m.status}</td>
        <td>${m.mileage || '—'}</td>
        <td>${m.content || '—'}</td>
        <td style="font-size:12px;color:#888;">${m.submitted_at || '—'}</td>
      `;
      tbody.appendChild(tr);
    });
  }).catch(() => {
    document.getElementById('loadMsg').textContent = '加载失败，请刷新重试';
  });
}

function exportCSV() {
  if (currentMembers.length === 0) {
    alert('暂无数据可导出');
    return;
  }
  let csv = '\uFEFF序号,姓名,工作里程,工作内容摘要\n';
  currentMembers.forEach((m, i) => {
    const mileage = (m.mileage || '').replace(/"/g, '""');
    const content = (m.content || '').replace(/"/g, '""');
    csv += `${i + 1},"${m.name}","${mileage}","${content}"\n`;
  });
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `明日计划_${currentDate}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ======== 成员管理（仅管理员） ========
function loadMembers() {
  api('/api/members').then(({ body }) => {
    const tbody = document.getElementById('memberTbody');
    tbody.innerHTML = '';
    (body.members || []).forEach(m => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><b>${m.name}</b></td>
        <td style="color:${m.active ? '#52c41a' : '#ff4d4f'};">${m.active ? '启用' : '禁用'}</td>
        <td>
          <button onclick="toggleMember(${m.id})" style="padding:2px 8px;border-radius:4px;border:1px solid #d9d9d9;background:#fff;cursor:pointer;font-size:12px;">
            ${m.active ? '禁用' : '启用'}
          </button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  });
}

function addMember() {
  const name = document.getElementById('newName').value.trim();
  const password = document.getElementById('newPassword').value.trim() || '000000';
  const msg = document.getElementById('adminMsg');
  msg.textContent = '';

  if (!name) { msg.textContent = '请填写姓名'; msg.style.color = '#ff4d4f'; return; }

  api('/api/members', { method: 'POST', body: JSON.stringify({ name, password }) })
    .then(({ status, body }) => {
      if (status !== 200) { msg.textContent = body.error || '添加失败'; msg.style.color = '#ff4d4f'; return; }
      msg.textContent = '添加成功！';
      msg.style.color = '#52c41a';
      document.getElementById('newName').value = '';
      loadMembers();
      setTimeout(() => { msg.textContent = ''; }, 2000);
    });
}

function toggleMember(id) {
  api(`/api/members/${id}/toggle`, { method: 'PUT' })
    .then(() => loadMembers());
}

function goDashboard() {
  window.location.href = 'dashboard.html';
}

function doLogout() {
  api('/api/logout', { method: 'POST' }).then(() => {
    localStorage.clear();
    window.location.href = 'index.html';
  });
}
