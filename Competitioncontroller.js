// src/controllers/competitionController.js
const { pool } = require('../config/db');

// Returns current local datetime as 'YYYY-MM-DD HH:MM:SS' (respects server TZ)
function localNow(dateOnly = false) {
  const n = new Date();
  const pad = x => String(x).padStart(2, '0');
  const date = `${n.getFullYear()}-${pad(n.getMonth()+1)}-${pad(n.getDate())}`;
  if (dateOnly) return date;
  return `${date} ${pad(n.getHours())}:${pad(n.getMinutes())}:${pad(n.getSeconds())}`;
}

// ── Helper: build full competition object ────────────────
async function buildCompetition(comp) {
  const [members] = await pool.query(
    `SELECT cm.user_nim, cm.member_name, cm.is_leader, u.name as user_name
     FROM competition_members cm
     LEFT JOIN users u ON u.nim = cm.user_nim
     WHERE cm.competition_id = ?`,
    [comp.id]
  );
  const [history] = await pool.query(
    'SELECT status, actor_name, actor_id, note, created_at as date FROM competition_history WHERE competition_id = ? ORDER BY created_at ASC',
    [comp.id]
  );
  const [achievement] = await pool.query(
    'SELECT * FROM achievements WHERE competition_id = ?',
    [comp.id]
  );
  const [documents] = await pool.query(
    'SELECT id, file_name, file_path, file_type, file_size, doc_type, created_at FROM documents WHERE competition_id = ?',
    [comp.id]
  );
  // Fetch submitter name
  const [submitterRows] = await pool.query(
    'SELECT name, nim FROM users WHERE id = ?',
    [comp.submitted_by]
  );
  const submitter = submitterRows[0] || null;

  const toLocal = (d) => {
    if (!d) return null;
    const dt = d instanceof Date ? d : new Date(d);
    if (isNaN(dt.getTime())) return null;
    // mysql2 with timezone:'+07:00' returns Date objects in local time already
    // Just format directly without offset adjustment
    const pad = n => String(n).padStart(2, '0');
    return `${dt.getFullYear()}-${pad(dt.getMonth()+1)}-${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`;
  };

  return {
    ...comp,
    submitted_at: toLocal(comp.submitted_at),
    achievement_deadline: comp.achievement_deadline
      ? (comp.achievement_deadline instanceof Date
          ? comp.achievement_deadline.toISOString().slice(0, 10)
          : String(comp.achievement_deadline).slice(0, 10))
      : null,
    submitter_name: submitter?.name || null,
    submitter_nim:  submitter?.nim  || null,
    members: members.map(m => m.user_nim),
    members_detail: members.map(m => ({ nim: m.user_nim, name: m.user_name || m.member_name || m.user_nim, is_leader: !!m.is_leader })),
    leader: members.find(m => m.is_leader)?.user_nim || null,
    leader_name: members.find(m => m.is_leader)?.user_name || members.find(m => m.is_leader)?.member_name || comp.leader_name || null,
    history: history.map(h => {
      return { status: h.status, date: toLocal(h.date), actor: h.actor_name, note: h.note };
    }),
    achievement: achievement[0] || null,
    documents,
  };
}

// ── FR-03: Shared input validator for POST and PUT /competitions ─────────────
// Returns an array of error strings; empty array = valid.
// Rules applied on every call (draft + submit):
//   • name        — must not be blank when provided
//   • level       — must be one of the three DB enum values when provided
//   • funding     — must be a non-negative integer when provided
//   • dateEnd     — must not precede dateStart when both are provided
//   • action      — must be 'draft' or 'submit'
// Additional rules only when action === 'submit':
//   • name, organizer, level, category — all required and non-blank
// ── FR-03: Shared input validator for POST and PUT /competitions ─────────────
// Returns an array of error strings; empty array = valid.
// Rules applied on every call (draft + submit):
//   • name        — must not be blank/absent when provided
//   • level       — must be one of the three DB enum values when provided
//   • funding     — must be a non-negative integer when provided
//   • dateEnd     — must not precede dateStart when both are provided
//   • action      — must be 'draft' or 'submit'
// Additional rules only when action === 'submit':
//   • name, organizer, level, category — all required and non-blank
//   • each member entry must have a non-blank NIM (or name for unregistered members)
function isBlank(v) {
  // Treat undefined, null, empty string, and whitespace-only as blank
  return v === undefined || v === null || String(v).trim() === '';
}

