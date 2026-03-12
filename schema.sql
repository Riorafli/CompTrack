-- ═══════════════════════════════════════════════════════════
-- CompTrack Database Schema
-- Run: mysql -u root -p < schema.sql
-- ═══════════════════════════════════════════════════════════

CREATE DATABASE IF NOT EXISTS comptrack CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE comptrack;

-- ── USERS ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id          VARCHAR(36)  PRIMARY KEY,
  name        VARCHAR(100) NOT NULL,
  email       VARCHAR(150) NOT NULL UNIQUE,
  password    VARCHAR(255),                        -- NULL for OAuth-only accounts
  nim         VARCHAR(20),
  major       VARCHAR(100),
  role        ENUM('student','pic','faculty','superadmin') NOT NULL DEFAULT 'student',
  color       VARCHAR(10)  DEFAULT '#4f8aff',
  google_id   VARCHAR(100),
  avatar_url  VARCHAR(500),
  is_active   TINYINT(1)   DEFAULT 1,
  created_at  DATETIME     DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_email  (email),
  INDEX idx_role   (role),
  INDEX idx_nim    (nim)
);

-- ── COMPETITIONS ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS competitions (
  id               VARCHAR(20)  PRIMARY KEY,
  name             VARCHAR(255) NOT NULL,
  organizer        VARCHAR(150),
  level            ENUM('regional','national','international') NOT NULL,
  category         VARCHAR(100),
  date_start       DATE,
  date_end         DATE,
  leader_nim       VARCHAR(20),
  proposal_link    VARCHAR(500),
  funding          BIGINT       DEFAULT 0,
  exemption        TINYINT(1)   DEFAULT 0,
  status           ENUM('draft','submitted','pic_approved','pic_rejected','faculty_approved','faculty_rejected','letter_generated','completed')
                   NOT NULL DEFAULT 'draft',
  letter_generated              TINYINT(1)   DEFAULT 0,
  submitted_at                  DATETIME,         -- full datetime incl. time
  -- BR-03: achievement deadline tracking
  achievement_deadline          DATE,             -- date_end + ACHIEVEMENT_DEADLINE_DAYS, set on faculty approval
  achievement_deadline_reminded TINYINT(1)   DEFAULT 0,
                                                  -- 0=not sent  1=3-day reminder sent  2=overdue notice sent
  pic_note         TEXT,
  faculty_note     TEXT,
  major            VARCHAR(100),
  submitted_by     VARCHAR(36)  NOT NULL,
  created_at       DATETIME     DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_status       (status),
  INDEX idx_submitted_by (submitted_by),
  INDEX idx_major        (major),
  INDEX idx_deadline     (achievement_deadline),  -- BR-03: speeds up daily cron query
  FOREIGN KEY (submitted_by) REFERENCES users(id) ON DELETE CASCADE
);

-- ── COMPETITION MEMBERS ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS competition_members (
  id             INT          AUTO_INCREMENT PRIMARY KEY,
  competition_id VARCHAR(20)  NOT NULL,
  user_nim       VARCHAR(20)  NOT NULL,
  is_leader      TINYINT(1)   DEFAULT 0,
  UNIQUE KEY uq_comp_nim (competition_id, user_nim),
  FOREIGN KEY (competition_id) REFERENCES competitions(id) ON DELETE CASCADE
);

-- ── COMPETITION HISTORY ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS competition_history (
  id             INT          AUTO_INCREMENT PRIMARY KEY,
  competition_id VARCHAR(20)  NOT NULL,
  status         VARCHAR(50)  NOT NULL,
  actor_name     VARCHAR(100),
  actor_id       VARCHAR(36),
  note           TEXT,
  created_at     DATETIME     DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_comp (competition_id),
  FOREIGN KEY (competition_id) REFERENCES competitions(id) ON DELETE CASCADE
);

-- ── ACHIEVEMENTS ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS achievements (
  id             INT          AUTO_INCREMENT PRIMARY KEY,
  competition_id VARCHAR(20)  NOT NULL UNIQUE,
  result         ENUM('Winner','Runner-up','Finalist','Participant') NOT NULL,
  certificate    TINYINT(1)   DEFAULT 0,
  documentation  TINYINT(1)   DEFAULT 0,
  notes          TEXT,
  reported_at    DATETIME,                         -- full datetime incl. time
  created_at     DATETIME     DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (competition_id) REFERENCES competitions(id) ON DELETE CASCADE
);

