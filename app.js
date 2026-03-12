// ═══════════════════════════════════════════════════════════
// CompTrack — app.js  (API-connected version)
// All data calls go to the Express/MySQL backend.
// UI helpers (sidebar, modal, toast, etc.) are unchanged.
// ═══════════════════════════════════════════════════════════

const API_BASE = 'http://localhost:5000/api';

// ── DEMO USERS (kept only for memberName() lookup) ──────────
const USERS = {
  student:    { name: 'Aliyah Rahmawati',   role: 'student',    nim: '20210001', major: 'Informatics', email: 'aliyah@university.ac.id',  color: '#4f8aff' },
  student2:   { name: 'Bima Prasetyo',      role: 'student',    nim: '20210045', major: 'Informatics', email: 'bima@university.ac.id',    color: '#7c5cfc' },
  student3:   { name: 'Citra Dewi',         role: 'student',    nim: '20210089', major: 'Business',    email: 'citra@university.ac.id',   color: '#00d4aa' },
  pic:        { name: 'Dr. Hendra Wijaya',  role: 'pic',        nim: null,       major: 'Informatics', email: 'hendra@university.ac.id',  color: '#ff8c42' },
  faculty:    { name: 'Prof. Sari Lestari', role: 'faculty',    nim: null,       major: null,          email: 'sari@university.ac.id',    color: '#ff5c6a' },
  superadmin: { name: 'Admin Sistem',       role: 'superadmin', nim: null,       major: null,          email: 'admin@university.ac.id',   color: '#ffb547' },
};

// ═══════════════════════════════════════════════════════════
// API CLIENT — central fetch wrapper
// ═══════════════════════════════════════════════════════════

async function apiFetch(path, options = {}) {
  const token = localStorage.getItem('accessToken');
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };

  // Don't set Content-Type for FormData (let browser set boundary)
  if (options.body instanceof FormData) delete headers['Content-Type'];

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });

  // Token expired → try refresh
  if (res.status === 401) {
    const data = await res.json().catch(() => ({}));
    if (data.code === 'TOKEN_EXPIRED') {
      const refreshed = await tryRefreshToken();
      if (refreshed) {
        // Retry original request with new token
        headers.Authorization = `Bearer ${localStorage.getItem('accessToken')}`;
        const retry = await fetch(`${API_BASE}${path}`, { ...options, headers });
        return retry;
      }
    }
    // Refresh failed → logout
    clearSession();
    window.location.href = 'auth.html';
    return res;
  }

  return res;
}

async function tryRefreshToken() {
  const refreshToken = localStorage.getItem('refreshToken');
  if (!refreshToken) return false;
  try {
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    localStorage.setItem('accessToken', data.accessToken);
    localStorage.setItem('refreshToken', data.refreshToken);
    return true;
  } catch {
    return false;
  }
}

function clearSession() {
  localStorage.removeItem('accessToken');
  localStorage.removeItem('refreshToken');
  localStorage.removeItem('ct_user');
}

// ═══════════════════════════════════════════════════════════
// AUTH HELPERS
// ═══════════════════════════════════════════════════════════

function getCurrentUser() {
  try {
    const s = localStorage.getItem('ct_user');
    return s ? JSON.parse(s) : null;
  } catch { return null; }
}

function setCurrentUser(user) {
  localStorage.setItem('ct_user', JSON.stringify(user));
}

function requireAuth(allowedRoles) {
  const user = getCurrentUser();
  if (!user || !localStorage.getItem('accessToken')) {
    window.location.href = 'auth.html';
    return null;
  }
  if (allowedRoles && !allowedRoles.includes(user.role)) {
    window.location.href = 'dashboard.html';
    return null;
  }
  return user;
}

async function logout() {
  try {
    await apiFetch('/auth/logout', {
      method: 'POST',
      body: JSON.stringify({ refreshToken: localStorage.getItem('refreshToken') }),
    });
  } catch { /* ignore */ }
  clearSession();
  window.location.href = 'index.html';
}

// Used by auth.html after login/register
async function loginWithEmail(email, password) {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.message || 'Login failed');
  localStorage.setItem('accessToken', data.accessToken);
  localStorage.setItem('refreshToken', data.refreshToken);
  setCurrentUser(data.user);
  return data.user;
}

