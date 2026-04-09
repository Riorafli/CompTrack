// Run ONCE to fix existing competitions that have wrong/mismatched major
// node fix_majors.js
require('dotenv').config();
const mysql = require('mysql2/promise');

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'comptrack',
  });

  // Fix competitions where major IS NULL — set it from the submitter's profile major
  const [fixed] = await conn.query(`
    UPDATE competitions c
    JOIN users u ON c.submitted_by = u.id
    SET c.major = u.major
    WHERE c.major IS NULL AND u.major IS NOT NULL
  `);
  console.log(`Fixed ${fixed.affectedRows} competitions with NULL major`);

  // Show current state
  const [comps] = await conn.query(
    'SELECT id, name, status, major, submitted_by FROM competitions ORDER BY created_at DESC LIMIT 10'
  );
  console.log('\n=== Current competitions ===');
  console.table(comps);

  const [users] = await conn.query('SELECT id, name, role, major FROM users');
  console.log('\n=== Users ===');
  console.table(users);

  // Show what each PIC sees now
  for (const u of users.filter(u => u.role === 'pic')) {
    const [rows] = await conn.query(
      'SELECT id, name, status, major FROM competitions WHERE (LOWER(major) = LOWER(?) OR major IS NULL) AND status = "submitted"',
      [u.major]
    );
    console.log(`\nPIC: ${u.name} | major="${u.major}" → sees ${rows.length} submitted competitions`);
    if (rows.length) console.table(rows);
  }

  await conn.end();
}

main().catch(console.error);