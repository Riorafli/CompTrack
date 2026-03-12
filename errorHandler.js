function errorHandler(err, req, res, next) {
  console.error(`[${new Date().toISOString()}] ERROR:`, err.stack || err.message);

  if (err.code === 'ER_DUP_ENTRY') {
    return res.status(409).json({ success: false, message: 'Duplicate entry — record already exists' });
  }
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ success: false, message: `File too large. Max size: ${process.env.MAX_FILE_SIZE_MB || 10}MB` });
  }

  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    success: false,
    message: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
}

function requestLogger(req, res, next) {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    const color = res.statusCode >= 500 ? '\x1b[31m'
                : res.statusCode >= 400 ? '\x1b[33m'
                : '\x1b[32m';
    console.log(`${color}[${res.statusCode}]\x1b[0m ${req.method} ${req.originalUrl} — ${ms}ms`);
  });
  next();
}

module.exports = { errorHandler, requestLogger };