-- ── DOCUMENTS (file uploads) ────────────────────────────────
CREATE TABLE IF NOT EXISTS documents (
  id             INT          AUTO_INCREMENT PRIMARY KEY,
  competition_id VARCHAR(20)  NOT NULL,
  file_name      VARCHAR(255) NOT NULL,
  file_path      VARCHAR(500) NOT NULL,
  file_type      VARCHAR(50),
  file_size      INT,
  uploaded_by    VARCHAR(36),
  doc_type       ENUM('proposal','certificate','documentation','other') DEFAULT 'other',
  created_at     DATETIME     DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_comp (competition_id),
  FOREIGN KEY (competition_id) REFERENCES competitions(id) ON DELETE CASCADE
);

-- ── NOTIFICATIONS ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id          INT          AUTO_INCREMENT PRIMARY KEY,
  user_id     VARCHAR(36)  NOT NULL,
  title       VARCHAR(300) NOT NULL,
  icon        VARCHAR(10)  DEFAULT '🔔',
  link        VARCHAR(200),
  is_read     TINYINT(1)   DEFAULT 0,
  created_at  DATETIME     DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user   (user_id),
  INDEX idx_unread (user_id, is_read),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ── ACTIVITY LOG ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS activity_log (
  id          INT          AUTO_INCREMENT PRIMARY KEY,
  user_id     VARCHAR(36),
  user_name   VARCHAR(100),
  user_email  VARCHAR(150),
  user_role   VARCHAR(50),
  action      VARCHAR(150) NOT NULL,
  detail      TEXT,
  ip_address  VARCHAR(50),
  created_at  DATETIME     DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user    (user_id),
  INDEX idx_created (created_at)
);

-- ── REFRESH TOKENS ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          INT          AUTO_INCREMENT PRIMARY KEY,
  user_id     VARCHAR(36)  NOT NULL,
  token       VARCHAR(500) NOT NULL UNIQUE,
  expires_at  DATETIME     NOT NULL,
  created_at  DATETIME     DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user  (user_id),
  INDEX idx_token (token(100)),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ═══════════════════════════════════════════════════════════
-- SEED DATA — Demo users (password: "password" for all)
-- ═══════════════════════════════════════════════════════════
INSERT IGNORE INTO users (id, name, email, password, nim, major, role, color) VALUES
  ('u-student-1',    'Aliyah Rahmawati',   'aliyah@university.ac.id',  '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', '20210001', 'Informatics', 'student',    '#4f8aff'),
  ('u-student-2',    'Bima Prasetyo',      'bima@university.ac.id',    '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', '20210045', 'Informatics', 'student',    '#7c5cfc'),
  ('u-student-3',    'Citra Dewi',         'citra@university.ac.id',   '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', '20210089', 'Business',    'student',    '#00d4aa'),
  ('u-pic-1',        'Dr. Hendra Wijaya',  'hendra@university.ac.id',  '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', NULL,       'Informatics', 'pic',        '#ff8c42'),
  ('u-faculty-1',    'Prof. Sari Lestari', 'sari@university.ac.id',    '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', NULL,       NULL,          'faculty',    '#ff5c6a'),
  ('u-superadmin-1', 'Admin Sistem',       'admin@university.ac.id',   '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', NULL,       NULL,          'superadmin', '#ffb547');

-- ═══════════════════════════════════════════════════════════
-- MIGRATION — only needed if upgrading an EXISTING database
-- (skip entirely if running schema.sql fresh on a new database)
-- ═══════════════════════════════════════════════════════════
-- ALTER TABLE competitions MODIFY submitted_at DATETIME;
-- ALTER TABLE achievements  MODIFY reported_at  DATETIME;
-- BR-03 — run these on an existing database:
-- ALTER TABLE competitions ADD COLUMN achievement_deadline DATE AFTER submitted_at;
-- ALTER TABLE competitions ADD COLUMN achievement_deadline_reminded TINYINT(1) NOT NULL DEFAULT 0 AFTER achievement_deadline;
-- UPDATE competitions
--    SET achievement_deadline = DATE_ADD(date_end, INTERVAL 30 DAY)
--  WHERE date_end IS NOT NULL
--    AND status IN ('faculty_approved','letter_generated','completed')
--    AND achievement_deadline IS NULL;