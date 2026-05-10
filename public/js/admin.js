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

// 管理员可见内容
loadMembers();

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

// 删除日报（通过用户id和当前日期）
function deleteReportByUser(userId) {
  if (!confirm('确定删除该成员的日报吗？')) return;
  // 先找到该用户的日报id
  api('/api/reports/summary?date=' + currentDate).then(({ body }) => {
    const members = body.members || [];
    const member = members.find(m => m.id === userId);
    if (!member || !member.submitted) {
      alert('该成员今日未提交日报');
      return;
    }
    // 通过 API 找 report id - 需要查找实际report id
    fetchReportId(userId, function(reportId) {
      if (!reportId) { alert('未找到日报记录'); return; }
      api('/api/report/' + reportId, { method: 'DELETE' }).then(({ status, body }) => {
        if (status !== 200) { alert(body.error || '删除失败'); return; }
        alert('✅ 删除成功');
        loadSummary();
      });
    });
  });
}

function fetchReportId(userId, callback) {
  // 获取所有日报，找到该用户当前日期的日报id
  api('/api/reports/summary?date=' + currentDate).then(({ body }) => {
    // 从汇总中获取report id - 需要通过另一个接口
    // 简单方式：直接用getReports获取
    apiGetReportId(userId, currentDate, callback);
  });
}

function apiGetReportId(userId, date, callback) {
  // 调用获取日报列表接口
  fetch('/api/reports/summary?date=' + date, {
    headers: { 'Authorization': token }
  })
  .then(r => r.json())
  .then(data => {
    // 查找用户提交
    const members = data.members || [];
    const member = members.find(m => m.id === userId);
    if (!member || !member.submitted_at) { callback(null); return; }
    // 需要通过成员名称来查找report id
    // 获取所有日报
    fetch('/api/reports', {
      headers: { 'Authorization': token }
    })
    .then(r => r.json())
    .then(allData => {
      const reports = allData.reports || [];
      const report = reports.find(r => r.user_id === userId && r.date === date);
      callback(report ? report.id : null);
    });
  });
}

// 导出 xlsx（服务端生成）
function exportXLSX() {
  const date = currentDate;
  const url = '/api/export/xlsx?date=' + date;
  // 用 token 做 auth
  fetch(url, { headers: { 'Authorization': token } })
    .then(r => {
      if (r.status === 403) { alert('无权限'); return; }
      if (r.status !== 200) { alert('导出失败'); return; }
      return r.blob();
    })
    .then(blob => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = '日报汇总_' + date + '.xlsx';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    })
    .catch(() => alert('导出失败'));
}

function exportCSV() {
  if (currentMembers.length === 0) {
    alert('暂无数据可导出');
    return;
  }
  let csv = '\uFEFF序号,姓名,状态,工作里程,工作内容摘要,提交时间\n';
  currentMembers.forEach((m, i) => {
    const mileage = (m.mileage || '').replace(/"/g, '""');
    const content = (m.content || '').replace(/"/g, '""');
    const time = (m.submitted_at || '').replace(/"/g, '""');
    csv += `${i + 1},"${m.name}","${m.status}","${mileage}","${content}","${time}"\n`;
  });
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `日报汇总_${currentDate}.csv`;
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

function goDashboard() {
  window.location.href = 'dashboard.html';
}

function doLogout() {
  api('/api/logout', { method: 'POST' }).then(() => {
    localStorage.clear();
    window.location.href = 'index.html';
  });
}