async function loginWithGoogle(idToken) {
  const res = await fetch(`${API_BASE}/auth/google`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.message || 'Google login failed');
  localStorage.setItem('accessToken', data.accessToken);
  localStorage.setItem('refreshToken', data.refreshToken);
  setCurrentUser(data.user);
  return data.user;
}

async function registerUser(data) {
  const res = await fetch(`${API_BASE}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const result = await res.json();
  if (!result.success) return { ok: false, error: result.message };
  localStorage.setItem('accessToken', result.accessToken);
  localStorage.setItem('refreshToken', result.refreshToken);
  setCurrentUser(result.user);
  return { ok: true, user: result.user };
}

// Demo quick-login (auth.html only)
async function loginAs(role) {
  const emails = {
    student: 'aliyah@university.ac.id',
    pic:     'hendra@university.ac.id',
    faculty: 'sari@university.ac.id',
    superadmin: 'admin@university.ac.id',
  };
  showSSOOverlay('Signing in...');
  try {
    await loginWithEmail(emails[role], 'password');
    window.location.href = 'dashboard.html';
  } catch (err) {
    hideSSOOverlay();
    toast(err.message, 'error');
  }
}

async function findUser(email, password) {
  try {
    return await loginWithEmail(email, password);
  } catch { return null; }
}

// ═══════════════════════════════════════════════════════════
// COMPETITIONS API
// ═══════════════════════════════════════════════════════════

// Cache for current page — avoids redundant API calls
let _competitionsCache = null;

async function getCompetitions(params = {}) {
  const query = new URLSearchParams(params).toString();
  const res = await apiFetch(`/competitions${query ? '?' + query : ''}`);
  const data = await res.json();
  if (!data.success) { console.error('getCompetitions error:', data.message); return []; }
  _competitionsCache = data.data;
  return data.data;
}

async function getCompetition(id) {
  const res = await apiFetch(`/competitions/${id}`);
  const data = await res.json();
  if (!data.success) return null;
  return data.data;
}

async function saveCompetition(payload, existingId = null, files = []) {
  const formData = new FormData();

  // Append all JSON fields
  Object.entries(payload).forEach(([k, v]) => {
    if (Array.isArray(v)) {
      v.forEach(item => formData.append(k, item));
    } else if (v !== null && v !== undefined) {
      formData.append(k, v);
    }
  });

  // Attach files
  files.forEach(file => formData.append('documents', file));

  const res = await apiFetch(
    existingId ? `/competitions/${existingId}` : '/competitions',
    { method: existingId ? 'PUT' : 'POST', body: formData }
  );
  const data = await res.json();
  if (!data.success) throw new Error(data.message);
  return data.data;
}

async function approveCompetition(id, type) {
  const res = await apiFetch(`/competitions/${id}/approve`, {
    method: 'POST',
    body: JSON.stringify({ type }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.message);
  return data.data;
}

async function rejectCompetition(id, type, note) {
  const res = await apiFetch(`/competitions/${id}/reject`, {
    method: 'POST',
    body: JSON.stringify({ type, note }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.message);
  return data;
}

async function reportAchievementAPI(id, payload, files = []) {
  const formData = new FormData();
  Object.entries(payload).forEach(([k, v]) => v !== undefined && formData.append(k, v));
  files.forEach(f => formData.append('documents', f));
  const res = await apiFetch(`/competitions/${id}/achievement`, { method: 'POST', body: formData });
  const data = await res.json();
  if (!data.success) throw new Error(data.message);
  return data;
}

async function deleteCompetition(id) {
  const res = await apiFetch(`/competitions/${id}`, { method: 'DELETE' });
  const data = await res.json();
  if (!data.success) throw new Error(data.message);
  return data;
}

// ═══════════════════════════════════════════════════════════
// NOTIFICATIONS API
// ═══════════════════════════════════════════════════════════

async function getMyNotifications() {
  try {
    const res = await apiFetch('/notifications');
    const data = await res.json();
    return data.success ? data.data : [];
  } catch { return []; }
}

async function getUnreadCount() {
  try {
    const res = await apiFetch('/notifications');
    const data = await res.json();
    return data.success ? data.unreadCount : 0;
  } catch { return 0; }
}

async function markNotificationRead(id) {
  await apiFetch(`/notifications/${id}/read`, { method: 'PATCH' });
}

async function markAllNotificationsRead() {
  await apiFetch('/notifications/all/read', { method: 'PATCH' });
}

// ── Compatibility shims for pages that call old functions ──
function getNotifReadSet() { return new Set(); }
function saveNotifReadSet() {}

// ═══════════════════════════════════════════════════════════
// ACTIVITY LOG API
// ═══════════════════════════════════════════════════════════

async function getActivityLog() {
  try {
    const res = await apiFetch('/activity-log');
    const data = await res.json();
    return data.success ? data.data : [];
  } catch { return []; }
}

// logActivity is now handled server-side automatically.
// This shim exists so existing page code doesn't break.
function logActivity(action, detail) {
  // No-op: backend logs all actions automatically
}

// ═══════════════════════════════════════════════════════════
// ANALYTICS API
// ═══════════════════════════════════════════════════════════

async function getAnalytics() {
  const res = await apiFetch('/analytics');
  const data = await res.json();
  if (!data.success) throw new Error(data.message);
  return data.data;
}

// ═══════════════════════════════════════════════════════════
// USERS API (superadmin)
// ═══════════════════════════════════════════════════════════

async function getAllUsers() {
  const res = await apiFetch('/users');
  const data = await res.json();
  return data.success ? data.data : [];
}

async function updateUserRole(userId, role) {
  const res = await apiFetch(`/users/${userId}/role`, {
    method: 'PATCH',
    body: JSON.stringify({ role }),
  });
  return (await res.json());
}

async function toggleUserActive(userId) {
  const res = await apiFetch(`/users/${userId}/toggle`, { method: 'PATCH' });
  return (await res.json());
}

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════

function formatFunding(val) {
  const n = Number(val) || 0;
  return n.toLocaleString('id-ID');
}

function formatDate(val, showTime = false) {
  if (!val) return '—';
  const d = new Date(val);
  if (isNaN(d)) return val;
  const date = d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
  if (!showTime) return date;
  const time = d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  return `${date}, ${time}`;
}

function statusLabel(s) {
  return {
    draft: 'Draft', submitted: 'Submitted', pic_approved: 'PIC Approved',
    pic_rejected: 'PIC Rejected', faculty_approved: 'Faculty Approved',
    faculty_rejected: 'Faculty Rejected', letter_generated: 'Letter Generated',
    completed: 'Completed',
  }[s] || s;
}

function roleLabel(r) {
  return { student: 'Student', pic: 'PIC Major', faculty: 'Faculty Admin', superadmin: 'Super Admin' }[r] || r;
}

function memberName(nim) {
  const u = Object.values(USERS).find(u => u.nim === nim);
  return u ? u.name : nim;
}

function getUserKey(user) {
  return Object.keys(USERS).find(k => USERS[k].name === user.name) || 'student';
}

function relativeTime(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 2)  return 'Just now';
  if (mins < 60) return `${mins} minutes ago`;
  if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  if (days < 7)  return `${days} day${days > 1 ? 's' : ''} ago`;
  return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

// ═══════════════════════════════════════════════════════════
// APPROVAL ACTIONS (used by multiple pages)
// ═══════════════════════════════════════════════════════════

async function doApprove(id, type) {
  // Prevent double-click — disable every approve button on the page
  document.querySelectorAll('[onclick*="doApprove"]').forEach(b => { b.disabled = true; b.style.opacity = '0.6'; });
  try {
    await approveCompetition(id, type);
    const label = type === 'pic' ? 'PIC' : 'Faculty';
    toast(`${label} Approval successful ✓`, 'success');
    closeModalDirect();
    if (typeof renderPage === 'function') renderPage();
  } catch (err) {
    toast(err.message || 'Approval failed', 'error');
    // Re-enable buttons on failure
    document.querySelectorAll('[onclick*="doApprove"]').forEach(b => { b.disabled = false; b.style.opacity = ''; });
  }
}

function openRejectModal(id, type) {
  const label = type === 'pic' ? 'PIC' : 'Faculty';
  openModal(`Reject Submission (${label})`, `
  <p style="color:var(--text2);margin-bottom:16px">Provide a reason for rejection. The student will be notified.</p>
  <div class="form-group">
    <label>Rejection Notes *</label>
    <textarea id="reject-note" placeholder="e.g. Supporting documents are incomplete..."></textarea>
  </div>`,
  `<button class="btn btn-ghost" onclick="closeModalDirect()">Cancel</button>
   <button class="btn btn-danger" onclick="doReject('${id}','${type}')">Confirm Reject</button>`);
}

async function doReject(id, type) {
  const note = document.getElementById('reject-note')?.value?.trim();
  if (!note) { toast('Please provide rejection notes', 'error'); return; }
  try {
    await rejectCompetition(id, type, note);
    toast('Submission rejected with notes', 'info');
    closeModalDirect();
    if (typeof renderPage === 'function') renderPage();
  } catch (err) {
    toast(err.message || 'Rejection failed', 'error');
  }
}

// ═══════════════════════════════════════════════════════════
// DETAIL MODAL (shared across pages)
// ═══════════════════════════════════════════════════════════

async function viewDetail(id, user) {
  // Show loading state in modal immediately
  openModal('Loading…', '<div style="text-align:center;padding:40px;color:var(--text3)">⏳ Loading details...</div>', '');

  const comp = await getCompetition(id);
  if (!comp) { toast('Competition not found', 'error'); closeModalDirect(); return; }

  const canPICApprove  = user.role === 'pic' && comp.status === 'submitted';
  const canFacultyAct  = (user.role === 'faculty' || user.role === 'superadmin') && comp.status === 'pic_approved';

  document.getElementById('modal-title').textContent = comp.name;
  document.getElementById('modal-body').innerHTML = `
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">
    ${[
      ['Competition ID', comp.id],
      ['Organizer', comp.organizer],
      ['Level', `<span class="level-badge level-${comp.level}">${comp.level}</span>`],
      ['Category', comp.category],
      ['Start Date', formatDate(comp.date_start || comp.dateStart)],
      ['End Date',   formatDate(comp.date_end   || comp.dateEnd)],
      ['Funding Request', `IDR ${formatFunding(comp.funding)}`],
      ['Exemption', comp.exemption ? '✅ Required' : 'Not required'],
      ['Status', `<span class="status status-${comp.status}">${statusLabel(comp.status)}</span>`],
      ['Submitted At', formatDate(comp.submitted_at || comp.submittedAt, true)],
      ['Major', comp.major],
    ].map(([k, v]) => `
    <div>
      <div style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px">${k}</div>
      <div style="font-size:13px;color:var(--text)">${v}</div>
    </div>`).join('')}
  </div>
  <div style="margin-bottom:20px">
    <div style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">Team Members</div>
    <div class="member-tags">
      ${(comp.members || []).map(nim => `<div class="member-tag">${memberName(nim)} ${nim === comp.leader ? '👑' : ''}</div>`).join('')}
    </div>
  </div>
  ${comp.proposal_link || comp.proposalLink ? `<div style="margin-bottom:20px">
    <div style="font-size:11px;color:var(--text3);text-transform:uppercase;margin-bottom:4px">Proposal</div>
    <a href="${comp.proposal_link || comp.proposalLink}" target="_blank" style="color:var(--accent);font-size:13px">${comp.proposal_link || comp.proposalLink}</a>
  </div>` : ''}
  ${comp.pic_note || comp.picNote ? `<div style="margin-bottom:16px;background:rgba(255,92,106,0.1);border:1px solid rgba(255,92,106,0.3);border-radius:8px;padding:12px">
    <div style="font-size:11px;color:var(--danger);margin-bottom:4px;font-weight:600">PIC REJECTION NOTE</div>
    <div style="font-size:13px;color:var(--text2)">${comp.pic_note || comp.picNote}</div>
  </div>` : ''}
  ${comp.achievement ? `<div style="margin-bottom:16px;background:rgba(46,204,138,0.1);border:1px solid rgba(46,204,138,0.3);border-radius:8px;padding:12px">
    <div style="font-size:11px;color:var(--success);margin-bottom:4px;font-weight:600">ACHIEVEMENT</div>
    <div style="font-size:13px;color:var(--text)">${comp.achievement.result} · Reported: ${formatDate(comp.achievement.reported_at || comp.achievement.reportedAt)}</div>
  </div>` : ''}
  <div>
    <div style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">Status History</div>
    <div class="timeline">
      ${(comp.history || []).map((h, i) => `
      <div class="timeline-item ${i < comp.history.length - 1 ? 'done' : 'current'} ${h.status?.includes('rejected') ? 'rejected' : ''}">
        <div class="timeline-label">${statusLabel(h.status)} — ${h.actor || h.actor_name}</div>
        <div class="timeline-date">${h.date ? formatDate(h.date, true) : ''}${h.note ? ' · ' + h.note : ''}</div>
      </div>`).join('')}
    </div>
  </div>`;

  document.getElementById('modal-footer').innerHTML =
    canPICApprove ? `
      <button class="btn btn-ghost" onclick="closeModalDirect()">Close</button>
      <button class="btn btn-danger btn-sm" onclick="closeModalDirect();openRejectModal('${id}','pic')">Reject</button>
      <button class="btn btn-success" onclick="doApprove('${id}','pic')">PIC Approve</button>
    ` : canFacultyAct ? `
      <button class="btn btn-ghost" onclick="closeModalDirect()">Close</button>
      <button class="btn btn-danger btn-sm" onclick="closeModalDirect();openRejectModal('${id}','faculty')">Reject</button>
      <button class="btn btn-success" onclick="doApprove('${id}','faculty')">Faculty Approve ${comp.exemption ? '+ Letter' : ''}</button>
    ` : `
      ${comp.letter_generated || comp.letterGenerated ? `<button class="btn btn-accent" onclick="closeModalDirect();downloadLetter('${id}')">📄 Download Letter</button>` : ''}
      <button class="btn btn-ghost" onclick="closeModalDirect()">Close</button>
    `;
}

// ═══════════════════════════════════════════════════════════
// EXEMPTION LETTER (PDF generation — unchanged, client-side)
// ═══════════════════════════════════════════════════════════

async function downloadLetter(id) {
  const comp = await getCompetition(id);
  if (!comp) return;
  const leader = Object.values(USERS).find(u => u.nim === (comp.leader_nim || comp.leader));
  const today = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
  const nomorSurat = `UXY/FTI/DISP/${comp.id.replace('COMP-', '')}/${new Date().getFullYear()}`;

  openModal('Surat Exemption – ' + comp.id, `
  <div class="pdf-preview">
    <div class="pdf-header">
      <div class="pdf-logo-text">UNIVERSITAS XYZ</div>
      <div class="pdf-subtitle">Fakultas Teknologi dan Informatika</div>
      <div class="pdf-subtitle">Jl. Universitas No. 1, Kota ABC, Indonesia</div>
    </div>
    <div class="pdf-title">SURAT DISPENSASI MAHASISWA</div>
    <div class="pdf-number">Nomor: ${nomorSurat}</div>
    <div class="pdf-body">
      <p>Yang bertanda tangan di bawah ini, Dekan Fakultas Teknologi dan Informatika Universitas XYZ, dengan ini memberikan exemption kepada:</p>
      <table style="width:100%;margin-bottom:16px;font-size:13px">
        <tr><td style="width:160px">Nama</td><td>: <span class="pdf-underline">${leader?.name || comp.leader_nim || comp.leader}</span></td></tr>
        <tr><td>NIM</td><td>: <span class="pdf-underline">${comp.leader_nim || comp.leader}</span></td></tr>
        <tr><td>Program Studi</td><td>: <span class="pdf-underline">${comp.major}</span></td></tr>
        <tr><td>Kegiatan</td><td>: <span class="pdf-underline">${comp.name}</span></td></tr>
        <tr><td>Penyelenggara</td><td>: <span class="pdf-underline">${comp.organizer}</span></td></tr>
        <tr><td>Tanggal</td><td>: <span class="pdf-underline">${formatDate(comp.date_start || comp.dateStart)} s.d. ${formatDate(comp.date_end || comp.dateEnd)}</span></td></tr>
      </table>
      <p>Mahasiswa yang bersangkutan diizinkan untuk tidak menghadiri perkuliahan selama kegiatan berlangsung.</p>
      <p>Demikian exemption letter ini dibuat untuk dapat dipergunakan sebagaimana mestinya.</p>
    </div>
    <div class="pdf-sig">
      <div>
        <div>${today}</div>
        <div>Dekan Fakultas Teknologi dan Informatika</div>
        <div class="pdf-sig-line">Prof. Sari Lestari, Ph.D.<br>NIP. 123456789</div>
      </div>
    </div>
  </div>`,
  `<button class="btn btn-ghost" onclick="closeModalDirect()">Tutup</button>
   <button class="btn btn-primary" onclick="generatePDF('${id}')">⬇ Download PDF</button>`);
}

async function generatePDF(id) {
  const comp = await getCompetition(id);
  if (!comp) return;

  function doGenerate() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageW = 210, marginL = 25, marginR = 25, contentW = pageW - marginL - marginR;
    const leader = Object.values(USERS).find(u => u.nim === (comp.leader_nim || comp.leader));
    const leaderName = leader?.name || comp.leader_nim || comp.leader;
    const today = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
    const nomorSurat = `UXY/FTI/DISP/${comp.id.replace('COMP-', '')}/${new Date().getFullYear()}`;
    let y = 18;

    doc.setFont('times', 'bold'); doc.setFontSize(16);
    doc.text('UNIVERSITAS XYZ', pageW / 2, y, { align: 'center' }); y += 7;
    doc.setFont('times', 'normal'); doc.setFontSize(11);
    doc.text('Fakultas Teknologi dan Informatika', pageW / 2, y, { align: 'center' }); y += 5;
    doc.text('Jl. Universitas No. 1, Kota ABC, Indonesia', pageW / 2, y, { align: 'center' }); y += 6;
    doc.setLineWidth(1); doc.line(marginL, y, pageW - marginR, y); y += 1;
    doc.setLineWidth(0.3); doc.line(marginL, y, pageW - marginR, y); y += 10;
    doc.setFont('times', 'bold'); doc.setFontSize(13);
    doc.text('SURAT DISPENSASI MAHASISWA', pageW / 2, y, { align: 'center' }); y += 6;
    doc.setFont('times', 'normal'); doc.setFontSize(11);
    doc.text(`Nomor: ${nomorSurat}`, pageW / 2, y, { align: 'center' }); y += 12;

    const pembuka = 'Yang bertanda tangan di bawah ini, Dekan Fakultas Teknologi dan Informatika Universitas XYZ, dengan ini memberikan exemption kepada:';
    const lines = doc.splitTextToSize(pembuka, contentW);
    doc.text(lines, marginL, y); y += lines.length * 6 + 6;

    const labelX = marginL + 5, colonX = marginL + 50, valueX = marginL + 55;
    [
      ['Nama', leaderName],
      ['NIM', comp.leader_nim || comp.leader],
      ['Program Studi', comp.major],
      ['Kegiatan', comp.name],
      ['Penyelenggara', comp.organizer],
      ['Tanggal', `${formatDate(comp.date_start || comp.dateStart)} s.d. ${formatDate(comp.date_end || comp.dateEnd)}`],
    ].forEach(([label, value]) => {
      doc.text(label, labelX, y); doc.text(':', colonX, y);
      const vLines = doc.splitTextToSize(value, contentW - 55);
      doc.text(vLines, valueX, y);
      doc.setLineWidth(0.2); doc.line(valueX, y + 1, valueX + doc.getTextWidth(vLines[0]) + 4, y + 1);
      y += vLines.length * 6 + 2;
    });
    y += 8;

    const isi = 'Mahasiswa yang bersangkutan diizinkan untuk tidak menghadiri perkuliahan selama kegiatan berlangsung. Mahasiswa diwajibkan untuk berkoordinasi dengan dosen pengampu masing-masing mata kuliah.';
    const isiLines = doc.splitTextToSize(isi, contentW);
    doc.text(isiLines, marginL, y); y += isiLines.length * 6 + 6;
    const isi2Lines = doc.splitTextToSize('Demikian exemption letter ini dibuat untuk dapat dipergunakan sebagaimana mestinya.', contentW);
    doc.text(isi2Lines, marginL, y); y += isi2Lines.length * 6 + 16;

    const sigX = pageW - marginR - 60;
    doc.text(today, sigX, y, { align: 'center' }); y += 6;
    doc.text('Dekan Fakultas Teknologi dan Informatika', sigX, y, { align: 'center' }); y += 36;
    doc.setFont('times', 'bold');
    doc.text('Prof. Sari Lestari, Ph.D.', sigX, y, { align: 'center' });
    doc.setFont('times', 'normal'); y += 5;
    doc.text('NIP. 123456789', sigX, y, { align: 'center' });
    doc.setLineWidth(0.3); doc.line(sigX - 45, y - 10, sigX + 45, y - 10);

    doc.save(`Surat-Exemption-${comp.id}-${comp.leader_nim || comp.leader}.pdf`);
    toast('Surat Exemption berhasil didownload! 📄', 'success');
    closeModalDirect();
  }

  if (window.jspdf) {
    doGenerate();
  } else {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
    script.onload = doGenerate;
    script.onerror = () => toast('Gagal memuat library PDF', 'error');
    document.head.appendChild(script);
  }
}

// ═══════════════════════════════════════════════════════════
// SIDEBAR
// ═══════════════════════════════════════════════════════════

const NAV_CONFIG = {
  student: [
    { section: 'Main', items: [
      { icon: '📊', label: 'Dashboard',          href: 'dashboard.html' },
      { icon: '📝', label: 'My Submissions',     href: 'submissions.html' },
      { icon: '🏅', label: 'Achievement Report', href: 'achievement.html' },
      { icon: '🔔', label: 'Notifications',      href: 'notifications.html' },
    ]},
    { section: 'Account', items: [
      { icon: '👤', label: 'My Profile',         href: 'profile.html' },
    ]},
  ],
  pic: [
    { section: 'Main', items: [
      { icon: '📊', label: 'Dashboard',          href: 'dashboard.html' },
      { icon: '📋', label: 'Pending Approvals',  href: 'approvals.html' },
      { icon: '📁', label: 'All Submissions',    href: 'all-submissions.html' },
      { icon: '🔔', label: 'Notifications',      href: 'notifications.html' },
    ]},
    { section: 'Account', items: [
      { icon: '👤', label: 'My Profile',         href: 'profile.html' },
    ]},
  ],
  faculty: [
    { section: 'Main', items: [
      { icon: '📊', label: 'Dashboard',          href: 'dashboard.html' },
      { icon: '📋', label: 'Faculty Review',     href: 'faculty-review.html' },
      { icon: '📁', label: 'All Submissions',    href: 'all-submissions.html' },
      { icon: '🔔', label: 'Notifications',      href: 'notifications.html' },
    ]},
    { section: 'Reports', items: [
      { icon: '📈', label: 'Analytics',          href: 'analytics.html' },
      { icon: '📤', label: 'Export Data',        href: 'export.html' },
    ]},
    { section: 'Account', items: [
      { icon: '👤', label: 'My Profile',         href: 'profile.html' },
    ]},
  ],
  superadmin: [
    { section: 'Main', items: [
      { icon: '📊', label: 'Dashboard',          href: 'dashboard.html' },
      { icon: '📁', label: 'All Submissions',    href: 'all-submissions.html' },
      { icon: '👥', label: 'User Management',    href: 'users.html' },
      { icon: '🔔', label: 'Notifications',      href: 'notifications.html' },
    ]},
    { section: 'Reports', items: [
      { icon: '📈', label: 'Analytics',          href: 'analytics.html' },
      { icon: '📤', label: 'Export Data',        href: 'export.html' },
    ]},
    { section: 'Account', items: [
      { icon: '👤', label: 'My Profile',         href: 'profile.html' },
    ]},
  ],
};

function buildSidebar(activePage, user, unreadCount = 0) {
  const sections = NAV_CONFIG[user.role] || [];
  const navHTML = sections.map(sec => `
    <div class="nav-section">
      <div class="nav-section-label">${sec.section}</div>
      ${sec.items.map(item => {
        const isNotif = item.href === 'notifications.html';
        const badge = isNotif ? unreadCount : 0;
        return `
        <a class="nav-item ${item.href === activePage ? 'active' : ''}" href="${item.href}">
          <span class="nav-icon">${item.icon}</span>
          ${item.label}
          ${badge ? `<span class="badge">${badge}</span>` : ''}
        </a>`;
      }).join('')}
    </div>
  `).join('');

  return `
    <aside class="sidebar">
      <a class="sidebar-header" href="dashboard.html">
        <div class="sidebar-logo">🏆</div>
        <span class="sidebar-name">CompTrack</span>
      </a>
      <nav>${navHTML}</nav>
      <div class="sidebar-footer">
        <div class="user-info">
          <a class="user-avatar" href="profile.html" style="background:${user.color};text-decoration:none" title="View Profile">${user.name.charAt(0)}</a>
          <div class="user-detail">
            <a href="profile.html" class="user-name" style="text-decoration:none">${user.name}</a>
            <div class="user-role">${roleLabel(user.role)}</div>
          </div>
          <button class="logout-btn" onclick="logout()" title="Logout">⏻</button>
        </div>
      </div>
    </aside>`;
}

// Async sidebar initialiser — call this on every page
async function initSidebar(activePage, user) {
  const count = await getUnreadCount();
  document.getElementById('sidebar-wrap').innerHTML = buildSidebar(activePage, user, count);
}

// ═══════════════════════════════════════════════════════════
// TOAST
// ═══════════════════════════════════════════════════════════

function toast(msg, type = 'info') {
  const icons = { success: '✅', error: '❌', info: 'ℹ️' };
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${icons[type] || 'ℹ️'}</span><span>${msg}</span>`;
  container.appendChild(el);
  setTimeout(() => el.classList.add('show'), 10);
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 3500);
}

