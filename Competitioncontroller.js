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
    'SELECT user_nim, is_leader FROM competition_members WHERE competition_id = ?',
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
    achievement_deadline: comp.achievement_deadline   // DATE string, already 'YYYY-MM-DD' from MySQL
      ? (comp.achievement_deadline instanceof Date
          ? comp.achievement_deadline.toISOString().slice(0, 10)
          : String(comp.achievement_deadline).slice(0, 10))
      : null,
    members: members.map(m => m.user_nim),
    leader: members.find(m => m.is_leader)?.user_nim || null,
    history: history.map(h => {
      return { status: h.status, date: toLocal(h.date), actor: h.actor_name, note: h.note };
    }),
    achievement: achievement[0] || null,
    documents,
  };
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
    const user = req.user;

    // PIC must have a major assigned — a null major is a misconfigured account,
    // not a pass to see everything.
    if (user.role === 'pic' && !user.major) {
      return res.status(403).json({
        success: false,
        message: 'Your PIC account has no major assigned. Contact a superadmin to fix this.',
      });
    }

    let query = 'SELECT c.* FROM competitions c WHERE 1=1';
    const params = [];

    // Students only see their own submissions
    if (user.role === 'student') {
      query += ' AND c.submitted_by = ?';
      params.push(user.id);
    }

    // PIC is scoped to their own major — cannot be overridden by query param
    if (user.role === 'pic') {
      query += ' AND c.major = ?';
      params.push(user.major);
    }

    if (status)  { query += ' AND c.status = ?';             params.push(status); }
    if (level)   { query += ' AND c.level = ?';              params.push(level); }
    // Only non-PIC roles can filter by major (PIC's major is already enforced above)
    if (major && user.role !== 'pic') { query += ' AND c.major = ?'; params.push(major); }
    if (search)  { query += ' AND (c.name LIKE ? OR c.id LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }

    query += ' ORDER BY c.created_at DESC LIMIT ? OFFSET ?';
    params.push(Number(limit), (Number(page) - 1) * Number(limit));

    const [rows] = await pool.query(query, params);
    const competitions = await Promise.all(rows.map(buildCompetition));

    res.json({ success: true, data: competitions, total: competitions.length });
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
            proposalLink, funding, exemption, major, action = 'draft' } = req.body;
    // FormData sends repeated keys — express gives string (1 item) or array (many); normalise to array
    const members = req.body.members
      ? (Array.isArray(req.body.members) ? req.body.members : [req.body.members])
      : [];

    // Generate ID
    const year = new Date().getFullYear();
    const [countRows] = await pool.query('SELECT COUNT(*) as cnt FROM competitions WHERE id LIKE ?', [`COMP-${year}-%`]);
    const count = countRows[0].cnt + 1;
    const id = `COMP-${year}-${String(count).padStart(3, '0')}`;

    const status = action === 'submit' ? 'submitted' : 'draft';
    const submittedAt = action === 'submit' ? localNow() : null;

    await pool.query(
      `INSERT INTO competitions (id, name, organizer, level, category, date_start, date_end,
       leader_nim, proposal_link, funding, exemption, status, submitted_at, major, submitted_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, name, organizer, level, category, dateStart || null, dateEnd || null,
       leader || null, proposalLink || null, funding || 0, exemption ? 1 : 0,
       status, submittedAt, major || user.major, user.id]
    );

    // Members
    if (members.length) {
      const memberRows = members.map(nim => [id, nim, nim === leader ? 1 : 0]);
      await pool.query('INSERT INTO competition_members (competition_id, user_nim, is_leader) VALUES ?', [memberRows]);
    }

    // History
    if (action === 'submit') {
      await pool.query(
        'INSERT INTO competition_history (competition_id, status, actor_name, actor_id) VALUES (?,?,?,?)',
        [id, 'submitted', user.name, user.id]
      );
      // Notify PIC users
      const picIds = await getUsersByRole(['pic', 'superadmin']);
      await pushNotification(picIds, `New submission: "${name}" awaiting PIC review`, '📋', 'approvals.html');
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
            proposalLink, funding, exemption, action = 'draft' } = req.body;
    // FormData sends repeated keys — normalise to array
    const members = req.body.members
      ? (Array.isArray(req.body.members) ? req.body.members : [req.body.members])
      : [];

    const status = action === 'submit' ? 'submitted' : 'draft';
    const submittedAt = action === 'submit' ? localNow() : comp.submitted_at;

    await pool.query(
      `UPDATE competitions SET name=?, organizer=?, level=?, category=?, date_start=?, date_end=?,
       leader_nim=?, proposal_link=?, funding=?, exemption=?, status=?, submitted_at=? WHERE id=?`,
      [name, organizer, level, category, dateStart || null, dateEnd || null,
       leader || null, proposalLink || null, funding || 0, exemption ? 1 : 0,
       status, submittedAt, id]
    );

    // Update members
    await pool.query('DELETE FROM competition_members WHERE competition_id = ?', [id]);
    if (members.length) {
      const memberRows = members.map(nim => [id, nim, nim === leader ? 1 : 0]);
      await pool.query('INSERT INTO competition_members (competition_id, user_nim, is_leader) VALUES ?', [memberRows]);
    }

    if (action === 'submit') {
      await pool.query(
        'INSERT INTO competition_history (competition_id, status, actor_name, actor_id) VALUES (?,?,?,?)',
        [id, 'submitted', user.name, user.id]
      );
      const picIds = await getUsersByRole(['pic', 'superadmin']);
      await pushNotification(picIds, `Resubmitted: "${name}" awaiting PIC review`, '📋', 'approvals.html');
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
    const { type } = req.body; // 'pic' or 'faculty'

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
      await pool.query('UPDATE competitions SET letter_generated = 1 WHERE id = ?', [id]);
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
    const submitterRows = await pool.query('SELECT id FROM users WHERE id = ?', [comp.submitted_by]);
    if (submitterRows[0].length) {
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

    const [rows] = await pool.query('SELECT * FROM competitions WHERE id = ?', [id]);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Not found' });
    const comp = rows[0];

    const newStatus = type === 'pic' ? 'pic_rejected' : 'faculty_rejected';
    const noteField = type === 'pic' ? 'pic_note' : 'faculty_note';

    await pool.query(`UPDATE competitions SET status = ?, ${noteField} = ? WHERE id = ?`, [newStatus, note, id]);
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