function validateCompetitionInput({ name, organizer, level, category, dateStart, dateEnd, funding, action, membersDetail }) {
  const errors = [];
  const VALID_LEVELS  = ['regional', 'national', 'international'];
  const VALID_ACTIONS = ['draft', 'submit'];

  // ── action must be a known value ─────────────────────────
  if (action !== undefined && !VALID_ACTIONS.includes(action)) {
    errors.push(`action must be "draft" or "submit" (got: "${action}")`);
  }

  // ── name must not be blank when the field is present ─────
  // isBlank catches: undefined, null, '', '   ', or the literal string 'undefined'
  // We only error if the caller DID send the field (i.e. it is not undefined) but it is blank.
  if (name !== undefined && isBlank(name)) {
    errors.push('name must not be blank');
  }

  // ── level must be one of the enum values when provided ────
  if (!isBlank(level)) {
    if (!VALID_LEVELS.includes(String(level).trim().toLowerCase())) {
      errors.push(`level must be one of: ${VALID_LEVELS.join(', ')} (got: "${level}")`);
    }
  }

  // ── funding must be a non-negative finite integer ─────────
  if (!isBlank(funding)) {
    const f = Number(funding);
    if (!Number.isFinite(f) || f < 0) {
      errors.push(`funding must be a non-negative number (got: "${funding}")`);
    }
  }

  // ── dateEnd must not be before dateStart ──────────────────
  if (!isBlank(dateStart) && !isBlank(dateEnd)) {
    if (new Date(dateEnd) < new Date(dateStart)) {
      errors.push('dateEnd must not be earlier than dateStart');
    }
  }

  // ── submit-only rules ─────────────────────────────────────
  const effectiveAction = VALID_ACTIONS.includes(action) ? action : 'draft';
  if (effectiveAction === 'submit') {
    // Required fields must be present and non-blank
    const required = { name, organizer, level, category };
    const missing = Object.entries(required)
      .filter(([, v]) => isBlank(v))
      .map(([k]) => k);
    if (missing.length) {
      errors.push(`required fields missing or blank on submit: ${missing.join(', ')}`);
    }

    // Each member entry must have a non-blank NIM; if unregistered, a non-blank name is required
    if (Array.isArray(membersDetail)) {
      membersDetail.forEach((m, i) => {
        if (isBlank(m?.nim)) {
          errors.push(`member[${i}]: NIM must not be blank`);
        }
        // Unregistered members (nim === name) must supply an actual name, not just the NIM repeated
        if (!isBlank(m?.nim) && isBlank(m?.name)) {
          errors.push(`member[${i}] (NIM: ${m.nim}): name must not be blank`);
        }
      });
    }
  }

  return errors;
}

async function logActivity(userId, user, action, detail) {
  await pool.query(
    'INSERT INTO activity_log (user_id, user_name, user_email, user_role, action, detail) VALUES (?,?,?,?,?,?)',
    [userId, user?.name, user?.email, user?.role, action, detail]
  );
}

async function pushNotification(userIds, title, icon, link) {
  if (!userIds.length) return;
  const values = userIds.map(uid => [uid, title, icon, link]);
  await pool.query(
    'INSERT INTO notifications (user_id, title, icon, link) VALUES ?',
    [values]
  );
}

async function getUsersByRole(roles) {
  const [rows] = await pool.query(
    `SELECT id FROM users WHERE role IN (${roles.map(() => '?').join(',')}) AND is_active = 1`,
    roles
  );
  return rows.map(r => r.id);
}