// ═══════════════════════════════════════════════════════════
// MODAL
// ═══════════════════════════════════════════════════════════

function openModal(title, body, footer = '') {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = body;
  document.getElementById('modal-footer').innerHTML = footer;
  document.getElementById('modal-overlay').classList.add('open');
}
function closeModal(e) {
  if (e.target === document.getElementById('modal-overlay')) closeModalDirect();
}
function closeModalDirect() {
  document.getElementById('modal-overlay').classList.remove('open');
}

const MODAL_HTML = `
<div class="modal-overlay" id="modal-overlay" onclick="closeModal(event)">
  <div class="modal" id="modal">
    <div class="modal-header">
      <h3 class="modal-title" id="modal-title"></h3>
      <button class="modal-close" onclick="closeModalDirect()">✕</button>
    </div>
    <div class="modal-body" id="modal-body"></div>
    <div class="modal-footer" id="modal-footer"></div>
  </div>
</div>`;

// ═══════════════════════════════════════════════════════════
// FILE UPLOAD HELPERS (unchanged)
// ═══════════════════════════════════════════════════════════

function buildFileUploadField(id, label) {
  return `
  <div class="form-group">
    <label>${label}</label>
    <div class="file-drop-zone" id="drop-${id}" onclick="document.getElementById('${id}').click()"
      ondragover="event.preventDefault();this.classList.add('drag-over')"
      ondragleave="this.classList.remove('drag-over')"
      ondrop="handleFileDrop(event,'${id}')">
      <input type="file" id="${id}" accept=".pdf,.jpg,.jpeg,.png" style="display:none"
        onchange="handleFileSelect(this,'drop-${id}')">
      <div class="file-drop-icon">📎</div>
      <div class="file-drop-text">Click or drag file here</div>
      <div class="file-drop-sub">PDF, JPG, PNG accepted</div>
    </div>
    <div class="file-preview" id="preview-${id}" style="display:none"></div>
  </div>`;
}

