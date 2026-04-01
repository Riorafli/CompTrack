const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     process.env.DB_PORT     || 3306,
  user:     process.env.DB_USER     || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME     || 'comptrack',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  timezone: '+07:00',
});

// ── Auto-migration: add columns that may be missing on existing databases ──
// Each entry is safe to run repeatedly — uses IF NOT EXISTS / column-check approach.
async function runMigrations(conn) {
  const db = process.env.DB_NAME || 'comptrack';

  const migrations = [
    // member_name: store manually-entered member names in competition_members
    {
      label: 'competition_members.member_name',
      check: `SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = '${db}' AND TABLE_NAME = 'competition_members'
              AND COLUMN_NAME = 'member_name'`,
      sql: `ALTER TABLE competition_members ADD COLUMN member_name VARCHAR(100) AFTER user_nim`,
    },
    // leader_name: display name for letter when leader is not a registered user
    {
      label: 'leader_name',
      check: `SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = '${db}' AND TABLE_NAME = 'competitions'
              AND COLUMN_NAME = 'leader_name'`,
      sql: `ALTER TABLE competitions ADD COLUMN leader_name VARCHAR(100) AFTER leader_nim`,
    },
    // BR-03: achievement deadline
    {
      label: 'achievement_deadline',
      check: `SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = '${db}' AND TABLE_NAME = 'competitions'
              AND COLUMN_NAME = 'achievement_deadline'`,
      sql: `ALTER TABLE competitions
            ADD COLUMN achievement_deadline DATE AFTER submitted_at`,
    },
    {
      label: 'achievement_deadline_reminded',
      check: `SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = '${db}' AND TABLE_NAME = 'competitions'
              AND COLUMN_NAME = 'achievement_deadline_reminded'`,
      sql: `ALTER TABLE competitions
            ADD COLUMN achievement_deadline_reminded TINYINT(1) NOT NULL DEFAULT 0
            AFTER achievement_deadline`,
    },
  ];

  for (const m of migrations) {
    const [[row]] = await conn.query(m.check);
    if (row.cnt === 0) {
      await conn.query(m.sql);
      console.log(`✅  Migration applied: added column '${m.label}'`);
    }
  }

  // Backfill deadline for already-approved competitions that have date_end set
  await conn.query(`
    UPDATE competitions
       SET achievement_deadline = DATE_ADD(date_end, INTERVAL ? DAY)
     WHERE date_end IS NOT NULL
       AND achievement_deadline IS NULL
       AND status IN ('faculty_approved','letter_generated','completed')
  `, [Number(process.env.ACHIEVEMENT_DEADLINE_DAYS) || 30]);
}

async function testConnection() {
  try {
    const conn = await pool.getConnection();
    console.log('✅  MySQL connected successfully');
    await runMigrations(conn);
    conn.release();
  } catch (err) {
    console.error('❌  MySQL connection failed:', err.message);
    process.exit(1);
  }
}

module.exports = { pool, testConnection };
