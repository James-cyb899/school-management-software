require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const { router: authRouter } = require('./src/auth');
const { router: entitiesRouter } = require('./src/entities');
const pdfRouter = require('./src/pdf');
const aiRouter = require('./src/aiRoutes');
const { isConfigured: mailerConfigured } = require('./src/mailer');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.use('/api/auth', authRouter);

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    mailerConfigured: mailerConfigured(),
    aiConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
  });
});

app.use('/api', entitiesRouter);   // /api/:entity  (students, staff, finance, ...)
app.use('/api', pdfRouter);        // /api/finance/:id/statement
app.use('/api/ai', aiRouter);      // /api/ai/chat

// Serve the frontend
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`School Management Software backend running on http://localhost:${PORT}`);
  if (!mailerConfigured()) {
    console.log('NOTE: GMAIL_USER / GMAIL_APP_PASSWORD not set — password reset & welcome emails will be skipped until configured in .env');
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log('NOTE: ANTHROPIC_API_KEY not set — AI Assistant will be disabled until configured in .env');
  }
});
