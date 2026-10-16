const express = require('express');
const { bad, notFound, conflict, HttpError } = require('../errors');
const { requireAuth } = require('../middleware');
const { transaction } = require('../db');
const { audit, notify, notifyRoles, decorate, config, ACTIVE, fmt } = require('../services');

module.exports = (db) => {
  const r = express.Router();
  r.use(requireAuth);

  const SELECT = `SELECT x.*, r.name AS resource_name, r.asset_tag, r.category, u.name AS user_name, u.email AS user_email
    FROM reservations x JOIN resources r ON r.id=x.resource_id JOIN users u ON u.id=x.user_id`;

  r.get('/', (req, res) => {
    const where = []; const p = [];
    const staff = req.user.role !== 'user';
    if (!staff || req.query.mine === '1') { where.push('x.user_id=?'); p.push(req.user.id); }
    if (req.query.status) { where.push('x.status=?'); p.push(req.query.status); }
    if (req.query.resource_id) { where.push('x.resource_id=?'); p.push(req.query.resource_id); }
    if (req.query.date) {
      const d = new Date(req.query.date + 'T00:00:00');
      if (isNaN(d)) throw bad('Invalid date.');
      where.push('x.start_time < ? AND x.end_time > ?'); p.push(new Date(d.getTime() + 864e5).toISOString(), d.toISOString());
    }
    const rows = db.prepare(`${SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY x.start_time DESC LIMIT 300`).all(...p);
    res.json(rows.map((x) => decorate(x)));
  });

  // ---- Smart Reservation Engine ----
  r.post('/', (req, res) => {
    const { resource_id, start_time, end_time, purpose = '' } = req.body || {};
    const cfg = config();
    const start = new Date(start_time), end = new Date(end_time);
    if (isNaN(start) || isNaN(end)) throw bad('Please provide a valid start and end time.');
    if (end <= start) throw bad('End time must be after the start time.');
    if (start.getTime() < Date.now() - 5 * 60000) throw bad('You cannot book a time slot in the past.');
    if (start.getTime() > Date.now() + cfg.maxAdvanceDays * 864e5) throw bad(`Bookings can only be made up to ${cfg.maxAdvanceDays} days ahead.`);
    const item = db.prepare('SELECT * FROM resources WHERE id=?').get(resource_id);
    if (!item) throw notFound('Resource not found');
    if (item.status !== 'available') throw conflict(`${item.name} is currently ${item.status} and cannot be booked.`);
    const hours = (end - start) / 36e5;
    if (hours > item.max_hours) throw bad(`${item.name} can be booked for at most ${item.max_hours} hour(s) at a time.`);
    const s = start.toISOString(), e = end.toISOString(), now = new Date().toISOString();

    const id = transaction(db, () => {
      if (db.prepare(`SELECT 1 FROM reservations WHERE resource_id=? AND status IN ${ACTIVE} AND start_time < ? AND end_time > ?`).get(item.id, e, s)) {
        throw conflict('That time slot overlaps an existing reservation for this item. Please choose another slot.');
      }
      if (db.prepare(`SELECT 1 FROM reservations WHERE user_id=? AND status IN ${ACTIVE} AND start_time < ? AND end_time > ?`).get(req.user.id, e, s)) {
        throw conflict('You already have another reservation that overlaps this time slot.');
      }
      const active = db.prepare(`SELECT COUNT(*) AS n FROM reservations WHERE user_id=? AND status IN ${ACTIVE} AND end_time > ?`).get(req.user.id, now).n;
      if (active >= cfg.maxActive) throw conflict(`You already hold ${cfg.maxActive} active reservations (the maximum). Return or cancel one first.`);
      const info = db.prepare('INSERT INTO reservations (resource_id, user_id, start_time, end_time, purpose) VALUES (?,?,?,?,?)')
        .run(item.id, req.user.id, s, e, String(purpose).slice(0, 300));
      return Number(info.lastInsertRowid);
    });
    audit(db, req.user.id, 'create', 'reservation', id, { resource: item.name, start: s, end: e });
    notify(db, req.user.id, 'booking_confirmed', `Booking confirmed: ${item.name} from ${fmt(s)} to ${fmt(e)}. Present tag ${item.asset_tag} at the lab desk.`);
    res.status(201).json(decorate(db.prepare(`${SELECT} WHERE x.id=?`).get(id)));
  });

  r.post('/:id/cancel', (req, res) => {
    const row = db.prepare(`${SELECT} WHERE x.id=?`).get(req.params.id);
    if (!row) throw notFound('Reservation not found');
    if (row.user_id !== req.user.id && req.user.role === 'user') throw new HttpError(403, 'You can only cancel your own reservations.');
    if (row.status !== 'booked') throw conflict(`A ${row.status.replace('_', ' ')} reservation cannot be cancelled.`);
    db.prepare("UPDATE reservations SET status='cancelled' WHERE id=?").run(row.id);
    audit(db, req.user.id, 'cancel', 'reservation', row.id);
    if (row.user_id !== req.user.id) notify(db, row.user_id, 'booking_cancelled', `Your booking for ${row.resource_name} (${fmt(row.start_time)}) was cancelled by lab staff.`);
    else notify(db, row.user_id, 'booking_cancelled', `You cancelled your booking for ${row.resource_name} (${fmt(row.start_time)}).`);
    res.json(decorate(db.prepare(`${SELECT} WHERE x.id=?`).get(row.id)));
  });

  return r;
};
