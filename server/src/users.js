const express = require('express');
const db = require('./db');
const { authenticateToken, requireRole } = require('./auth');

const router = express.Router();

// GET /api/users -> list everyone who has registered (admin only). Never returns password hashes.
router.get('/users', authenticateToken, requireRole('admin'), (req, res) => {
  const rows = db.prepare(
    'SELECT id, full_name, email, role, created_at FROM users ORDER BY created_at DESC'
  ).all();
  res.json({ rows });
});

module.exports = router;
