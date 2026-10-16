const express = require('express');
const { bad, notFound, conflict } = require('../errors');
const { requireRole } = require('../middleware');
const { transaction } = require('../db');
const { audit, notify, notifyRoles, config, fmt } = require('../services');

const CONDITIONS = ['good', 'damaged', 'missing_parts'];

module.exports = (db) => {
  const r = express.Router();
  r.use(requireRole('technician', 'admin'));

  // Scan a QR tag (or type the asset tag): tells the attendant what to do next.
  r.get('/lookup', (req, res) => {
    const code = String(req.query.code || '').trim();
    if (!code) throw bad('No code scanned.');
    const item = db.prepare('SELECT * FROM resources WHERE asset_tag = ?').get(code);
    if (!item) throw notFound(`No item with tag "${code}".`);
    const nowD = new Date(), now = nowD.toISOString();
    const early = new Date(nowD.getTime() + config().checkoutEarlyMin * 60000).toISOString();
    const SEL = `SELECT x.*, u.name AS user_name, u.reg_no FROM reservations x JOIN users u ON u.id=x.user_id`;
    const out = db.prepare(`${SEL} WHERE x.resource_id=? AND x.status='checked_out' ORDER BY x.checked_out_at DESC LIMIT 1`).get(item.id);
    let action = null, reservation = null, message;
    if (out) {
      action = 'return'; reservation = out;
      message = `Checked out to ${out.user_name}${out.end_time < now ? ' — OVERDUE' : ''}. Record the return.`;
    } else if (item.status !== 'available') {
      message = `This item is ${item.status} and cannot be handed out.`;
    } else {
      const due = db.prepare(`${SEL} WHERE x.resource_id=? AND x.status='booked' AND x.start_time<=? AND x.end_time>? ORDER BY x.start_time LIMIT 1`).get(item.id, early, now);
      if (due) { action = 'checkout'; reservation = due; message = `Booked by ${due.user_name} (${due.reg_no || 'no reg no.'}) for ${fmt(due.start_time)} – ${fmt(due.end_time)}.`; }
      else message = 'No active reservation for this item right now. It cannot be checked out without a booking.';
    }
    res.json({ item, action, reservation, message });
  });

  r.post('/confirm', (req, res) => {
    const { reservation_id, action, condition = 'good', notes = '' } = req.body || {};
    const row = db.prepare(`SELECT x.*, r.name AS resource_name, r.status AS resource_status, r.asset_tag FROM reservations x JOIN resources r ON r.id=x.resource_id WHERE x.id=?`).get(reservation_id);
    if (!row) throw notFound('Reservation not found');
    const now = new Date().toISOString();

    if (action === 'checkout') {
      transaction(db, () => {
        const cur = db.prepare('SELECT status FROM reservations WHERE id=?').get(row.id);
        if (cur.status !== 'booked') throw conflict('This reservation is no longer waiting for check-out.');
        if (row.resource_status !== 'available') throw conflict(`Item is ${row.resource_status}.`);
        db.prepare("UPDATE reservations SET status='checked_out', checked_out_at=?, checked_out_by=? WHERE id=?").run(now, req.user.id, row.id);
      });
      audit(db, req.user.id, 'check_out', 'reservation', row.id, { item: row.asset_tag });
      notify(db, row.user_id, 'checked_out', `${row.resource_name} was checked out to you. Please return it by ${fmt(row.end_time)}.`);
    } else if (action === 'return') {
      if (!CONDITIONS.includes(condition)) throw bad('Invalid condition.');
      if (row.status !== 'checked_out') throw conflict('This item is not currently checked out.');
      const late = now > row.end_time;
      transaction(db, () => {
        db.prepare("UPDATE reservations SET status='returned', returned_at=?, returned_by=?, return_condition=?, return_notes=? WHERE id=?")
          .run(now, req.user.id, condition, String(notes).slice(0, 300), row.id);
        if (condition !== 'good') {
          db.prepare("INSERT INTO maintenance_logs (resource_id, reported_by, issue, severity) VALUES (?,?,?,?)")
            .run(row.resource_id, req.user.id, `Returned ${condition.replace('_', ' ')} by reservation #${row.id}. ${notes}`.trim(), condition === 'damaged' ? 'major' : 'minor');
          db.prepare("UPDATE resources SET status='maintenance' WHERE id=? AND status='available'").run(row.resource_id);
        }
      });
      audit(db, req.user.id, 'check_in', 'reservation', row.id, { item: row.asset_tag, condition, late });
      notify(db, row.user_id, 'returned', `Thanks — ${row.resource_name} was returned${late ? ' (late)' : ''}${condition !== 'good' ? ` and logged as ${condition.replace('_', ' ')}` : ''}.`);
      if (condition !== 'good') notifyRoles(db, ['technician', 'admin'], 'maintenance', `${row.resource_name} (${row.asset_tag}) returned ${condition.replace('_', ' ')} — added to maintenance queue.`);
    } else throw bad('action must be "checkout" or "return".');

    res.json(db.prepare('SELECT * FROM reservations WHERE id=?').get(row.id));
  });

  return r;
};
