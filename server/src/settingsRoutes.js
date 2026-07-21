const express = require('express');
const db = require('./db');
const { authenticateToken, requireRole } = require('./auth');

const router = express.Router();

function getSetting(key, fallback) {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}
function setSetting(key, value) {
  db.prepare(
    'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, value);
}

// GET /api/settings/security -> current security settings (admin only)
router.get('/settings/security', authenticateToken, requireRole('admin'), (req, res) => {
  res.json({
    allow_registration: getSetting('allow_registration', 'true') === 'true',
  });
});

// POST /api/settings/security -> update a security setting (admin only)
router.post('/settings/security', authenticateToken, requireRole('admin'), (req, res) => {
  const { allow_registration } = req.body;
  if (typeof allow_registration === 'boolean') {
    setSetting('allow_registration', allow_registration ? 'true' : 'false');
  }
  res.json({
    allow_registration: getSetting('allow_registration', 'true') === 'true',
  });
});

module.exports = { router, getSetting, setSetting };
