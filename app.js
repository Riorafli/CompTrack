// ═══════════════════════════════════════════════════════════
// CompTrack — app.js  (API-connected version)
// All data calls go to the Express/MySQL backend.
// UI helpers (sidebar, modal, toast, etc.) are unchanged.
// ═══════════════════════════════════════════════════════════

const API_BASE = 'http://localhost:5000/api';

// ── LETTER CONFIG — edit these to match your institution ────
const LETTER_CONFIG = {
  letterCodePrefix: 'UXY/FTI/DISP',          // prefix for letter number, e.g. UXY/FTI/DISP/001/2025
  recipientName:    'Lecturer Services Center (LSC) Kemanggisan', // full name in "Yth." block
  recipientShort:   'LSC',                    // short name used in closing paragraph
  deanName:         'Prof. Sari Lestari, Ph.D.',
  deanTitle:        'Head of Departement Computer Science Jakarta', // label under signature
};

// ── DEMO USERS (kept only for memberName() lookup) ──────────
const USERS = {
  student:    { name: 'Aliyah Rahmawati',   role: 'student',    nim: '20210001', major: 'Computer Science', email: 'aliyah@university.ac.id',  color: '#4f8aff' },
  student2:   { name: 'Bima Prasetyo',      role: 'student',    nim: '20210045', major: 'Computer Science', email: 'bima@university.ac.id',    color: '#7c5cfc' },
  student3:   { name: 'Citra Dewi',         role: 'student',    nim: '20210089', major: 'CS - Software Engineering',    email: 'citra@university.ac.id',   color: '#00d4aa' },
  pic:        { name: 'Dr. Hendra Wijaya',  role: 'pic',        nim: null,       major: 'Computer Science', email: 'hendra@university.ac.id',  color: '#ff8c42' },
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
  if (!data.success) {
    console.error('getCompetitions error:', data.message);
    toast('Failed to load submissions: ' + (data.message || 'Unknown error'), 'error');
    return [];
  }
  if (data.debug) console.log('[DEBUG getCompetitions]', data.debug);
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

  // Append all JSON fields — membersDetail is an array of objects, send as JSON string
  Object.entries(payload).forEach(([k, v]) => {
    if (k === 'membersDetail') {
      formData.append(k, JSON.stringify(v)); // serialize object array properly
    } else if (Array.isArray(v)) {
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
    let count = data.success ? (data.unreadCount || 0) : 0;
    // Also add unread local superadmin notifications (MCR etc.)
    const u = getCurrentUser();
    if (u && u.role === 'superadmin') {
      try {
        const local = JSON.parse(localStorage.getItem('ct_sa_notifs')) || [];
        count += local.filter(n => !n.read).length;
      } catch {}
    }
    return count;
  } catch {
    // Fallback: count local notifications only
    const u = getCurrentUser();
    if (u && u.role === 'superadmin') {
      try {
        const local = JSON.parse(localStorage.getItem('ct_sa_notifs')) || [];
        return local.filter(n => !n.read).length;
      } catch {}
    }
    return 0;
  }
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

function doApprove(id, type) {
  const label = type === 'pic' ? 'PIC' : 'Faculty';
  const icon  = type === 'pic' ? '✅' : '🎓';

  // Try to grab the competition name from the cache or the current modal title
  let compName = '';
  if (_competitionsCache) {
    const cached = _competitionsCache.find(c => c.id === id);
    if (cached) compName = cached.name;
  }
  if (!compName) {
    const modalTitle = document.getElementById('modal-title');
    if (modalTitle && modalTitle.textContent && modalTitle.textContent !== 'Loading…') {
      compName = modalTitle.textContent;
    }
  }

  const nameHtml = compName
    ? `<div style="font-size:13px;color:var(--text);background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:10px 14px;margin:12px 0;font-weight:600">${icon} ${compName}</div>`
    : '';

  const extraNote = type === 'faculty'
    ? `<div style="font-size:12px;color:var(--text3);margin-top:8px">This will notify the student and ${id.includes('exemption') ? 'generate an exemption letter.' : 'update the submission status to Faculty Approved.'}</div>`
    : `<div style="font-size:12px;color:var(--text3);margin-top:8px">This will forward the submission to Faculty for final review.</div>`;

  openModal(
    `Confirm ${label} Approval`,
    `<div style="text-align:center;padding:8px 0 4px">
      <div style="font-size:40px;margin-bottom:8px">${icon}</div>
      <div style="font-size:15px;color:var(--text);font-weight:500">Approve this submission?</div>
      ${nameHtml}
      <div style="font-size:13px;color:var(--text2)">You are granting <strong>${label} Approval</strong> for this competition submission.</div>
      ${extraNote}
    </div>`,
    `<button class="btn btn-ghost" onclick="closeModalDirect()">Cancel</button>
     <button class="btn btn-success" id="confirm-approve-btn" onclick="_executeApprove('${id}','${type}')">Yes, Approve</button>`
  );
}

async function _executeApprove(id, type) {
  const btn = document.getElementById('confirm-approve-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Approving…'; btn.style.opacity = '0.7'; }

  try {
    await approveCompetition(id, type);
    const label = type === 'pic' ? 'PIC' : 'Faculty';
    toast(`${label} Approval successful ✓`, 'success');
    closeModalDirect();
    if (typeof renderPage === 'function') renderPage();
  } catch (err) {
    toast(err.message || 'Approval failed', 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Yes, Approve'; btn.style.opacity = ''; }
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
      ['Submitted By', comp.submitter_name || comp.submitted_by || '—'],
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
      ${((comp.members_detail || []).length
        ? comp.members_detail
        : (comp.members || []).map(nim => ({ nim, name: nim, is_leader: nim === comp.leader }))
       ).map(m => `<div class="member-tag">${m.name}${m.nim !== m.name ? ` <span style="color:var(--text3);font-size:11px">(${m.nim})</span>` : ''} ${m.is_leader ? '👑' : ''}</div>`).join('')}
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
      <button class="btn btn-success" onclick="closeModalDirect();doApprove('${id}','pic')">PIC Approve</button>
    ` : canFacultyAct ? `
      <button class="btn btn-ghost" onclick="closeModalDirect()">Close</button>
      <button class="btn btn-danger btn-sm" onclick="closeModalDirect();openRejectModal('${id}','faculty')">Reject</button>
      <button class="btn btn-success" onclick="closeModalDirect();doApprove('${id}','faculty')">Faculty Approve ${comp.exemption ? '+ Letter' : ''}</button>
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

  // Fetch all members for the member table — prefer members_detail (has name+nim), fall back to members (NIM strings)
  const membersDetail = comp.members_detail && comp.members_detail.length > 0
    ? comp.members_detail
    : (comp.members || []).map(nim => ({ nim, name: nim, is_leader: nim === comp.leader }));
  const today = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
  const nomorSurat = `${LETTER_CONFIG.letterCodePrefix}/${comp.id.replace('COMP-', '')}/${new Date().getFullYear()}`;
  const dateRange = `${formatDate(comp.date_start || comp.dateStart)} s.d. ${formatDate(comp.date_end || comp.dateEnd)}`;

  // Build member rows — leader always first
  // Priority: is_leader flag → leader NIM match → stored leader_name/nim → submitter as fallback
  const leaderNim  = comp.leader || comp.leader_nim || comp.submitter_nim || '-';
  const leaderEntry = membersDetail.find(m => m.is_leader) || membersDetail.find(m => m.nim === leaderNim);
  const leaderName = leaderEntry?.name || comp.leader_name || comp.submitter_name || leaderNim;
  const leaderNimDisplay = leaderEntry?.nim || leaderNim;
  let memberRows = `<tr><td style="border:1px solid #333;padding:4px 8px">${leaderName}</td><td style="border:1px solid #333;padding:4px 8px">${leaderNimDisplay}</td></tr>`;
  const otherMembers = membersDetail.filter(m => m.nim !== leaderNimDisplay && !m.is_leader);
  if (otherMembers.length > 0) {
    otherMembers.forEach(m => {
      memberRows += `<tr><td style="border:1px solid #333;padding:4px 8px">${m.name || m.nim}</td><td style="border:1px solid #333;padding:4px 8px">${m.nim}</td></tr>`;
    });
  }

  openModal('Surat Dispensasi – ' + comp.id, `
  <div class="pdf-preview" style="font-family:'Times New Roman',serif;font-size:13px;line-height:1.6;color:#000;padding:32px 40px;max-width:680px;margin:0 auto">

    <p style="text-align:right;margin:0 0 4px 0">Jakarta, <strong>${today}</strong></p>
    <p style="margin:0">No. &nbsp;&nbsp;: ${nomorSurat}</p>
    <p style="margin:0 0 20px 0">Hal &nbsp;&nbsp;: Permohonan Dispensasi Kuliah</p>

    <p style="margin:0">Yth.</p>
    <p style="margin:0">${LETTER_CONFIG.recipientName}</p>
    <p style="margin:0 0 16px 0">Di Tempat</p>

    <p style="margin:0 0 8px 0">Dengan hormat,</p>
    <p style="text-align:justify;margin:0 0 4px 0">Sehubungan dengan keberhasilan mahasiswa dalam mengikuti lomba <strong>${comp.name}</strong> dan dinyatakan sebagai <strong>${comp.achievement_result || 'Finalist'},</strong> yang akan diselenggarakan pada:</p>
    <p style="margin:0">Hari/Tanggal &nbsp;: <strong>${dateRange}</strong></p>
    <p style="margin:0 0 12px 0">Tempat &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;: <strong>${comp.organizer || '-'}</strong></p>

    <p style="text-align:justify;margin:0 0 12px 0">Maka melalui surat ini kami memohon izin untuk memberikan dispensasi kepada mahasiswa berikut:</p>

    <table style="width:100%;border-collapse:collapse;margin-bottom:16px">
      <tr><td style="border:1px solid #333;padding:4px 8px;font-weight:bold">Nama Lengkap</td><td style="border:1px solid #333;padding:4px 8px;font-weight:bold">NIM</td></tr>
      ${memberRows}
    </table>

    <p style="text-align:justify;margin:0 0 8px 0">Kami sangat menghargai kerja sama dan dukungan dari pihak ${LETTER_CONFIG.recipientShort} dalam mendukung potensi pengembangan mahasiswa.</p>
    <p style="text-align:justify;margin:0 0 24px 0">Demikian surat permohonan ini kami sampaikan. Atas perhatian nya kami mengucapkan terima kasih.</p>

    <p style="margin:0 0 48px 0">Hormat kami,</p>
    <p style="margin:0"><strong><u>${LETTER_CONFIG.deanName}</u></strong></p>
    <p style="margin:0">${LETTER_CONFIG.deanTitle}</p>
  </div>`,
  `<button class="btn btn-ghost" onclick="closeModalDirect()">Tutup</button>
   <button class="btn btn-primary" onclick="generateDOCX('${id}')">⬇ Download Word</button>`);
}

async function generateDOCX(id) {
  const comp = await getCompetition(id);
  if (!comp) return;

  function doGenerate() {
    const {
      Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
      AlignmentType, BorderStyle, WidthType, ShadingType, VerticalAlign,
      UnderlineType
    } = window.docx;

    const today = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
    const nomorSurat = `${LETTER_CONFIG.letterCodePrefix}/${comp.id.replace('COMP-', '')}/${new Date().getFullYear()}`;
    const dateRange = `${formatDate(comp.date_start || comp.dateStart)} s.d. ${formatDate(comp.date_end || comp.dateEnd)}`;

    const membersDetail = comp.members_detail && comp.members_detail.length > 0
      ? comp.members_detail
      : (comp.members || []).map(nim => ({ nim, name: nim, is_leader: nim === comp.leader }));
    const leaderNim     = comp.leader || comp.leader_nim || comp.submitter_nim || '-';
    const leaderEntry   = membersDetail.find(m => m.is_leader) || membersDetail.find(m => m.nim === leaderNim);
    const leaderName    = leaderEntry?.name || comp.leader_name || comp.submitter_name || leaderNim;
    const leaderNimDisp = leaderEntry?.nim  || leaderNim;
    const otherMembers  = membersDetail.filter(m => m.nim !== leaderNimDisp && !m.is_leader);

    // ── Helper: justified paragraph ──────────────────────────
    const justPara = (runs, spacingAfter = 160) => new Paragraph({
      alignment: AlignmentType.JUSTIFIED,
      spacing: { after: spacingAfter },
      children: Array.isArray(runs) ? runs : [runs],
    });

    const normalRun  = (text, opts = {}) => new TextRun({ text, font: 'Times New Roman', size: 22, ...opts });
    const boldRun    = (text)            => normalRun(text, { bold: true });

    // ── Table border helper ───────────────────────────────────
    const cellBorder = { style: BorderStyle.SINGLE, size: 6, color: '000000' };
    const allBorders = { top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder };

    const makeCell = (text, bold = false, isHeader = false) => new TableCell({
      borders: allBorders,
      shading: isHeader ? { fill: 'FFFFFF', type: ShadingType.CLEAR } : { fill: 'FFFFFF', type: ShadingType.CLEAR },
      margins: { top: 60, bottom: 60, left: 100, right: 100 },
      width: { size: 50, type: WidthType.PERCENTAGE },
      children: [new Paragraph({
        children: [normalRun(text, { bold: bold || isHeader })],
      })],
    });

    // ── Member table rows ─────────────────────────────────────
    const tableRows = [
      new TableRow({ children: [makeCell('Nama Lengkap', true, true), makeCell('NIM', true, true)] }),
      new TableRow({ children: [makeCell(leaderName, true), makeCell(leaderNimDisp, true)] }),
      ...otherMembers.map(m => new TableRow({ children: [makeCell(m.name || m.nim), makeCell(m.nim)] })),
    ];

    const memberTable = new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: tableRows,
    });

    // ── Document ──────────────────────────────────────────────
    const doc = new Document({
      sections: [{
        properties: {
          page: {
            size: { width: 11906, height: 16838 }, // A4
            margin: { top: 1418, right: 1134, bottom: 1134, left: 1418 }, // ~2.5cm / 2cm
          },
        },
        children: [
          // Date right-aligned
          new Paragraph({
            alignment: AlignmentType.RIGHT,
            spacing: { after: 0 },
            children: [normalRun(`Jakarta, `), boldRun(today)],
          }),

          // No. / Hal
          new Paragraph({ spacing: { after: 0 }, children: [normalRun(`No.  : ${nomorSurat}`)] }),
          new Paragraph({ spacing: { after: 200 }, children: [normalRun(`Hal  : Permohonan Dispensasi Kuliah`)] }),

          // Recipient
          new Paragraph({ spacing: { after: 0 }, children: [normalRun('Yth.')] }),
          new Paragraph({ spacing: { after: 0 }, children: [normalRun(LETTER_CONFIG.recipientName)] }),
          new Paragraph({ spacing: { after: 200 }, children: [normalRun('Di Tempat')] }),

          // Salutation
          new Paragraph({ spacing: { after: 120 }, children: [normalRun('Dengan hormat,')] }),

          // Body paragraph 1
          justPara([
            normalRun('Sehubungan dengan keberhasilan mahasiswa dalam mengikuti lomba '),
            boldRun(comp.name),
            normalRun(' dan dinyatakan sebagai '),
            boldRun(`${comp.achievement_result || 'Finalist'},`),
            normalRun(' yang akan diselenggarakan pada:'),
          ], 80),

          // Date / Venue
          new Paragraph({ spacing: { after: 0 }, children: [normalRun('Hari/Tanggal\t: '), boldRun(dateRange)] }),
          new Paragraph({ spacing: { after: 160 }, children: [normalRun('Tempat\t\t: '), boldRun(comp.organizer || '-')] }),

          // Body paragraph 2
          justPara(normalRun('Maka melalui surat ini kami memohon izin untuk memberikan dispensasi kepada mahasiswa berikut:'), 120),

          // Member table
          memberTable,

          // Empty spacing after table
          new Paragraph({ spacing: { after: 160 }, children: [] }),

          // Closing paragraphs
          justPara(normalRun(`Kami sangat menghargai kerja sama dan dukungan dari pihak ${LETTER_CONFIG.recipientShort} dalam mendukung potensi pengembangan mahasiswa.`)),
          justPara(normalRun('Demikian surat permohonan ini kami sampaikan. Atas perhatian nya kami mengucapkan terima kasih.')),

          // Sign-off
          new Paragraph({ spacing: { after: 0 }, children: [normalRun('Hormat kami,')] }),
          new Paragraph({ spacing: { after: 0 }, children: [] }),
          new Paragraph({ spacing: { after: 0 }, children: [] }),
          new Paragraph({ spacing: { after: 0 }, children: [] }),

          // Signature name — bold + underline
          new Paragraph({
            spacing: { after: 0 },
            children: [normalRun(LETTER_CONFIG.deanName, { bold: true, underline: { type: UnderlineType.SINGLE } })],
          }),
          new Paragraph({ spacing: { after: 0 }, children: [normalRun(LETTER_CONFIG.deanTitle)] }),
        ],
      }],
    });

    Packer.toBlob(doc).then(blob => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Surat-Dispensasi-${comp.id}.docx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast('Surat Dispensasi berhasil didownload! 📄', 'success');
      closeModalDirect();
    });
  }

  if (window.docx) {
    doGenerate();
  } else {
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/docx@8.5.0/build/index.umd.js';
    script.onload = doGenerate;
    script.onerror = () => toast('Gagal memuat library Word', 'error');
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
