// src/controllers/userController.js
const bcrypt = require('bcryptjs');
const { pool } = require('../config/db');

// ── GET /api/users  (superadmin only) ────────────────────
async function getAll(req, res, next) {
  try {
    const [rows] = await pool.query(
      'SELECT id, name, email, nim, major, role, color, avatar_url, is_active, created_at FROM users ORDER BY created_at DESC'
    );
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
}

// ── PATCH /api/users/:id/role  (superadmin only) ─────────
async function updateRole(req, res, next) {
  try {
    const { role } = req.body;
    const validRoles = ['student', 'pic', 'faculty', 'superadmin'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ success: false, message: 'Invalid role' });
    }
    await pool.query('UPDATE users SET role = ? WHERE id = ?', [role, req.params.id]);
    res.json({ success: true, message: 'Role updated' });
  } catch (err) { next(err); }
}

// ── PATCH /api/users/:id/toggle  (superadmin only) ───────
async function toggleActive(req, res, next) {
  try {
    const [rows] = await pool.query('SELECT is_active FROM users WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ success: false, message: 'User not found' });
    const newState = rows[0].is_active ? 0 : 1;
    await pool.query('UPDATE users SET is_active = ? WHERE id = ?', [newState, req.params.id]);
    res.json({ success: true, message: newState ? 'Account activated' : 'Account deactivated' });
  } catch (err) { next(err); }
}

module.exports = { getAll, updateRole, toggleActive };


// ════════════════════════════════════════════════════
// src/controllers/notificationController.js
// ════════════════════════════════════════════════════
async function getNotifications(req, res, next) {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 100',
      [req.user.id]
    );
    const unreadCount = rows.filter(n => !n.is_read).length;
    res.json({ success: true, data: rows, unreadCount });
  } catch (err) { next(err); }
}

async function markRead(req, res, next) {
  try {
    const { id } = req.params;
    if (id === 'all') {
      await pool.query('UPDATE notifications SET is_read = 1 WHERE user_id = ?', [req.user.id]);
    } else {
      await pool.query('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?', [id, req.user.id]);
    }
    res.json({ success: true });
  } catch (err) { next(err); }
}

module.exports.notif = { getNotifications, markRead };


// ════════════════════════════════════════════════════
// src/controllers/analyticsController.js
// ════════════════════════════════════════════════════
async function getAnalytics(req, res, next) {
  try {
    // Rejected statuses should not count toward funding
    const activeStatuses = `('submitted','pic_approved','faculty_approved','letter_generated','completed')`;

    const [[totals]] = await pool.query(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'submitted' THEN 1 ELSE 0 END) as pending_pic,
        SUM(CASE WHEN status = 'pic_approved' THEN 1 ELSE 0 END) as pending_faculty,
        SUM(CASE WHEN status IN ${activeStatuses} THEN funding ELSE 0 END) as total_funding
      FROM competitions
    `);

    const [byMajor] = await pool.query(`
      SELECT major, COUNT(*) as count,
        SUM(CASE WHEN status IN ${activeStatuses} THEN funding ELSE 0 END) as funding
      FROM competitions GROUP BY major ORDER BY count DESC
    `);

    const [byLevel] = await pool.query(`
      SELECT level, COUNT(*) as count,
        SUM(CASE WHEN status IN ${activeStatuses} THEN funding ELSE 0 END) as funding
      FROM competitions GROUP BY level
    `);

    const [byStatus] = await pool.query(`
      SELECT status, COUNT(*) as count FROM competitions GROUP BY status
    `);

    const [winners] = await pool.query(`
      SELECT COUNT(*) as count FROM achievements WHERE result = 'Winner'
    `);

    const [monthly] = await pool.query(`
      SELECT DATE_FORMAT(created_at, '%Y-%m') as month, COUNT(*) as count
      FROM competitions
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
      GROUP BY month ORDER BY month ASC
    `);

    res.json({
      success: true,
      data: {
        totals: { ...totals, winners: winners[0].count },
        byMajor,
        byLevel,
        byStatus,
        monthly,
      }
    });
  } catch (err) { next(err); }
}

module.exports.analytics = { getAnalytics };


// ════════════════════════════════════════════════════
// src/controllers/exportController.js
// ════════════════════════════════════════════════════
async function exportData(req, res, next) {
  try {
    const { type } = req.params; // all-submissions | achievements | funding | kpi | letters | activity-log
    let rows;

    if (type === 'all-submissions') {
      [rows] = await pool.query(`
        SELECT c.id, c.name, c.organizer, c.level, c.category, c.status,
               c.funding, c.exemption, c.major, c.submitted_at,
               u.name as submitted_by_name
        FROM competitions c
        LEFT JOIN users u ON c.submitted_by = u.id
        ORDER BY c.created_at DESC
      `);
    } else if (type === 'achievements') {
      [rows] = await pool.query(`
        SELECT c.id, c.name, c.major, c.level, a.result, a.certificate, a.documentation, a.reported_at
        FROM achievements a
        JOIN competitions c ON a.competition_id = c.id
        ORDER BY a.reported_at DESC
      `);
    } else if (type === 'funding') {
      [rows] = await pool.query(`
        SELECT id, name, major, level, funding, status FROM competitions ORDER BY funding DESC
      `);
    } else if (type === 'kpi') {
      [rows] = await pool.query(`
        SELECT major,
          COUNT(*) as total,
          SUM(CASE WHEN status IN ('faculty_approved','completed') THEN 1 ELSE 0 END) as approved,
          SUM(CASE WHEN status LIKE '%rejected%' THEN 1 ELSE 0 END) as rejected,
          SUM(CASE WHEN status = 'submitted' THEN 1 ELSE 0 END) as pending,
          SUM(funding) as total_funding
        FROM competitions GROUP BY major
      `);
    } else if (type === 'letters') {
      [rows] = await pool.query(`
        SELECT c.id, c.name, c.leader_nim, c.major,
               h.created_at as generated_date
        FROM competitions c
        LEFT JOIN competition_history h ON c.id = h.competition_id AND h.status = 'letter_generated'
        WHERE c.letter_generated = 1
      `);
    } else if (type === 'activity-log') {
      [rows] = await pool.query(`
        SELECT created_at as timestamp, user_name, user_email, user_role, action, detail
        FROM activity_log ORDER BY created_at DESC LIMIT 1000
      `);
    } else {
      return res.status(400).json({ success: false, message: 'Invalid export type' });
    }

    // Build CSV
    if (!rows.length) return res.json({ success: true, data: [], csv: '' });

    const headers = Object.keys(rows[0]);
    const csv = [
      headers.join(','),
      ...rows.map(r => headers.map(h => `"${String(r[h] ?? '').replace(/"/g, '""')}"`).join(','))
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="comptrack-${type}.csv"`);
    res.send(csv);
  } catch (err) { next(err); }
}

module.exports.export = { exportData };


// ════════════════════════════════════════════════════
// src/controllers/activityController.js
// ════════════════════════════════════════════════════
async function getActivityLog(req, res, next) {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM activity_log ORDER BY created_at DESC LIMIT 500'
    );
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
}

module.exports.activity = { getActivityLog };