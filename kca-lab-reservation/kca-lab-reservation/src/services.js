// Shared helpers: audit trail, notifications (in-app + optional Resend e-mail), business rules.
const config = () => ({
  maxActive: Number(process.env.MAX_ACTIVE_RESERVATIONS || 3),
  maxAdvanceDays: Number(process.env.MAX_ADVANCE_DAYS || 30),
  checkoutEarlyMin: Number(process.env.CHECKOUT_EARLY_MINUTES || 15),
});

function audit(db, userId, action, entity, entityId, details) {
  db.prepare('INSERT INTO audit_logs (user_id, action, entity, entity_id, details) VALUES (?,?,?,?,?)')
    .run(userId ?? null, action, entity, entityId ?? null, details ? JSON.stringify(details) : null);
}

async function sendEmail(to, subject, text) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return;
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: process.env.MAIL_FROM || 'onboarding@resend.dev', to: [to], subject, text }),
    });
  } catch (e) { console.error('[email] failed:', e.message); }
}

function notify(db, userId, type, message) {
  db.prepare('INSERT INTO notifications (user_id, type, message) VALUES (?,?,?)').run(userId, type, message);
  if (process.env.RESEND_API_KEY) {
    const u = db.prepare('SELECT email FROM users WHERE id=?').get(userId);
    if (u) sendEmail(u.email, `KCA Labs: ${type.replace(/_/g, ' ')}`, message);
  }
}

function notifyRoles(db, roles, type, message) {
  const ph = roles.map(() => '?').join(',');
  db.prepare(`SELECT id FROM users WHERE role IN (${ph})`).all(...roles).forEach((u) => notify(db, u.id, type, message));
}

const ACTIVE = "('booked','checked_out')";

/** Derived, display-friendly state for a reservation row. */
function decorate(r, now = new Date().toISOString()) {
  let state = r.status;
  if (r.status === 'checked_out' && r.end_time < now) state = 'overdue';
  else if (r.status === 'booked' && r.end_time < now) state = 'no_show';
  return { ...r, state };
}

const fmt = (iso) => new Date(iso).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';

module.exports = { config, audit, notify, notifyRoles, sendEmail, ACTIVE, decorate, fmt };
