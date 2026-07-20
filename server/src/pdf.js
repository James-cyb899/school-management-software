const express = require('express');
const PDFDocument = require('pdfkit');
const db = require('./db');
const { authenticateToken, requireRole } = require('./auth');

const router = express.Router();

// GET /api/finance/:id/statement -> streams a real PDF fee statement
router.get('/finance/:id/statement', authenticateToken, requireRole('admin', 'finance'), (req, res) => {
  const invoice = db.prepare('SELECT * FROM finance WHERE id = ?').get(req.params.id);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found.' });

  const balance = Number(invoice.amount || 0) - Number(invoice.paid || 0);
  const doc = new PDFDocument({ size: 'A4', margin: 50 });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="statement-${invoice.invoice_code}.pdf"`);
  doc.pipe(res);

  // Header
  doc.fontSize(20).fillColor('#16233F').text('School Management Software', { align: 'left' });
  doc.fontSize(11).fillColor('#5B5346').text('Official Fee Statement', { align: 'left' });
  doc.moveDown(1.2);
  doc.strokeColor('#D9CBA8').lineWidth(1).moveTo(50, doc.y).lineTo(545, doc.y).stroke();
  doc.moveDown(1);

  // Invoice meta
  doc.fontSize(10).fillColor('#2A2420');
  const metaTop = doc.y;
  doc.text(`Statement No: ${invoice.invoice_code}`, 50, metaTop);
  doc.text(`Date issued: ${new Date().toISOString().slice(0, 10)}`, 50, metaTop + 16);
  doc.text(`Student: ${invoice.student}`, 320, metaTop);
  doc.text(`Term: ${invoice.term}`, 320, metaTop + 16);
  doc.moveDown(3);

  // Table header
  const tableTop = doc.y + 10;
  doc.fontSize(10).fillColor('#7B4B2A');
  doc.text('Description', 50, tableTop);
  doc.text('Billed (KES)', 300, tableTop, { width: 100, align: 'right' });
  doc.text('Paid (KES)', 420, tableTop, { width: 100, align: 'right' });
  doc.moveTo(50, tableTop + 15).lineTo(545, tableTop + 15).strokeColor('#D9CBA8').stroke();

  const rowTop = tableTop + 25;
  doc.fillColor('#2A2420').fontSize(10);
  doc.text(`Tuition & fees — ${invoice.term}`, 50, rowTop);
  doc.text(Number(invoice.amount || 0).toLocaleString(), 300, rowTop, { width: 100, align: 'right' });
  doc.text(Number(invoice.paid || 0).toLocaleString(), 420, rowTop, { width: 100, align: 'right' });

  doc.moveTo(50, rowTop + 20).lineTo(545, rowTop + 20).strokeColor('#D9CBA8').stroke();

  const totalsTop = rowTop + 32;
  doc.fontSize(11).fillColor('#16233F');
  doc.text('Balance due:', 300, totalsTop, { width: 120, align: 'right' });
  doc.fillColor(balance > 0 ? '#A6432B' : '#33513E');
  doc.text(`KES ${balance.toLocaleString()}`, 420, totalsTop, { width: 100, align: 'right' });

  doc.moveDown(4);
  doc.fontSize(9).fillColor('#5B5346').text(
    `Status: ${invoice.status}. This statement was generated automatically by School Management Software and reflects records as of the date above.`,
    50, doc.y, { width: 495 }
  );

  doc.end();
});

module.exports = router;
