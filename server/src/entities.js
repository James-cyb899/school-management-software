const express = require('express');
const db = require('./db');
const { authenticateToken } = require('./auth');

// Table config: which columns exist, what the auto-generated human-readable code prefix is,
// and which roles may read / write (create, update, delete) each entity.
const ENTITIES = {
  students:      { table: 'students',      codeCol: 'student_code',  prefix: 'STU',   cols: ['name','grade','section','guardian','contact','status'],
                   read: ['admin','teacher'], write: ['admin'] },
  staff:         { table: 'staff',         codeCol: 'staff_code',    prefix: 'STF',   cols: ['name','role','dept','contact','status'],
                   read: ['admin'], write: ['admin'] },
  admissions:    { table: 'admissions',    codeCol: 'app_code',      prefix: 'APP',   cols: ['applicant','grade','examScore','status'],
                   read: ['admin','finance'], write: ['admin'] },
  classes:       { table: 'classes',       codeCol: 'class_code',    prefix: 'CLS',   cols: ['grade','section','teacher','room','students'],
                   read: ['admin','teacher'], write: ['admin'] },
  timetable:     { table: 'timetable',     codeCol: 'tt_code',       prefix: 'TT',    cols: ['day','time','subject','class','teacher','room'],
                   read: ['admin','teacher'], write: ['admin'] },
  attendance:    { table: 'attendance',    codeCol: 'att_code',      prefix: 'ATT',   cols: ['name','type','date','status'],
                   read: ['admin','teacher'], write: ['admin','teacher'] },
  academics:     { table: 'academics',     codeCol: 'sub_code',      prefix: 'SUB',   cols: ['subject','grade','teacher','topic','resources'],
                   read: ['admin','teacher'], write: ['admin','teacher'] },
  exams:         { table: 'exams',         codeCol: 'exam_code',     prefix: 'EX',    cols: ['name','class','date','status'],
                   read: ['admin','teacher'], write: ['admin','teacher'] },
  library:       { table: 'library',       codeCol: 'book_code',     prefix: 'BK',    cols: ['title','author','isbn','copies','available'],
                   read: ['admin','teacher'], write: ['admin'] },
  finance:       { table: 'finance',       codeCol: 'invoice_code',  prefix: 'INV',   cols: ['student','term','amount','paid','status'],
                   read: ['admin','finance'], write: ['admin','finance'] },
  transport:     { table: 'transport',     codeCol: 'route_code',    prefix: 'RT',    cols: ['route','driver','vehicle','students','status'],
                   read: ['admin'], write: ['admin'] },
  inventory:     { table: 'inventory',     codeCol: 'asset_code',    prefix: 'INV-A', cols: ['name','category','quantity','location','condition'],
                   read: ['admin'], write: ['admin'] },
  announcements: { table: 'announcements', codeCol: 'ann_code',      prefix: 'AN',    cols: ['title','audience','date'],
                   read: ['admin','finance','teacher'], write: ['admin','teacher'] },
};

function nextCode(table, codeCol, prefix) {
  const row = db.prepare(`SELECT ${codeCol} as code FROM ${table} ORDER BY id DESC LIMIT 1`).get();
  let n = 1000;
  if (row && row.code) {
    const parts = row.code.split('-');
    const last = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(last)) n = last;
  }
  return `${prefix}-${n + 1}`;
}

const router = express.Router();
router.use(authenticateToken);

router.get('/:entity', (req, res) => {
  const cfg = ENTITIES[req.params.entity];
  if (!cfg) return res.status(404).json({ error: 'Unknown module.' });
  if (!cfg.read.includes(req.user.role)) return res.status(403).json({ error: 'You do not have access to this module.' });
  const rows = db.prepare(`SELECT * FROM ${cfg.table} ORDER BY id DESC`).all();
  res.json({ rows, editable: cfg.write.includes(req.user.role) });
});

router.post('/:entity', (req, res) => {
  const cfg = ENTITIES[req.params.entity];
  if (!cfg) return res.status(404).json({ error: 'Unknown module.' });
  if (!cfg.write.includes(req.user.role)) return res.status(403).json({ error: 'Your role has view-only access to this module.' });

  const code = nextCode(cfg.table, cfg.codeCol, cfg.prefix);
  const values = cfg.cols.map(c => (req.body[c] !== undefined ? req.body[c] : null));
  const placeholders = cfg.cols.map(() => '?').join(',');
  const info = db.prepare(
    `INSERT INTO ${cfg.table} (${cfg.codeCol}, ${cfg.cols.join(',')}) VALUES (?, ${placeholders})`
  ).run(code, ...values);
  const row = db.prepare(`SELECT * FROM ${cfg.table} WHERE id = ?`).get(info.lastInsertRowid);
  res.status(201).json({ row });
});

router.put('/:entity/:id', (req, res) => {
  const cfg = ENTITIES[req.params.entity];
  if (!cfg) return res.status(404).json({ error: 'Unknown module.' });
  if (!cfg.write.includes(req.user.role)) return res.status(403).json({ error: 'Your role has view-only access to this module.' });

  const setClause = cfg.cols.map(c => `${c} = ?`).join(', ');
  const values = cfg.cols.map(c => (req.body[c] !== undefined ? req.body[c] : null));
  db.prepare(`UPDATE ${cfg.table} SET ${setClause} WHERE id = ?`).run(...values, req.params.id);
  const row = db.prepare(`SELECT * FROM ${cfg.table} WHERE id = ?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Record not found.' });
  res.json({ row });
});

router.delete('/:entity/:id', (req, res) => {
  const cfg = ENTITIES[req.params.entity];
  if (!cfg) return res.status(404).json({ error: 'Unknown module.' });
  if (!cfg.write.includes(req.user.role)) return res.status(403).json({ error: 'Your role has view-only access to this module.' });
  db.prepare(`DELETE FROM ${cfg.table} WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

module.exports = { router, ENTITIES };
