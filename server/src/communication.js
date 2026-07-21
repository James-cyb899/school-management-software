const express = require('express');
const db = require('./db');
const { authenticateToken, requireRole } = require('./auth');
const { sendMail, isConfigured } = require('./mailer');

const router = express.Router();

// POST /api/communication/emergency-alert -> emails every registered user (admin & teacher only)
router.post('/communication/emergency-alert', authenticateToken, requireRole('admin', 'teacher'), async (req, res) => {
  const { subject, message } = req.body;
  if (!subject || !message) {
    return res.status(400).json({ error: 'Subject and message are both required.' });
  }
  if (!isConfigured()) {
    return res.status(503).json({
      error: 'Email is not configured yet. Set GMAIL_USER and GMAIL_APP_PASSWORD in your environment variables first (see README).',
    });
  }

  const users = db.prepare('SELECT email FROM users').all();
  if (users.length === 0) {
    return res.status(400).json({ error: 'There are no registered accounts to notify yet.' });
  }
  const bccList = users.map(u => u.email);

  try {
    await sendMail({
      bcc: bccList,
      subject: `EMERGENCY ALERT: ${subject}`,
      text: `${message}\n\n— Sent via School Management Software emergency alert by ${req.user.full_name} (${req.user.role}).`,
      html: `<p style="font-size:16px;"><strong>EMERGENCY ALERT</strong></p><p>${message.replace(/\n/g, '<br>')}</p><p style="color:#5B5346;font-size:12px;">Sent via School Management Software by ${req.user.full_name} (${req.user.role}).</p>`,
    });
    res.json({ message: `Alert sent to ${bccList.length} registered account(s) by email.`, count: bccList.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not send the alert. Check your Gmail settings and try again.' });
  }
});

module.exports = router;
