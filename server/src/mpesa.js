const express = require('express');
const db = require('./db');
const { authenticateToken, requireRole } = require('./auth');

const router = express.Router();

function mpesaConfigured() {
  return Boolean(
    process.env.MPESA_CONSUMER_KEY &&
    process.env.MPESA_CONSUMER_SECRET &&
    process.env.MPESA_SHORTCODE &&
    process.env.MPESA_PASSKEY &&
    process.env.MPESA_CALLBACK_URL
  );
}

function baseUrl() {
  return process.env.MPESA_ENV === 'production'
    ? 'https://api.safaricom.co.ke'
    : 'https://sandbox.safaricom.co.ke';
}

function timestampNow() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

async function getAccessToken() {
  const auth = Buffer.from(`${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`).toString('base64');
  const res = await fetch(`${baseUrl()}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${auth}` },
  });
  if (!res.ok) throw new Error(`M-Pesa auth failed (${res.status}). Check your MPESA_CONSUMER_KEY/SECRET.`);
  const data = await res.json();
  return data.access_token;
}

// Normalise a Kenyan phone number to the 2547XXXXXXXX format Safaricom expects.
function normalisePhone(phone) {
  let p = (phone || '').replace(/\D/g, '');
  if (p.startsWith('0')) p = '254' + p.slice(1);
  if (p.startsWith('7') || p.startsWith('1')) p = '254' + p;
  if (!p.startsWith('254')) throw new Error('Enter a valid Kenyan phone number, e.g. 0712345678.');
  return p;
}

// POST /api/mpesa/stkpush -> initiate a real STK push prompt on the payer's phone (admin & finance only)
router.post('/mpesa/stkpush', authenticateToken, requireRole('admin', 'finance'), async (req, res) => {
  if (!mpesaConfigured()) {
    return res.status(503).json({
      error: 'M-Pesa is not configured yet. Set MPESA_CONSUMER_KEY, MPESA_CONSUMER_SECRET, MPESA_SHORTCODE, MPESA_PASSKEY and MPESA_CALLBACK_URL in your environment variables (see README).',
    });
  }
  try {
    const { invoiceId, phone, amount } = req.body;
    if (!invoiceId || !phone || !amount) {
      return res.status(400).json({ error: 'Invoice, phone number and amount are all required.' });
    }
    const invoice = db.prepare('SELECT * FROM finance WHERE id = ?').get(invoiceId);
    if (!invoice) return res.status(404).json({ error: 'Invoice not found.' });

    const cleanPhone = normalisePhone(phone);
    const token = await getAccessToken();
    const shortcode = process.env.MPESA_SHORTCODE;
    const timestamp = timestampNow();
    const password = Buffer.from(`${shortcode}${process.env.MPESA_PASSKEY}${timestamp}`).toString('base64');

    const payload = {
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: Math.round(Number(amount)),
      PartyA: cleanPhone,
      PartyB: shortcode,
      PhoneNumber: cleanPhone,
      CallBackURL: process.env.MPESA_CALLBACK_URL,
      AccountReference: invoice.invoice_code,
      TransactionDesc: `School fees ${invoice.term}`,
    };

    const stkRes = await fetch(`${baseUrl()}/mpesa/stkpush/v1/processrequest`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const stkData = await stkRes.json();
    if (!stkRes.ok || stkData.ResponseCode !== '0') {
      return res.status(502).json({ error: stkData.errorMessage || 'M-Pesa rejected the request. Double check the phone number and amount.' });
    }

    db.prepare(
      `INSERT INTO mpesa_transactions (checkout_request_id, merchant_request_id, invoice_id, phone, amount, status)
       VALUES (?, ?, ?, ?, ?, 'Pending')`
    ).run(stkData.CheckoutRequestID, stkData.MerchantRequestID, invoiceId, cleanPhone, Number(amount));

    res.json({ message: 'STK push sent — ask the payer to check their phone and enter their M-Pesa PIN.', checkoutRequestId: stkData.CheckoutRequestID });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Could not initiate the M-Pesa payment.' });
  }
});

// GET /api/mpesa/status/:checkoutRequestId -> poll whether a push has been completed yet
router.get('/mpesa/status/:checkoutRequestId', authenticateToken, requireRole('admin', 'finance'), (req, res) => {
  const tx = db.prepare('SELECT * FROM mpesa_transactions WHERE checkout_request_id = ?').get(req.params.checkoutRequestId);
  if (!tx) return res.status(404).json({ error: 'Transaction not found.' });
  res.json({ status: tx.status, mpesa_receipt: tx.mpesa_receipt, result_desc: tx.result_desc });
});

// POST /api/mpesa/callback -> Safaricom calls THIS automatically after the payer responds. No auth (it's Safaricom's server, not a logged-in user).
router.post('/mpesa/callback', express.json(), (req, res) => {
  try {
    const stkCallback = req.body?.Body?.stkCallback;
    if (!stkCallback) return res.status(400).json({ ResultCode: 1, ResultDesc: 'Invalid callback payload.' });

    const { CheckoutRequestID, ResultCode, ResultDesc, CallbackMetadata } = stkCallback;
    const tx = db.prepare('SELECT * FROM mpesa_transactions WHERE checkout_request_id = ?').get(CheckoutRequestID);
    if (!tx) return res.json({ ResultCode: 0, ResultDesc: 'Accepted (no matching transaction on file).' });

    if (ResultCode === 0) {
      const items = CallbackMetadata?.Item || [];
      const get = name => items.find(i => i.Name === name)?.Value;
      const receipt = get('MpesaReceiptNumber');
      const amountPaid = get('Amount');

      db.prepare('UPDATE mpesa_transactions SET status = ?, mpesa_receipt = ?, result_desc = ? WHERE id = ?')
        .run('Completed', receipt, ResultDesc, tx.id);

      const invoice = db.prepare('SELECT * FROM finance WHERE id = ?').get(tx.invoice_id);
      if (invoice) {
        const newPaid = Number(invoice.paid || 0) + Number(amountPaid || tx.amount);
        const newStatus = newPaid >= Number(invoice.amount) ? 'Paid' : 'Partial';
        db.prepare('UPDATE finance SET paid = ?, status = ? WHERE id = ?').run(newPaid, newStatus, invoice.id);
      }
    } else {
      db.prepare('UPDATE mpesa_transactions SET status = ?, result_desc = ? WHERE id = ?')
        .run('Failed', ResultDesc, tx.id);
    }

    res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ResultCode: 1, ResultDesc: 'Server error.' });
  }
});

module.exports = { router, mpesaConfigured };