// ── GET /api/competitions ─────────────────────────────────
async function getAll(req, res, next) {
  try {
    const { status, level, major, search, page = 1, limit = 50 } = req.query;
    const parsedPage  = Math.max(1, Number(page)  || 1);
    const parsedLimit = Math.max(1, Math.min(200, Number(limit) || 50)); // cap at 200 per page
    const user = req.user;

    // ── Build shared WHERE clause (reused for COUNT and data query) ──
    let where = 'WHERE 1=1';
    const whereParams = [];

    // Students only see their own submissions
    if (user.role === 'student') {
      where += ' AND c.submitted_by = ?';
      whereParams.push(user.id);
    }

    // PIC: scope to their major only. If PIC has no major, they see all.
    if (user.role === 'pic' && user.major) {
      const picMajor = user.major.trim();
      // Bidirectional prefix match:
      // 1. comp.major = picMajor exactly
      // 2. comp.major starts with picMajor + " -" (more specific variant)
      // 3. picMajor starts with comp.major + " -" (PIC is more specific than comp)
      where += " AND (LOWER(c.major) = LOWER(?) OR LOWER(c.major) LIKE LOWER(?) OR LOWER(?) LIKE CONCAT(LOWER(c.major), ' -%'))";
      whereParams.push(picMajor, picMajor + ' -%', picMajor);
    }

    if (status) { where += ' AND c.status = ?';                           whereParams.push(status); }
    if (level)  { where += ' AND c.level = ?';                            whereParams.push(level); }
    if (major && user.role !== 'pic') { where += ' AND c.major = ?';      whereParams.push(major); }
    if (search) { where += ' AND (c.name LIKE ? OR c.id LIKE ?)';         whereParams.push(`%${search}%`, `%${search}%`); }

    // ── FR-12: COUNT total rows matching the filters (no LIMIT/OFFSET) ──
    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM competitions c ${where}`,
      whereParams
    );

    // ── Fetch the current page of data ────────────────────────────────
    const dataQuery = `SELECT c.* FROM competitions c ${where} ORDER BY c.created_at DESC LIMIT ? OFFSET ?`;
    const dataParams = [...whereParams, parsedLimit, (parsedPage - 1) * parsedLimit];

    const [rows] = await pool.query(dataQuery, dataParams);
    const competitions = await Promise.all(rows.map(buildCompetition));

    const totalPages = Math.ceil(total / parsedLimit);

    res.json({
      success: true,
      data: competitions,
      // FR-12: pagination meta — total is the count of ALL matching rows,
      // not just the rows returned on this page.
      pagination: {
        total,           // total matching rows across all pages
        page: parsedPage,
        limit: parsedLimit,
        totalPages,
      },
      // Keep top-level `total` for any existing frontend code that reads it directly,
      // but now it correctly reflects the full dataset count.
      total,
    });
  } catch (err) {
    next(err);
  }
}

// ── GET /api/competitions/:id ─────────────────────────────
async function getOne(req, res, next) {
  try {
    const [rows] = await pool.query('SELECT * FROM competitions WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Competition not found' });

    const comp = await buildCompetition(rows[0]);

    // Students can only view their own
    if (req.user.role === 'student' && rows[0].submitted_by !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }
    // PICs can only view competitions that match their major (or if PIC has no major, they see all)
    if (req.user.role === 'pic' && req.user.major && rows[0].major) {
      const picMajor  = req.user.major.trim().toLowerCase();
      const compMajor = rows[0].major.toLowerCase();
      if (compMajor !== picMajor && !compMajor.startsWith(picMajor + ' -') && !picMajor.startsWith(compMajor + ' -')) {
        return res.status(403).json({ success: false, message: 'Access denied' });
      }
    }
    res.json({ success: true, data: comp });
  } catch (err) {
    next(err);
  }
}

// ── POST /api/competitions ────────────────────────────────
async function create(req, res, next) {
  try {
    const user = req.user;
    const { name, organizer, level, category, dateStart, dateEnd, leader,
            leaderName, proposalLink, funding, exemption, major, action = 'draft' } = req.body;

    // FormData sends repeated keys — express gives string (1 item) or array (many); normalise to array
    const members = req.body.members
      ? (Array.isArray(req.body.members) ? req.body.members : [req.body.members])
      : [];

    // Parse membersDetail JSON early so we can pass it to the validator
    const membersDetailRaw = req.body.membersDetail;
    let membersDetailParsed = [];
    try { membersDetailParsed = membersDetailRaw ? JSON.parse(membersDetailRaw) : []; } catch(e) {}

    // ── FR-03: centralised server-side validation ─────────────
    const validationErrors = validateCompetitionInput({ name, organizer, level, category, dateStart, dateEnd, funding, action, membersDetail: membersDetailParsed });
    if (validationErrors.length) {
      return res.status(400).json({ success: false, message: validationErrors.join('; ') });
    }
    // ─────────────────────────────────────────────────────────

    const parsedFunding = Number(funding);
    const safeFunding = isBlank(funding) ? 0 : Math.max(0, Math.floor(parsedFunding));

    const status = action === 'submit' ? 'submitted' : 'draft';
    const submittedAt = action === 'submit' ? localNow() : null;

    // Use major from form body first, fall back to the user's profile major from DB
    let resolvedMajor = (major && major.trim()) ? major.trim() : (user.major || null);
    // Extra safety: if still null, query the DB directly for this user's major
    if (!resolvedMajor) {
      const [userRows] = await pool.query('SELECT major FROM users WHERE id = ?', [user.id]);
      resolvedMajor = userRows[0]?.major || null;
    }

    // FR-03 fix: generate ID and INSERT atomically inside a transaction with
    // a SELECT ... FOR UPDATE lock so concurrent requests can never produce
    // the same sequence number.
    const year = new Date().getFullYear();
    const conn = await pool.getConnection();
    let id;
    try {
      await conn.beginTransaction();

      // Lock the highest existing ID for this year so no other transaction
      // can read or insert until we commit.
      const [maxRows] = await conn.query(
        `SELECT id FROM competitions WHERE id LIKE ? ORDER BY id DESC LIMIT 1 FOR UPDATE`,
        [`COMP-${year}-%`]
      );
      let seq = 1;
      if (maxRows.length) {
        const lastSeq = parseInt(maxRows[0].id.split('-')[2], 10);
        if (!isNaN(lastSeq)) seq = lastSeq + 1;
      }
      id = `COMP-${year}-${String(seq).padStart(3, '0')}`;

      await conn.query(
        `INSERT INTO competitions (id, name, organizer, level, category, date_start, date_end,
         leader_nim, leader_name, proposal_link, funding, exemption, status, submitted_at, major, submitted_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [id, name, organizer, level, category, dateStart || null, dateEnd || null,
         leader || null, leaderName || null, proposalLink || null, safeFunding, exemption ? 1 : 0,
         status, submittedAt, resolvedMajor, user.id]
      );

      await conn.commit();
    } catch (txErr) {
      await conn.rollback();
      throw txErr;
    } finally {
      conn.release();
    }

    // Build full member set: start with leader (always is_leader=1), then add other members
    const allNims = new Set();
    const memberRows = [];

    // Always insert leader first
    if (leader) {
      allNims.add(leader);
      memberRows.push([id, leader, leaderName || null, 1]);
    }

    // Insert other members — strip blank NIM entries; normalise member name
    members
      .filter(nim => nim && String(nim).trim() !== '' && !allNims.has(nim))
      .forEach(nim => {
        allNims.add(nim);
        const detail = membersDetailParsed.find(d => d.nim === nim);
        const rawName = detail?.name ? String(detail.name).trim() : '';
        // Only store a name when it is non-blank and different from the NIM itself
        const mName = rawName !== '' && rawName !== nim ? rawName : null;
        memberRows.push([id, nim, mName, 0]);
      });

    if (memberRows.length) {
      await pool.query('INSERT INTO competition_members (competition_id, user_nim, member_name, is_leader) VALUES ?', [memberRows]);
    }

    // History
    if (action === 'submit') {
      await pool.query(
        'INSERT INTO competition_history (competition_id, status, actor_name, actor_id) VALUES (?,?,?,?)',
        [id, 'submitted', user.name, user.id]
      );
      // Notify only PICs whose major matches the submission (or PICs with no major = see all),
      // plus superadmins who always see everything
      let picRecipients;
      if (resolvedMajor) {
        // Match PICs whose major equals the submission major exactly OR is the base prefix.
        // e.g. PIC major "Computer Science" should match submission major "Computer Science"
        // and also "Computer Science - Global Class" etc.
        const baseMajor = resolvedMajor.includes(' - ')
          ? resolvedMajor.split(' - ')[0].trim()
          : resolvedMajor;
        const [matchedPics] = await pool.query(
          `SELECT id FROM users WHERE role = 'pic' AND is_active = 1
           AND (LOWER(major) = LOWER(?) OR LOWER(major) = LOWER(?)
                OR major IS NULL OR major = '')`,
          [resolvedMajor, baseMajor]
        );
        const [superadmins] = await pool.query(
          `SELECT id FROM users WHERE role = 'superadmin' AND is_active = 1`
        );
        picRecipients = [...matchedPics, ...superadmins].map(r => r.id);
      } else {
        picRecipients = await getUsersByRole(['pic', 'superadmin']);
      }
      await pushNotification(picRecipients, `New submission: "${name}" awaiting PIC review`, '📋', 'approvals.html');
      await logActivity(user.id, user, 'Submission Created', `New submission: "${name}" (${id})`);
    } else {
      await logActivity(user.id, user, 'Draft Saved', `Draft saved: "${name}" (${id})`);
    }

    const [rows] = await pool.query('SELECT * FROM competitions WHERE id = ?', [id]);
    const comp = await buildCompetition(rows[0]);
    res.status(201).json({ success: true, message: action === 'submit' ? 'Submitted successfully' : 'Draft saved', data: comp });
  } catch (err) {
    next(err);
  }
}

