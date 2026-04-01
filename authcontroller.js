// src/controllers/authController.js
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { OAuth2Client } = require('google-auth-library');
const { pool } = require('../config/db');

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// ── Helpers ───────────────────────────────────────────────
function generateTokens(user) {
  const payload = { id: user.id, role: user.role };
  const accessToken = jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
  const refreshToken = jwt.sign(payload, process.env.JWT_SECRET + '_refresh', {
    expiresIn: '30d',
  });
  return { accessToken, refreshToken };
}

async function saveRefreshToken(userId, token) {
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await pool.query(
    'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES (?, ?, ?)',
    [userId, token, expiresAt]
  );
}

async function logActivity(userId, user, action, detail, ip) {
  await pool.query(
    'INSERT INTO activity_log (user_id, user_name, user_email, user_role, action, detail, ip_address) VALUES (?,?,?,?,?,?,?)',
    [userId, user?.name, user?.email, user?.role, action, detail, ip]
  );
}

function safeUser(u) {
  const { password, google_id, ...safe } = u;
  return safe;
}

// ── POST /api/auth/register ───────────────────────────────
async function register(req, res, next) {
  try {
    const { name, email, password, nim, major, role = 'student' } = req.body;

    // PIC accounts must have a major — without one, getAll() would expose all submissions
    if (role === 'pic' && !major) {
      return res.status(400).json({ success: false, message: 'A major is required when registering a PIC account.' });
    }

    // Check email exists
    const [existing] = await pool.query('SELECT id FROM users WHERE email = ?', [email]);
    if (existing.length) {
      return res.status(409).json({ success: false, message: 'Email already registered' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const colors = ['#4f8aff', '#7c5cfc', '#00d4aa', '#ff8c42', '#ff5c6a', '#ffb547'];
    const color = colors[Math.floor(Math.random() * colors.length)];
    const id = uuidv4();

    await pool.query(
      'INSERT INTO users (id, name, email, password, nim, major, role, color) VALUES (?,?,?,?,?,?,?,?)',
      [id, name, email, hashedPassword, nim || null, major || null, role, color]
    );

    const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [id]);
    const user = rows[0];
    const { accessToken, refreshToken } = generateTokens(user);
    await saveRefreshToken(id, refreshToken);
    await logActivity(id, user, 'Account Registered', `New ${role} account created`, req.ip);

    res.status(201).json({
      success: true,
      message: 'Account created successfully',
      user: safeUser(user),
      accessToken,
      refreshToken,
    });
  } catch (err) {
    next(err);
  }
}

// ── POST /api/auth/login ──────────────────────────────────
async function login(req, res, next) {
  try {
    const { email, password } = req.body;
    const [rows] = await pool.query('SELECT * FROM users WHERE email = ? AND is_active = 1', [email]);
    if (!rows.length) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    const user = rows[0];
    if (!user.password) {
      return res.status(400).json({ success: false, message: 'This account uses Google Sign-In. Please use Google to login.' });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    const { accessToken, refreshToken } = generateTokens(user);
    await saveRefreshToken(user.id, refreshToken);
    await logActivity(user.id, user, 'Login', 'Signed in via email/password', req.ip);

    res.json({
      success: true,
      message: 'Logged in successfully',
      user: safeUser(user),
      accessToken,
      refreshToken,
    });
  } catch (err) {
    next(err);
  }
}

// ── POST /api/auth/google ─────────────────────────────────
async function googleLogin(req, res, next) {
  try {
    const { idToken } = req.body;
    if (!idToken) return res.status(400).json({ success: false, message: 'Google ID token required' });

    // Verify token with Google
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    const { sub: googleId, email, name, picture } = payload;

    // Check if user exists (by google_id or email)
    let [rows] = await pool.query(
      'SELECT * FROM users WHERE google_id = ? OR email = ?',
      [googleId, email]
    );

    let user;
    if (rows.length) {
      user = rows[0];
      // Link google_id if not yet linked
      if (!user.google_id) {
        await pool.query('UPDATE users SET google_id = ?, avatar_url = ? WHERE id = ?',
          [googleId, picture, user.id]);
        user.google_id = googleId;
      }
    } else {
      // Auto-register new user
      const id = uuidv4();
      const color = ['#4f8aff', '#7c5cfc', '#00d4aa', '#ff8c42'][Math.floor(Math.random() * 4)];
      await pool.query(
        'INSERT INTO users (id, name, email, google_id, avatar_url, role, color) VALUES (?,?,?,?,?,?,?)',
        [id, name, email, googleId, picture, 'student', color]
      );
      [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [id]);
      user = rows[0];
      await logActivity(user.id, user, 'Account Registered', 'New account via Google OAuth', req.ip);
    }

    if (!user.is_active) {
      return res.status(403).json({ success: false, message: 'Account is deactivated' });
    }

    const { accessToken, refreshToken } = generateTokens(user);
    await saveRefreshToken(user.id, refreshToken);
    await logActivity(user.id, user, 'Login', 'Signed in via Google OAuth', req.ip);

    res.json({
      success: true,
      message: 'Google login successful',
      user: safeUser(user),
      accessToken,
      refreshToken,
    });
  } catch (err) {
    if (err.message?.includes('Invalid token')) {
      return res.status(401).json({ success: false, message: 'Invalid Google token' });
    }
    next(err);
  }
}

// ── POST /api/auth/refresh ────────────────────────────────
async function refreshToken(req, res, next) {
  try {
    const { refreshToken: token } = req.body;
    if (!token) return res.status(400).json({ success: false, message: 'Refresh token required' });

    const [rows] = await pool.query(
      'SELECT * FROM refresh_tokens WHERE token = ? AND expires_at > NOW()',
      [token]
    );
    if (!rows.length) {
      return res.status(401).json({ success: false, message: 'Invalid or expired refresh token' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET + '_refresh');
    const [userRows] = await pool.query(
      'SELECT id, name, email, nim, major, role, color FROM users WHERE id = ? AND is_active = 1',
      [decoded.id]
    );
    if (!userRows.length) return res.status(401).json({ success: false, message: 'User not found' });

    const user = userRows[0];
    const { accessToken, refreshToken: newRefresh } = generateTokens(user);

    // Rotate refresh token
    await pool.query('DELETE FROM refresh_tokens WHERE token = ?', [token]);
    await saveRefreshToken(user.id, newRefresh);

    res.json({ success: true, accessToken, refreshToken: newRefresh });
  } catch (err) {
    next(err);
  }
}

// ── POST /api/auth/logout ─────────────────────────────────
async function logout(req, res, next) {
  try {
    const { refreshToken: token } = req.body;
    if (token) {
      await pool.query('DELETE FROM refresh_tokens WHERE token = ?', [token]);
    }
    await logActivity(req.user.id, req.user, 'Logout', 'User signed out', req.ip);
    res.json({ success: true, message: 'Logged out successfully' });
  } catch (err) {
    next(err);
  }
}

// ── GET /api/auth/me ──────────────────────────────────────
async function getMe(req, res) {
  res.json({ success: true, user: req.user });
}

// ── PATCH /api/auth/profile ───────────────────────────────
async function updateProfile(req, res, next) {
  try {
    const { name, nim, major, color } = req.body;
    const fields = [];
    const values = [];

    if (name !== undefined)  { fields.push('name = ?');  values.push(name); }
    if (nim   !== undefined)  { fields.push('nim = ?');   values.push(nim || null); }
    if (major !== undefined)  { fields.push('major = ?'); values.push(major || null); }
    if (color !== undefined)  { fields.push('color = ?'); values.push(color); }

    if (!fields.length) return res.status(400).json({ success: false, message: 'Nothing to update' });

    values.push(req.user.id);
    await pool.query(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, values);

    const [rows] = await pool.query(
      'SELECT id, name, email, nim, major, role, color, avatar_url FROM users WHERE id = ?',
      [req.user.id]
    );
    res.json({ success: true, user: rows[0] });
  } catch (err) {
    next(err);
  }
}

// ── POST /api/auth/change-password ───────────────────────
async function changePassword(req, res, next) {
  try {
    const { currentPassword, newPassword } = req.body;
    const [rows] = await pool.query('SELECT password FROM users WHERE id = ?', [req.user.id]);
    const user = rows[0];

    if (!user.password) {
      return res.status(400).json({ success: false, message: 'OAuth account — cannot change password' });
    }
    const match = await bcrypt.compare(currentPassword, user.password);
    if (!match) {
      return res.status(400).json({ success: false, message: 'Current password is incorrect' });
    }
    const hashed = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users SET password = ? WHERE id = ?', [hashed, req.user.id]);
    res.json({ success: true, message: 'Password changed successfully' });
  } catch (err) {
    next(err);
  }
}

module.exports = { register, login, googleLogin, refreshToken, logout, getMe, updateProfile, changePassword };
