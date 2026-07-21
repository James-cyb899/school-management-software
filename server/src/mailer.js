const nodemailer = require('nodemailer');

let transporter = null;
let configured = false;

function getTransporter() {
  if (transporter) return transporter;
  const { GMAIL_USER, GMAIL_APP_PASSWORD } = process.env;
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
    configured = false;
    return null;
  }
  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
  });
  configured = true;
  return transporter;
}

async function sendMail({ to, bcc, subject, text, html }) {
  const t = getTransporter();
  if (!t) {
    console.warn(
      `[mailer] GMAIL_USER / GMAIL_APP_PASSWORD not set in .env — skipped sending email to ${to || bcc}: "${subject}". ` +
      `Set these in your .env file to enable real emails (see README).`
    );
    return { skipped: true };
  }
  return t.sendMail({
    from: `"School Management Software" <${process.env.GMAIL_USER}>`,
    to: to || process.env.GMAIL_USER,
    bcc,
    subject,
    text,
    html,
  });
}

module.exports = { sendMail, isConfigured: () => configured };
