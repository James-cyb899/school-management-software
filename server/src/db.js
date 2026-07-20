const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'school.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','finance','teacher')),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS password_resets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_code TEXT UNIQUE,
  name TEXT, grade TEXT, section TEXT, guardian TEXT, contact TEXT, status TEXT DEFAULT 'Active'
);
CREATE TABLE IF NOT EXISTS staff (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  staff_code TEXT UNIQUE,
  name TEXT, role TEXT, dept TEXT, contact TEXT, status TEXT DEFAULT 'Active'
);
CREATE TABLE IF NOT EXISTS admissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_code TEXT UNIQUE,
  applicant TEXT, grade TEXT, examScore INTEGER, status TEXT DEFAULT 'Under Review'
);
CREATE TABLE IF NOT EXISTS classes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  class_code TEXT UNIQUE,
  grade TEXT, section TEXT, teacher TEXT, room TEXT, students INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS timetable (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tt_code TEXT UNIQUE,
  day TEXT, time TEXT, subject TEXT, class TEXT, teacher TEXT, room TEXT
);
CREATE TABLE IF NOT EXISTS attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  att_code TEXT UNIQUE,
  name TEXT, type TEXT, date TEXT, status TEXT
);
CREATE TABLE IF NOT EXISTS academics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sub_code TEXT UNIQUE,
  subject TEXT, grade TEXT, teacher TEXT, topic TEXT, resources INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS exams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exam_code TEXT UNIQUE,
  name TEXT, class TEXT, date TEXT, status TEXT DEFAULT 'Scheduled'
);
CREATE TABLE IF NOT EXISTS library (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_code TEXT UNIQUE,
  title TEXT, author TEXT, isbn TEXT, copies INTEGER DEFAULT 0, available INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS finance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_code TEXT UNIQUE,
  student TEXT, term TEXT, amount REAL DEFAULT 0, paid REAL DEFAULT 0, status TEXT DEFAULT 'Unpaid'
);
CREATE TABLE IF NOT EXISTS transport (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  route_code TEXT UNIQUE,
  route TEXT, driver TEXT, vehicle TEXT, students INTEGER DEFAULT 0, status TEXT DEFAULT 'Active'
);
CREATE TABLE IF NOT EXISTS inventory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_code TEXT UNIQUE,
  name TEXT, category TEXT, quantity INTEGER DEFAULT 0, location TEXT, condition TEXT
);
CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ann_code TEXT UNIQUE,
  title TEXT, audience TEXT, date TEXT
);
`);

// ---- Seed a small illustrative dataset only if empty ----
const studentCount = db.prepare('SELECT COUNT(*) AS c FROM students').get().c;
if (studentCount === 0) {
  const insStudent = db.prepare(`INSERT INTO students (student_code,name,grade,section,guardian,contact,status) VALUES (?,?,?,?,?,?,?)`);
  const seedStudents = [
    ['STU-1001', 'Add real student records here', 'Grade 9', 'A', 'On file', '0700 000 001', 'Active'],
    ['STU-1002', 'Add real student records here', 'Grade 10', 'B', 'On file', '0700 000 002', 'Active'],
  ];
  const tx = db.transaction((rows) => rows.forEach(r => insStudent.run(...r)));
  tx(seedStudents);

  db.prepare(`INSERT INTO staff (staff_code,name,role,dept,contact,status) VALUES (?,?,?,?,?,?)`)
    .run('STF-201', 'Add real staff records here', 'Mathematics Teacher', 'Sciences', '0711 000 001', 'Active');

  db.prepare(`INSERT INTO finance (invoice_code,student,term,amount,paid,status) VALUES (?,?,?,?,?,?)`)
    .run('INV-1', 'STU-1001', 'Term 2', 45000, 20000, 'Partial');

  db.prepare(`INSERT INTO exams (exam_code,name,class,date,status) VALUES (?,?,?,?,?)`)
    .run('EX-1', 'Mid-Term Mathematics', 'Grade 9A', '2026-08-04', 'Scheduled');

  db.prepare(`INSERT INTO announcements (ann_code,title,audience,date) VALUES (?,?,?,?)`)
    .run('AN-1', 'Welcome to School Management Software', 'Everyone', new Date().toISOString().slice(0,10));
}

module.exports = db;
