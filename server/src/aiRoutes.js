const express = require('express');
const { authenticateToken } = require('./auth');

const router = express.Router();

const PRIMER = `You are the AI Assistant embedded in a school management software used by administration, finance and teaching staff. Be concise, practical and warm. When asked about specific students, note that you're reasoning from whatever the user has told you, not a live database, unless real records were included in the message. Never invent a real person's name or fabricate confidential-sounding details.`;

router.post('/chat', authenticateToken, async (req, res) => {
  const { messages } = req.body;
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array is required.' });
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(503).json({
      error: 'The AI Assistant is not configured yet. Set ANTHROPIC_API_KEY in your .env file (see README) and restart the server.',
    });
  }

  try {
    const outgoing = [...messages];
    if (outgoing.length && outgoing[0].role === 'user') {
      outgoing[0] = { ...outgoing[0], content: `${PRIMER}\n\nUser request: ${outgoing[0].content}` };
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        messages: outgoing,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Anthropic API error:', response.status, errText);
      return res.status(502).json({ error: 'The AI Assistant is temporarily unavailable. Please try again.' });
    }

    const data = await response.json();
    const reply = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    res.json({ reply: reply || "I couldn't generate a response just now — please try rephrasing." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'The AI Assistant hit an unexpected error. Please try again.' });
  }
});

module.exports = router;