// ── PUT /api/competitions/:id ─────────────────────────────
async function update(req, res, next) {
  try {
    const user = req.user;
    const { id } = req.params;
    const [existing] = await pool.query('SELECT * FROM competitions WHERE id = ?', [id]);
    if (!existing.length) return res.status(404).json({ success: false, message: 'Not found' });

    const comp = existing[0];
    if (comp.submitted_by !== user.id) {
      return res.status(403).json({ success: false, message: 'You can only edit your own submissions' });
    }
    if (!['draft', 'pic_rejected'].includes(comp.status)) {
      return res.status(400).json({ success: false, message: `Cannot edit a submission with status: ${comp.status}` });
    }

    const { name, organizer, level, category, dateStart, dateEnd, leader,
            leaderName, proposalLink, funding, exemption, major, action = 'draft' } = req.body;

    // FormData sends repeated keys — normalise to array
    const members = req.body.members
      ? (Array.isArray(req.body.members) ? req.body.members : [req.body.members])
      : [];

    // Parse membersDetail JSON early so we can pass it to the validator
    const membersDetailRaw = req.body.membersDetail;
    let membersDetailParsed = [];
    try { membersDetailParsed = membersDetailRaw ? JSON.parse(membersDetailRaw) : []; } catch(e) {}

    // ── FR-03: centralised server-side validation ─────────────
    const validationErrors = validateCompetitionInput({ name, organizer, level, category, dateStart, dateEnd, funding, action, membersDetail: membersDetailParsed });
    if (validationErrors.length) {
      return res.status(400).json({ success: false, message: validationErrors.join('; ') });
    }
    // ─────────────────────────────────────────────────────────

    const parsedFunding = Number(funding);
    const safeFunding = isBlank(funding) ? 0 : Math.max(0, Math.floor(parsedFunding));

    // Use major from form body first, fall back to existing value then user profile from DB
    let resolvedMajor = (major && major.trim()) ? major.trim() : (comp.major || user.major || null);
    // Extra safety: if still null, query the DB directly for this user's major
    if (!resolvedMajor) {
      const [userRows] = await pool.query('SELECT major FROM users WHERE id = ?', [user.id]);
      resolvedMajor = userRows[0]?.major || null;
    }

    const status = action === 'submit' ? 'submitted' : 'draft';
    const submittedAt = action === 'submit' ? localNow() : comp.submitted_at;

    await pool.query(
      `UPDATE competitions SET name=?, organizer=?, level=?, category=?, date_start=?, date_end=?,
       leader_nim=?, leader_name=?, proposal_link=?, funding=?, exemption=?, status=?, submitted_at=?, major=? WHERE id=?`,
      [name, organizer, level, category, dateStart || null, dateEnd || null,
       leader || null, leaderName || null, proposalLink || null, safeFunding, exemption ? 1 : 0,
       status, submittedAt, resolvedMajor, id]
    );

    // Build full member set: start with leader (always is_leader=1), then add other members
    const allNims = new Set();
    const memberRows = [];

    if (leader) {
      allNims.add(leader);
      memberRows.push([id, leader, leaderName || null, 1]);
    }

    // Strip blank NIM entries; normalise member name
    members
      .filter(nim => nim && String(nim).trim() !== '' && !allNims.has(nim))
      .forEach(nim => {
        allNims.add(nim);
        const detail = membersDetailParsed.find(d => d.nim === nim);
        const rawName = detail?.name ? String(detail.name).trim() : '';
        const mName = rawName !== '' && rawName !== nim ? rawName : null;
        memberRows.push([id, nim, mName, 0]);
      });

    await pool.query('DELETE FROM competition_members WHERE competition_id = ?', [id]);
    if (memberRows.length) {
      await pool.query('INSERT INTO competition_members (competition_id, user_nim, member_name, is_leader) VALUES ?', [memberRows]);
    }

    if (action === 'submit') {
      await pool.query(
        'INSERT INTO competition_history (competition_id, status, actor_name, actor_id) VALUES (?,?,?,?)',
        [id, 'submitted', user.name, user.id]
      );
      // Notify only PICs whose major matches, plus superadmins
      let picRecipients;
      if (resolvedMajor) {
        const baseMajor = resolvedMajor.includes(' - ')
          ? resolvedMajor.split(' - ')[0].trim()
          : resolvedMajor;
        const [matchedPics] = await pool.query(
          `SELECT id FROM users WHERE role = 'pic' AND is_active = 1
           AND (LOWER(major) = LOWER(?) OR LOWER(major) = LOWER(?)
                OR major IS NULL OR major = '')`,
          [resolvedMajor, baseMajor]
        );
        const [superadmins] = await pool.query(
          `SELECT id FROM users WHERE role = 'superadmin' AND is_active = 1`
        );
        picRecipients = [...matchedPics, ...superadmins].map(r => r.id);
      } else {
        picRecipients = await getUsersByRole(['pic', 'superadmin']);
      }
      await pushNotification(picRecipients, `Resubmitted: "${name}" awaiting PIC review`, '📋', 'approvals.html');
    }

    await logActivity(user.id, user, 'Submission Updated', `Updated: "${name}" (${id})`);
    const [rows] = await pool.query('SELECT * FROM competitions WHERE id = ?', [id]);
    const updated = await buildCompetition(rows[0]);
    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
}

// ── POST /api/competitions/:id/approve ───────────────────
async function approve(req, res, next) {
  try {
    const user = req.user;
    const { id } = req.params;
    const { type } = req.body; // must be exactly 'pic' or 'faculty'

    // FR-05: validate type before any status logic — reject unknown values immediately
    if (type !== 'pic' && type !== 'faculty') {
      return res.status(400).json({
        success: false,
        message: 'Invalid approval type. Must be "pic" or "faculty".',
      });
    }

    const [rows] = await pool.query('SELECT * FROM competitions WHERE id = ?', [id]);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Not found' });
    const comp = rows[0];

    // Validate transition — also handle idempotent case (already at target status)
    const targetStatus = type === 'pic' ? 'pic_approved' : 'faculty_approved';
    if (comp.status === targetStatus) {
      // Already approved — return current state without error (idempotent)
      const [already] = await pool.query('SELECT * FROM competitions WHERE id = ?', [id]);
      const full = await buildCompetition(already[0]);
      return res.json({ success: true, message: `Already ${type === 'pic' ? 'PIC' : 'Faculty'} approved`, data: full });
    }
    if (type === 'pic' && comp.status !== 'submitted') {
      return res.status(400).json({ success: false, message: `Submission must be in "submitted" status (current: ${comp.status})` });
    }
    if (type === 'faculty' && comp.status !== 'pic_approved') {
      return res.status(400).json({ success: false, message: `Submission must be PIC-approved first (current: ${comp.status})` });
    }

    const date = localNow(true);
    const newStatus = type === 'pic' ? 'pic_approved' : 'faculty_approved';

    await pool.query('UPDATE competitions SET status = ? WHERE id = ?', [newStatus, id]);
    await pool.query(
      'INSERT INTO competition_history (competition_id, status, actor_name, actor_id) VALUES (?,?,?,?)',
      [id, newStatus, user.name, user.id]
    );

    // Generate exemption letter if faculty approves + exemption needed
    if (type === 'faculty' && comp.exemption) {
      await pool.query('UPDATE competitions SET letter_generated = 1, status = ? WHERE id = ?', ['letter_generated', id]);
      await pool.query(
        'INSERT INTO competition_history (competition_id, status, actor_name, actor_id) VALUES (?,?,?,?)',
        [id, 'letter_generated', 'System', null]
      );
    }

    // BR-03: set achievement_deadline on faculty approval
    if (type === 'faculty' && comp.date_end) {
      const deadlineDays = Number(process.env.ACHIEVEMENT_DEADLINE_DAYS) || 30;
      await pool.query(
        'UPDATE competitions SET achievement_deadline = DATE_ADD(date_end, INTERVAL ? DAY) WHERE id = ?',
        [deadlineDays, id]
      );
    }

    // Notify submitter
    const [submitterRows] = await pool.query('SELECT id FROM users WHERE id = ?', [comp.submitted_by]);
    if (submitterRows.length) {
      const msg = type === 'pic'
        ? `Your submission "${comp.name}" was approved by PIC ✅`
        : `Your submission "${comp.name}" received Faculty approval! 🎉`;
      await pushNotification([comp.submitted_by], msg, type === 'pic' ? '✅' : '🎉', 'submissions.html');
    }

    if (type === 'pic') {
      const facultyIds = await getUsersByRole(['faculty', 'superadmin']);
      await pushNotification(facultyIds, `"${comp.name}" is PIC approved — awaiting Faculty review`, '✅', 'faculty-review.html');
    }

    await logActivity(user.id, user,
      type === 'pic' ? 'PIC Approved' : `Faculty Approved${comp.exemption ? ' + Letter' : ''}`,
      `${type === 'pic' ? 'PIC' : 'Faculty'} approved: "${comp.name}" (${id})`
    );

    const [updated] = await pool.query('SELECT * FROM competitions WHERE id = ?', [id]);
    const full = await buildCompetition(updated[0]);
    res.json({ success: true, message: `${type === 'pic' ? 'PIC' : 'Faculty'} approval successful`, data: full });
  } catch (err) {
    next(err);
  }
}

// ── POST /api/competitions/:id/reject ────────────────────
async function reject(req, res, next) {
  try {
    const user = req.user;
    const { id } = req.params;
    const { type, note } = req.body;

    if (!note) return res.status(400).json({ success: false, message: 'Rejection note is required' });

    // FR-05 fix: strictly whitelist `type` before it influences any SQL.
    // An unsanitised noteField interpolated into the query string is a direct
    // SQL injection vector — this guard ensures only known-safe literals ever
    // appear in the UPDATE template.
    if (type !== 'pic' && type !== 'faculty') {
      return res.status(400).json({ success: false, message: 'Invalid rejection type' });
    }

    const [rows] = await pool.query('SELECT * FROM competitions WHERE id = ?', [id]);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Not found' });
    const comp = rows[0];

    // Column names are now hard-coded literals — nothing from the request
    // ever reaches the SQL template string.
    const newStatus = type === 'pic' ? 'pic_rejected' : 'faculty_rejected';
    if (type === 'pic') {
      await pool.query('UPDATE competitions SET status = ?, pic_note = ? WHERE id = ?', [newStatus, note, id]);
    } else {
      await pool.query('UPDATE competitions SET status = ?, faculty_note = ? WHERE id = ?', [newStatus, note, id]);
    }
    await pool.query(
      'INSERT INTO competition_history (competition_id, status, actor_name, actor_id, note) VALUES (?,?,?,?,?)',
      [id, newStatus, user.name, user.id, note]
    );

    await pushNotification(
      [comp.submitted_by],
      `Your submission "${comp.name}" was rejected by ${type === 'pic' ? 'PIC' : 'Faculty'}: ${note}`,
      '❌', 'submissions.html'
    );
    await logActivity(user.id, user, `${type === 'pic' ? 'PIC' : 'Faculty'} Rejected`,
      `Rejected: "${comp.name}" (${id}) — "${note}"`);

    res.json({ success: true, message: 'Submission rejected' });
  } catch (err) {
    next(err);
  }
}

// ── POST /api/competitions/:id/achievement ───────────────
async function reportAchievement(req, res, next) {
  try {
    const user = req.user;
    const { id } = req.params;
    const { result, notes } = req.body;
    const certFile = req.files?.certificate?.[0] || null;
    const docFile  = req.files?.documentation?.[0] || null;

    if (!result) return res.status(400).json({ success: false, message: 'Final result is required' });

    const [rows] = await pool.query('SELECT * FROM competitions WHERE id = ?', [id]);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Not found' });
    const comp = rows[0];

    if (comp.submitted_by !== user.id && user.role === 'student') {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    // FR-09 fix: achievement can only be reported after faculty approval.
    // Allowed statuses are 'faculty_approved' (approved but not yet reported)
    // and 'letter_generated' (letter already issued — re-reporting is valid).
    const ALLOWED_FOR_ACHIEVEMENT = ['faculty_approved', 'letter_generated'];
    if (!ALLOWED_FOR_ACHIEVEMENT.includes(comp.status)) {
      return res.status(400).json({
        success: false,
        message: `Achievement can only be reported after Faculty approval. Current status: "${comp.status}".`,
      });
    }

    // BR-03: enforce achievement deadline
    if (comp.achievement_deadline) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const deadline = new Date(comp.achievement_deadline);
      deadline.setHours(0, 0, 0, 0);
      if (today > deadline) {
        return res.status(400).json({
          success: false,
          message: `Achievement reporting deadline has passed (was ${comp.achievement_deadline}). Please contact your PIC or Faculty.`,
        });
      }
    }

    // Save uploaded files to documents table
    if (certFile) {
      await pool.query(
        'INSERT INTO documents (competition_id, file_name, file_path, file_type, file_size, doc_type) VALUES (?,?,?,?,?,?)',
        [id, certFile.originalname, certFile.filename, certFile.mimetype, certFile.size, 'certificate']
      );
    }
    if (docFile) {
      await pool.query(
        'INSERT INTO documents (competition_id, file_name, file_path, file_type, file_size, doc_type) VALUES (?,?,?,?,?,?)',
        [id, docFile.originalname, docFile.filename, docFile.mimetype, docFile.size, 'documentation']
      );
    }

    const reportedAt = localNow(true);
    await pool.query(
      `INSERT INTO achievements (competition_id, result, certificate, documentation, notes, reported_at)
       VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE result=?, certificate=?, documentation=?, notes=?, reported_at=?`,
      [id, result, certFile ? 1 : 0, docFile ? 1 : 0, notes || null, reportedAt,
           result, certFile ? 1 : 0, docFile ? 1 : 0, notes || null, reportedAt]
    );
    await pool.query("UPDATE competitions SET status = 'completed' WHERE id = ?", [id]);
    await pool.query(
      'INSERT INTO competition_history (competition_id, status, actor_name, actor_id) VALUES (?,?,?,?)',
      [id, 'completed', user.name, user.id]
    );

    const adminIds = await getUsersByRole(['faculty', 'superadmin']);
    await pushNotification(adminIds, `Achievement reported for "${comp.name}"`, '🏅', 'achievement.html');
    await logActivity(user.id, user, 'Achievement Reported', `Result: ${result} — "${comp.name}" (${id})`);

    res.json({ success: true, message: 'Achievement reported successfully' });
  } catch (err) {
    next(err);
  }
}

// ── DELETE /api/competitions/:id ─────────────────────────
async function remove(req, res, next) {
  try {
    const user = req.user;
    const { id } = req.params;
    const [rows] = await pool.query('SELECT * FROM competitions WHERE id = ?', [id]);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Not found' });
    const comp = rows[0];

    if (comp.submitted_by !== user.id && user.role !== 'superadmin') {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }
    if (!['draft', 'pic_rejected'].includes(comp.status)) {
      return res.status(400).json({ success: false, message: 'Only drafts or rejected submissions can be deleted' });
    }

    await pool.query('DELETE FROM competitions WHERE id = ?', [id]);
    await logActivity(user.id, user, 'Submission Deleted', `Deleted: "${comp.name}" (${id})`);
    res.json({ success: true, message: 'Competition deleted' });
  } catch (err) {
    next(err);
  }
}

module.exports = { getAll, getOne, create, update, approve, reject, reportAchievement, remove };