function handleFileSelect(input, zoneId) {
  const file = input.files[0];
  if (!file) return;
  document.getElementById(zoneId).style.display = 'none';
  const preview = document.getElementById('preview-' + input.id);
  if (preview) {
    preview.style.display = 'flex';
    preview.innerHTML = `
      <div class="file-preview-icon">${file.name.endsWith('.pdf') ? '📄' : '🖼️'}</div>
      <div class="file-preview-info">
        <div class="file-preview-name">${file.name}</div>
        <div class="file-preview-size">${(file.size / 1024).toFixed(1)} KB</div>
      </div>
      <button class="file-preview-remove" onclick="removeFile('${input.id}','${zoneId}')">✕</button>`;
  }
}

function handleFileDrop(event, inputId) {
  event.preventDefault();
  event.currentTarget.classList.remove('drag-over');
  const file = event.dataTransfer.files[0];
  if (!file) return;
  const input = document.getElementById(inputId);
  const dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;
  handleFileSelect(input, 'drop-' + inputId);
}

function removeFile(inputId, zoneId) {
  const input = document.getElementById(inputId);
  if (input) input.value = '';
  const zone = document.getElementById(zoneId);
  if (zone) zone.style.display = '';
  const preview = document.getElementById('preview-' + inputId);
  if (preview) { preview.style.display = 'none'; preview.innerHTML = ''; }
}

// ═══════════════════════════════════════════════════════════
// SSO OVERLAY (auth.html)
// ═══════════════════════════════════════════════════════════

function showSSOOverlay(text) {
  const el = document.getElementById('sso-overlay');
  const txt = document.getElementById('sso-overlay-text');
  if (el) el.classList.add('show');
  if (txt) txt.textContent = text;
}
function hideSSOOverlay() {
  const el = document.getElementById('sso-overlay');
  if (el) el.classList.remove('show');
}