// Background jobs: booking-start reminders, return-due reminders, overdue alerts.
const { notify, notifyRoles, fmt } = require('./services');

function runJobs(db) {
  const now = new Date(), nowIso = now.toISOString();
  const soon = new Date(now.getTime() + 30 * 60000).toISOString();
  const Q = `SELECT x.id, x.user_id, x.start_time, x.end_time, r.name, r.asset_tag, u.name AS user_name FROM reservations x JOIN resources r ON r.id=x.resource_id JOIN users u ON u.id=x.user_id`;

  db.prepare(`${Q} WHERE x.status='booked' AND x.reminded_start=0 AND x.start_time<=? AND x.end_time>?`).all(soon, nowIso).forEach((x) => {
    notify(db, x.user_id, 'booking_reminder', `Reminder: your booking for ${x.name} starts at ${fmt(x.start_time)}.`);
    db.prepare('UPDATE reservations SET reminded_start=1 WHERE id=?').run(x.id);
  });
  db.prepare(`${Q} WHERE x.status='checked_out' AND x.reminded_due=0 AND x.end_time<=? AND x.end_time>?`).all(soon, nowIso).forEach((x) => {
    notify(db, x.user_id, 'return_due', `${x.name} is due back by ${fmt(x.end_time)}. Please return it to the lab desk.`);
    db.prepare('UPDATE reservations SET reminded_due=1 WHERE id=?').run(x.id);
  });
  db.prepare(`${Q} WHERE x.status='checked_out' AND x.reminded_overdue=0 AND x.end_time<=?`).all(nowIso).forEach((x) => {
    notify(db, x.user_id, 'overdue', `OVERDUE: ${x.name} was due ${fmt(x.end_time)}. Please return it immediately.`);
    notifyRoles(db, ['technician', 'admin'], 'overdue', `${x.name} (${x.asset_tag}) is overdue — borrowed by ${x.user_name}.`);
    db.prepare('UPDATE reservations SET reminded_overdue=1, reminded_due=1 WHERE id=?').run(x.id);
  });
}

function startScheduler(db, everyMs = 60000) {
  const t = setInterval(() => { try { runJobs(db); } catch (e) { console.error('[scheduler]', e.message); } }, everyMs);
  t.unref();
  return t;
}

module.exports = { runJobs, startScheduler };
