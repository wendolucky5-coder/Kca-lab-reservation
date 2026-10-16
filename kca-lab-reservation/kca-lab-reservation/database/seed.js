// Demo data. Run `npm run seed` (adds if empty) or `npm run reset` (wipes the database first).
const fs = require('fs');
const path = require('path');
const { hashPassword } = require('../src/security');

const DEMO_PASSWORD = 'Password123!';

const RESOURCES = [
  ['Dell Latitude Laptop #1', 'Laptops', 'Computer Lab 1 – Store', 'Core i7, 16GB RAM, for programming practicals', 8],
  ['Dell Latitude Laptop #2', 'Laptops', 'Computer Lab 1 – Store', 'Core i7, 16GB RAM, for programming practicals', 8],
  ['Epson Portable Projector', 'Multimedia', 'Lab Desk', 'XGA portable projector with HDMI/VGA cables', 4],
  ['Multimedia Kit (Camera + Tripod)', 'Multimedia', 'Lab Desk', 'DSLR camera, tripod, lapel mic and 2 SD cards', 24],
  ['Arduino Starter Kit', 'Electronics', 'Electronics Lab', 'Uno board, breadboard, sensors, jumper wires', 24],
  ['Raspberry Pi 4 Kit', 'Electronics', 'Electronics Lab', 'Pi 4 (4GB), PSU, case, 32GB SD card', 24],
  ['Digital Oscilloscope', 'Electronics', 'Electronics Lab', '100MHz 2-channel oscilloscope', 3],
  ['Cisco Router & Switch Kit', 'Networking', 'Networking Lab', '2x router, 2x switch, console and patch cables', 4],
  ['Cable Tester & Crimping Kit', 'Networking', 'Networking Lab', 'RJ45 crimper, tester, 20 connectors', 4],
  ['Networking Lab A', 'Lab Spaces', 'Block B, Room 204', 'Shared lab space, 30 seats', 3],
  ['Computer Lab 2', 'Lab Spaces', 'Block B, Room 110', 'Shared lab space, 40 seats with projector', 3],
  ['VR Headset', 'Multimedia', 'Lab Desk', 'Standalone VR headset with controllers', 4],
];

function seed(db) {
  const insU = db.prepare('INSERT INTO users (reg_no, name, email, password_hash, role) VALUES (?,?,?,?,?)');
  const pw = hashPassword(DEMO_PASSWORD);
  insU.run('', 'System Administrator', 'admin@kca.local', pw, 'admin');
  insU.run('', 'Lab Technician', 'tech@kca.local', pw, 'technician');
  insU.run('24/06571', 'Demo Student', 'student@kca.local', pw, 'user');
  const insR = db.prepare('INSERT INTO resources (name, category, location, description, max_hours) VALUES (?,?,?,?,?)');
  const tag = db.prepare('UPDATE resources SET asset_tag=? WHERE id=?');
  RESOURCES.forEach((r) => { const id = Number(insR.run(...r).lastInsertRowid); tag.run(`KCA-${String(id).padStart(4, '0')}`, id); });
}

module.exports = { seed, DEMO_PASSWORD };

if (require.main === module) {
  if (fs.existsSync(path.join(__dirname, '..', '.env'))) process.loadEnvFile(path.join(__dirname, '..', '.env'));
  const file = process.env.DB_FILE || './data/kca_lab.db';
  if (process.argv.includes('--reset')) for (const s of ['', '-wal', '-shm']) fs.rmSync(file + s, { force: true });
  const { openDb } = require('../src/db');
  const db = openDb(file);
  if (db.prepare('SELECT 1 FROM users LIMIT 1').get()) console.log('Database already has data. Use `npm run reset` to start over.');
  else { seed(db); console.log(`Seeded. Demo logins (password "${DEMO_PASSWORD}"): admin@kca.local, tech@kca.local, student@kca.local`); }
}
