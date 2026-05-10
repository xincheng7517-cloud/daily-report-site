const token = localStorage.getItem('token');
const userName = localStorage.getItem('userName');
const isAdmin = localStorage.getItem('isAdmin') === '1';

if (!token) window.location.href = 'index.html';
if (!isAdmin) {
  alert('无权限访问管理后台');
  window.location.href = 'dashboard.html';
}

document.getElementById('userInfo').textContent = '👤 ' + userName;

// 默认日期为今天
document.getElementById('datePicker').value = new Date().toISOString().slice(0, 10);
document.getElementById('pageTitle').textContent = '日报汇总 — ' + new Date().toISOString().slice(0, 10);

let currentMembers = [];
let currentDate = '';

window.onload = function() { loadSummary(); loadMembers(); };

function switchTab(tab) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.getElementById('tab' + tab.charAt(0).toUpperCase() + tab.slice(1)).classList.add('active');
  document.getElementById('tabContent' + tab.charAt(0).toUpperCase() + tab.slice(1)).classList.add('active');
  if (tab === 'members') loadMembers();
  if (tab === 'stats') loadSummary();
}

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
  document.getElementById('pageTitle').textContent = '日报汇总 — ' + date;
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
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#999;padding:20px;">暂无成员数据</td></tr>';
      return;
    }
    members.forEach((m, i) => {
      let statusClass = 'status-pending';
      if (m.status === '已完成') statusClass = 'status-done';
      if (m.status === '未完成') statusClass = 'status-undone';
      const tr = document.createElement('tr');
      const hasReport = m.submitted;
      tr.innerHTML = `
        <td>${i + 1}</td>
        <td><b>${m.name}</b></td>
        <td class="${statusClass}">${m.status}</td>
        <td>${m.mileage || '—'}</td>
        <td>${m.content || '—'}</td>
        <td style="font-size:12px;color:#888;">${m.submitted_at || '—'}</td>
        <td>${hasReport ? '<button class="btn-del" onclick="deleteReportByUser(' + m.id + ')">删除</button>' : ''}</td>
      `;
      tbody.appendChild(tr);
    });
  }).catch(() => {
    document.getElementById('loadMsg').textContent = '加载失败，请刷新重试';
  });
}

function deleteReportByUser(userId) {
  if (!confirm('确定删除该成员的日报吗？')) return;
  api('/api/reports/summary?date=' + currentDate).then(({ body }) => {
    const member = (body.members || []).find(m => m.id === userId);
    if (!member || !member.submitted) { alert('该成员今日未提交日报'); return; }
    // 获取日报列表找到 report id
    fetch('/api/reports', { headers: { 'Authorization': token } })
      .then(r => r.json())
      .then(data => {
        const reports = data.reports || [];
        const report = reports.find(r => r.user_id === userId && String(r.date) === currentDate);
        if (!report) { alert('未找到日报记录'); return; }
        api('/api/report/' + report.id, { method: 'DELETE' }).then(({ status, body }) => {
          if (status !== 200) { alert(body.error || '删除失败'); return; }
          alert('✅ 删除成功');
          loadSummary();
        });
      });
  });
}

// 导出 xlsx（服务端生成，直接下载）
function exportXLSX() {
  const date = currentDate;
  window.open('/api/export/xlsx?date=' + date + '&token=' + token, '_blank');
}

// ======== 成员管理 ========
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
          <button onclick="toggleMember(${m.id})" style="padding:2px 8px;border-radius:4px;border:1px solid #d9d9d9;background:#fff;cursor:pointer;font-size:12px;margin-right:4px;">
            ${m.active ? '禁用' : '启用'}
          </button>
          <button onclick="changePassword(${m.id})" style="padding:2px 8px;border-radius:4px;border:1px solid #d9d9d9;background:#fff;cursor:pointer;font-size:12px;">
            改密
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
      msg.textContent = '✅ 添加成功！';
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

function changePassword(id) {
  const newPwd = prompt('请输入新密码：');
  if (!newPwd || newPwd.trim() === '') return;
  api('/api/members/' + id, { method: 'PUT', body: JSON.stringify({ password: newPwd.trim() }) })
    .then(({ status, body }) => {
      if (status !== 200) { alert(body.error || '修改失败'); return; }
      alert('✅ 密码修改成功');
    });
}

function doLogout() {
  api('/api/logout', { method: 'POST' }).then(() => {
    localStorage.clear();
    window.location.href = 'index.html';
  });
}
