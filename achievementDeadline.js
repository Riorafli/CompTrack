// src/jobs/achievementDeadline.js
// BR-03: Achievement deadline cron job
//
// Called once per day by server.js (default 08:00 server time).
// Two passes every run:
//
//   1. REMINDER  — competitions whose achievement_deadline is exactly
//                  REMINDER_DAYS_BEFORE days away, and where
//                  achievement_deadline_reminded = 0.
//                  → push notification to submitter + PIC/superadmin.
//                  → flip achievement_deadline_reminded = 1 (fires only once).
//
//   2. OVERDUE   — competitions whose achievement_deadline has already passed,
//                  still in faculty_approved / letter_generated status,
//                  and achievement_deadline_reminded = 1 (reminder was sent
//                  but deadline since passed).
//                  → push notification to submitter + faculty/superadmin.
//                  → flip achievement_deadline_reminded = 2 (fires only once).

'use strict';

const { pool } = require('../config/db');

const REMINDER_DAYS_BEFORE = 3; // how many days before deadline to send the warning

// ── helpers ──────────────────────────────────────────────────────────────────

async function pushNotification(userIds, title, icon, link) {
  if (!userIds || !userIds.length) return;
  const values = userIds.map(uid => [uid, title, icon, link]);
  await pool.query(
    'INSERT INTO notifications (user_id, title, icon, link) VALUES ?',
    [values]
  );
}

async function getUsersByRole(roles) {
  const placeholders = roles.map(() => '?').join(',');
  const [rows] = await pool.query(
    `SELECT id FROM users WHERE role IN (${placeholders}) AND is_active = 1`,
    roles
  );
  return rows.map(r => r.id);
}

// ── main job ─────────────────────────────────────────────────────────────────

async function runAchievementDeadlineJob() {
  const jobStart = new Date().toISOString();
  console.log(`[BR-03 cron] Running achievement-deadline job at ${jobStart}`);

  try {
    // ── 1. REMINDER PASS ──────────────────────────────────────────────────
    // Competitions where deadline is exactly REMINDER_DAYS_BEFORE days away,
    // achievement not yet reported, and reminder not yet sent.
    const [reminders] = await pool.query(
      `SELECT id, name, submitted_by, achievement_deadline
         FROM competitions
        WHERE achievement_deadline = DATE_ADD(CURDATE(), INTERVAL ? DAY)
          AND achievement_deadline_reminded = 0
          AND status IN ('faculty_approved', 'letter_generated')`,
      [REMINDER_DAYS_BEFORE]
    );

    for (const comp of reminders) {
      const picAdminIds = await getUsersByRole(['pic', 'superadmin']);
      const notifyIds   = [...new Set([comp.submitted_by, ...picAdminIds])];

      await pushNotification(
        notifyIds,
        `⏰ Reminder: Achievement report for "${comp.name}" is due in ${REMINDER_DAYS_BEFORE} days (${comp.achievement_deadline})`,
        '⏰',
        'achievement.html'
      );

      // Mark reminder sent so it doesn't fire again
      await pool.query(
        'UPDATE competitions SET achievement_deadline_reminded = 1 WHERE id = ?',
        [comp.id]
      );

      console.log(`[BR-03 cron]  Reminder sent  → ${comp.id} "${comp.name}" (due ${comp.achievement_deadline})`);
    }

    // ── 2. OVERDUE PASS ───────────────────────────────────────────────────
    // Competitions past their deadline, achievement still not reported,
    // and reminder was already sent (reminded = 1) — overdue notice fires once.
    const [overdues] = await pool.query(
      `SELECT id, name, submitted_by, achievement_deadline
         FROM competitions
        WHERE achievement_deadline < CURDATE()
          AND achievement_deadline_reminded = 1
          AND status IN ('faculty_approved', 'letter_generated')`
    );

    for (const comp of overdues) {
      const facultyAdminIds = await getUsersByRole(['faculty', 'superadmin']);
      const notifyIds       = [...new Set([comp.submitted_by, ...facultyAdminIds])];

      await pushNotification(
        notifyIds,
        `🚨 Overdue: Achievement report for "${comp.name}" was due on ${comp.achievement_deadline} — not yet submitted`,
        '🚨',
        'achievement.html'
      );

      // Set flag to 2 so this overdue notice only fires once per competition
      await pool.query(
        'UPDATE competitions SET achievement_deadline_reminded = 2 WHERE id = ?',
        [comp.id]
      );

      console.log(`[BR-03 cron]  Overdue notice → ${comp.id} "${comp.name}" (was due ${comp.achievement_deadline})`);
    }

    console.log(
      `[BR-03 cron] Done — ${reminders.length} reminder(s), ${overdues.length} overdue notice(s) sent.`
    );
  } catch (err) {
    console.error('[BR-03 cron] Error in achievement-deadline job:', err.message);
  }
}

module.exports = { runAchievementDeadlineJob };