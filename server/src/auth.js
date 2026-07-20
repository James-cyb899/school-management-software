const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('./db');
const { sendMail } = require('./mailer');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret-in-your-.env-file';
const TOKEN_EXPIRY = '12h';
const RESET_EXPIRY_MINUTES = 30;

const ALLOWED_ROLES = ['admin', 'finance', 'teacher'];

function isGmail(email) {
  return /^[a-zA-Z0-9._%+-]+@gmail\.com$/i.test((email || '').trim());
}

function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, full_name: user.full_name },
    JWT_SECRET,
    { expiresIn: TOKEN_EXPIRY }
  );
}

// ---- Middleware: verify JWT ----
function authenticateToken(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing or invalid Authorization header.' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Session expired or invalid. Please sign in again.' });
  }
}

// ---- Middleware: restrict to certain roles ----
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'You do not have permission to perform this action.' });
    }
    next();
  };
}

// ---- REGISTER ----
router.post('/register', async (req, res) => {
  try {
    const { full_name, email, password, role } = req.body;
    if (!full_name || !email || !password || !role) {
      return res.status(400).json({ error: 'Full name, email, password and role are all required.' });
    }
    if (!isGmail(email)) {
      return res.status(400).json({ error: 'Please register using a valid Gmail address (must end in @gmail.com).' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long.' });
    }
    if (!ALLOWED_ROLES.includes(role)) {
      return res.status(400).json({ error: 'Role must be one of: admin, finance, teacher.' });
    }
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
    if (existing) {
      return res.status(409).json({ error: 'An account with this Gmail address already exists. Try signing in instead.' });
    }
    const password_hash = await bcrypt.hash(password, 10);
    const info = db.prepare(
      'INSERT INTO users (full_name, email, password_hash, role) VALUES (?, ?, ?, ?)'
    ).run(full_name.trim(), email.toLowerCase(), password_hash, role);

    const user = { id: info.lastInsertRowid, email: email.toLowerCase(), role, full_name: full_name.trim() };
    const token = signToken(user);

    sendMail({
      to: user.email,
      subject: 'Welcome to School Management Software',
      text: `Hi ${user.full_name},\n\nYour account has been created successfully with the role "${role}".\n\nIf you did not create this account, please contact your system administrator immediately.`,
    }).catch(() => {}); // Don't block signup if email sending isn't configured yet.

    res.status(201).json({ token, user: { id: user.id, full_name: user.full_name, email: user.email, role: user.role } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
});

// ---- LOGIN ----
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get((email || '').toLowerCase());
    if (!user) return res.status(401).json({ error: 'No account found with that email.' });
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Incorrect password.' });
    const token = signToken(user);
    res.json({ token, user: { id: user.id, full_name: user.full_name, email: user.email, role: user.role } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

// ---- FORGOT PASSWORD ----
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required.' });
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());

    // Always respond the same way whether or not the account exists, to avoid leaking which emails are registered.
    const genericResponse = { message: 'If that Gmail address has an account, a password reset link has been sent to it.' };
    if (!user) return res.json(genericResponse);

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + RESET_EXPIRY_MINUTES * 60 * 1000).toISOString();
    db.prepare('INSERT INTO password_resets (user_id, token, expires_at) VALUES (?, ?, ?)').run(user.id, token, expiresAt);

    const appUrl = process.env.APP_URL || 'http://localhost:3000';
    const resetLink = `${appUrl}/reset-password.html?token=${token}`;

    await sendMail({
      to: user.email,
      subject: 'Reset your School Management Software password',
      text: `Hi ${user.full_name},\n\nWe received a request to reset your password. This link expires in ${RESET_EXPIRY_MINUTES} minutes:\n\n${resetLink}\n\nIf you didn't request this, you can safely ignore this email.`,
      html: `<p>Hi ${user.full_name},</p><p>We received a request to reset your password. This link expires in ${RESET_EXPIRY_MINUTES} minutes:</p><p><a href="${resetLink}">${resetLink}</a></p><p>If you didn't request this, you can safely ignore this email.</p>`,
    });

    res.json(genericResponse);
  } catch (err) {
    console.error(err);
    // Still avoid leaking whether the account exists; log server-side for the admin to debug SMTP config.
    res.json({ message: 'If that Gmail address has an account, a password reset link has been sent to it.' });
  }
});

// ---- RESET PASSWORD ----
router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ error: 'Token and new password are required.' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters long.' });

    const record = db.prepare('SELECT * FROM password_resets WHERE token = ?').get(token);
    if (!record) return res.status(400).json({ error: 'This reset link is invalid.' });
    if (record.used) return res.status(400).json({ error: 'This reset link has already been used.' });
    if (new Date(record.expires_at) < new Date()) return res.status(400).json({ error: 'This reset link has expired. Please request a new one.' });

    const password_hash = await bcrypt.hash(password, 10);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(password_hash, record.user_id);
    db.prepare('UPDATE password_resets SET used = 1 WHERE id = ?').run(record.id);

    res.json({ message: 'Password reset successfully. You can now sign in with your new password.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not reset password. Please try again.' });
  }
});

// ---- ME (validate current session) ----
router.get('/me', authenticateToken, (req, res) => {
  res.json({ user: req.user });
});

module.exports = { router, authenticateToken, requireRole };
