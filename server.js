// src/server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');
const fs = require('fs');

const { testConnection } = require('./config/db');
const { authenticate } = require('./middleware/auth');
const { errorHandler, requestLogger } = require('./middleware/errorHandler');

// Route modules
const app = express();
const PORT = process.env.PORT || 5000;

// ── Ensure uploads directory exists ──────────────────────
const uploadDir = process.env.UPLOAD_DIR || 'uploads';
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// ── Middleware ────────────────────────────────────────────
app.use(cors({
  origin: process.env.CLIENT_URL || '*',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(requestLogger);

// Static file serving for uploads
app.use('/uploads', authenticate, express.static(path.join(__dirname, '..', uploadDir)));

// ── Rate Limiting ─────────────────────────────────────────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  message: { success: false, message: 'Too many requests, please try again later' },
});

const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
});

app.use('/api/auth/login',    authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/',              generalLimiter);

// ── Routes ────────────────────────────────────────────────
const authCtrl = require('./controllers/authController');
const { authenticate: auth, authorize } = require('./middleware/auth');
const { body } = require('express-validator');

// AUTH
const authR = express.Router();
authR.post('/register', [body('name').notEmpty(), body('email').isEmail(), body('password').isLength({min:8})], authCtrl.register);
authR.post('/login',    [body('email').isEmail(), body('password').notEmpty()], authCtrl.login);
authR.post('/google',   authCtrl.googleLogin);
authR.post('/refresh',  authCtrl.refreshToken);
authR.post('/logout',   auth, authCtrl.logout);
authR.get('/me',        auth, authCtrl.getMe);
authR.patch('/profile', auth, authCtrl.updateProfile);
authR.post('/change-password', auth, authCtrl.changePassword);
app.use('/api/auth', authR);

// COMPETITIONS
const compCtrl = require('./controllers/Competitioncontroller'); // ✅ Bug-01 fixed
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const pathLib = require('path');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const date = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;
    const userName = (req.user?.name || 'Unknown')
      .replace(/[^a-zA-Z0-9 ]/g, '')
      .trim()
      .replace(/\s+/g, '_');
    const ext = pathLib.extname(file.originalname).toLowerCase();
    const suffix = Math.random().toString(36).slice(2, 6);
    cb(null, `${userName} - ${date}_${suffix}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: (Number(process.env.MAX_FILE_SIZE_MB) || 10) * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.pdf', '.jpg', '.jpeg', '.png'];
    allowed.includes(pathLib.extname(file.originalname).toLowerCase()) ? cb(null, true) : cb(new Error('Invalid file type'));
  }
});

const compR = express.Router();
compR.use(auth);
compR.get('/',                compCtrl.getAll);
compR.get('/:id',             compCtrl.getOne);
compR.post('/',               upload.array('documents', 5), compCtrl.create);
compR.put('/:id',             upload.array('documents', 5), compCtrl.update);
compR.post('/:id/approve',    authorize('pic', 'faculty', 'superadmin'), compCtrl.approve);
compR.post('/:id/reject',     authorize('pic', 'faculty', 'superadmin'), compCtrl.reject);
compR.post('/:id/achievement', upload.fields([{ name: 'certificate', maxCount: 1 }, { name: 'documentation', maxCount: 1 }]), compCtrl.reportAchievement);
compR.delete('/:id',          compCtrl.remove);
app.use('/api/competitions', compR);

// USERS
const { getAll: getUsers, updateRole, toggleActive } = require('./controllers/otherControllers');
const userR = express.Router();
userR.use(auth, authorize('superadmin'));
userR.get('/',             getUsers);
userR.patch('/:id/role',   updateRole);
userR.patch('/:id/toggle', toggleActive);
app.use('/api/users', userR);

// NOTIFICATIONS
const { notif } = require('./controllers/otherControllers');
const notifR = express.Router();
notifR.use(auth);
notifR.get('/',              notif.getNotifications);
notifR.patch('/all/read',    notif.markRead);   // ✅ fix: must be before /:id/read
notifR.patch('/:id/read',    notif.markRead);
app.use('/api/notifications', notifR);

// ANALYTICS
const { analytics } = require('./controllers/otherControllers');
const analyticsR = express.Router();
analyticsR.use(auth, authorize('faculty', 'superadmin'));
analyticsR.get('/', analytics.getAnalytics);
app.use('/api/analytics', analyticsR);

// EXPORT
const { export: exp } = require('./controllers/otherControllers');
const exportR = express.Router();
exportR.use(auth, authorize('faculty', 'superadmin'));
exportR.get('/:type', exp.exportData);
app.use('/api/export', exportR);

// ACTIVITY LOG
const { activity } = require('./controllers/otherControllers');
const activityR = express.Router();
activityR.use(auth, authorize('superadmin'));
activityR.get('/', activity.getActivityLog);
app.use('/api/activity-log', activityR);

// ── Health check ──────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), version: '1.0.0' });
});

// ── 404 handler ───────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route not found: ${req.method} ${req.originalUrl}` });
});

// ── Error handler ─────────────────────────────────────────
app.use(errorHandler);

// ── Start server ──────────────────────────────────────────
async function start() {
  await testConnection();
  app.listen(PORT, () => {
    console.log(`\n🚀  CompTrack API running on http://localhost:${PORT}`);
    console.log(`📋  Health check: http://localhost:${PORT}/health\n`);
    console.log('Available endpoints:');
    console.log('  POST   /api/auth/register');
    console.log('  POST   /api/auth/login');
    console.log('  POST   /api/auth/google');
    console.log('  GET    /api/competitions');
    console.log('  POST   /api/competitions');
    console.log('  POST   /api/competitions/:id/approve');
    console.log('  POST   /api/competitions/:id/reject');
    console.log('  GET    /api/notifications');
    console.log('  PATCH  /api/notifications/all/read');
    console.log('  PATCH  /api/notifications/:id/read');
    console.log('  GET    /api/analytics');
    console.log('  GET    /api/export/:type');
    console.log('  GET    /api/users  (superadmin)\n');
  });

  // ── BR-03: Achievement deadline cron job ──────────────────
  // Runs daily at 08:00 server time using a self-rescheduling setTimeout.
  // No extra npm package required.
  const { runAchievementDeadlineJob } = require('./jobs/achievementDeadline');

  function scheduleNextRun() {
    const now  = new Date();
    const next = new Date();
    next.setHours(8, 0, 0, 0);                          // target: 08:00 today
    if (next <= now) next.setDate(next.getDate() + 1);  // already past → tomorrow
    const msUntilNext = next - now;
    console.log(`[BR-03 cron] Next achievement-deadline check at ${next.toLocaleString()} (in ${Math.round(msUntilNext / 60000)} min)`);
    setTimeout(async () => {
      await runAchievementDeadlineJob();
      scheduleNextRun();                                 // reschedule for the following day
    }, msUntilNext);
  }

  scheduleNextRun();
}

start();
