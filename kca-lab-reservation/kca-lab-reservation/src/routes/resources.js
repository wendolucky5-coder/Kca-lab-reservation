const express = require('express');
const QRCode = require('qrcode');
const { bad, notFound, conflict } = require('../errors');
const { requireAuth, requireRole } = require('../middleware');
const { audit, ACTIVE } = require('../services');

const STATUSES = ['available', 'maintenance', 'retired'];

module.exports = (db) => {
  const r = express.Router();
  r.use(requireAuth);

  // Catalog with live availability. Optional filters: q, category, status, free_from + free_to (ISO)
  r.get('/', (req, res) => {
    const now = new Date().toISOString();
    const { q, category, free_from, free_to } = req.query;
    const where = []; const params = { now };
    if (q) { where.push('(r.name LIKE :q OR r.asset_tag LIKE :q OR r.description LIKE :q OR r.location LIKE :q)'); params.q = `%${q}%`; }
    if (category) { where.push('r.category = :category'); params.category = category; }
    if (req.user.role === 'user') where.push("r.status != 'retired'");
    if (free_from && free_to) {
      const f = new Date(free_from), t = new Date(free_to);
      if (isNaN(f) || isNaN(t) || t <= f) throw bad('Invalid availability window.');
      where.push(`r.status = 'available' AND NOT EXISTS (SELECT 1 FROM reservations x WHERE x.resource_id = r.id AND x.status IN ${ACTIVE} AND x.start_time < :to AND x.end_time > :from)`);
      params.from = f.toISOString(); params.to = t.toISOString();
    }
    const rows = db.prepare(`
      SELECT r.*,
        (SELECT COUNT(*) FROM reservations x WHERE x.resource_id=r.id AND x.status='checked_out') AS in_use,
        (SELECT COUNT(*) FROM reservations x WHERE x.resource_id=r.id AND x.status='booked' AND x.start_time<=:now AND x.end_time>:now) AS reserved_now,
        (SELECT MIN(x.start_time) FROM reservations x WHERE x.resource_id=r.id AND x.status='booked' AND x.end_time>:now) AS next_booking
      FROM resources r ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY r.category, r.name`).all(params);
    res.json(rows.map((x) => ({
      ...x,
      live_status: x.status !== 'available' ? x.status : x.in_use ? 'in_use' : x.reserved_now ? 'reserved' : 'available',
    })));
  });

  r.get('/categories', (_req, res) => res.json(db.prepare('SELECT DISTINCT category FROM resources ORDER BY category').all().map((x) => x.category)));

  r.get('/:id', (req, res) => {
    const row = db.prepare('SELECT * FROM resources WHERE id=?').get(req.params.id);
    if (!row) throw notFound('Resource not found');
    res.json(row);
  });

  // Upcoming bookings (time slots only, names shown to staff) so users can see what is taken
  r.get('/:id/bookings', (req, res) => {
    const from = req.query.from ? new Date(req.query.from) : new Date();
    const to = req.query.to ? new Date(req.query.to) : new Date(Date.now() + 7 * 864e5);
    if (isNaN(from) || isNaN(to)) throw bad('Invalid date range.');
    const rows = db.prepare(`SELECT x.id, x.start_time, x.end_time, x.status, u.name AS user_name FROM reservations x JOIN users u ON u.id=x.user_id
      WHERE x.resource_id=? AND x.status IN ${ACTIVE} AND x.start_time < ? AND x.end_time > ? ORDER BY x.start_time`).all(req.params.id, to.toISOString(), from.toISOString());
    const staff = req.user.role !== 'user';
    res.json(rows.map((x) => ({ id: x.id, start_time: x.start_time, end_time: x.end_time, status: x.status, ...(staff ? { user_name: x.user_name } : {}) })));
  });

  // QR tag image (encodes the asset tag, e.g. KCA-0007)
  // (Express 4 does not catch async errors, so forward them to next() ourselves.)
  r.get('/:id/qr.png', async (req, res, next) => {
    try {
      const row = db.prepare('SELECT asset_tag FROM resources WHERE id=?').get(req.params.id);
      if (!row) throw notFound('Resource not found');
      const png = await QRCode.toBuffer(row.asset_tag, { width: 320, margin: 2, errorCorrectionLevel: 'M' });
      res.type('png').send(png);
    } catch (e) { next(e); }
  });

  function validate(b, partial = false) {
    const out = {};
    for (const f of ['name', 'category']) if (!partial || b[f] !== undefined) {
      if (!b[f] || !String(b[f]).trim()) throw bad(`${f} is required.`);
      out[f] = String(b[f]).trim();
    }
    if (b.location !== undefined) out.location = String(b.location).trim();
    if (b.description !== undefined) out.description = String(b.description).trim();
    if (b.asset_tag !== undefined && String(b.asset_tag).trim()) out.asset_tag = String(b.asset_tag).trim().toUpperCase();
    if (b.max_hours !== undefined) {
      const h = Number(b.max_hours);
      if (!(h > 0 && h <= 168)) throw bad('max_hours must be between 0 and 168.');
      out.max_hours = h;
    }
    if (b.status !== undefined) {
      if (!STATUSES.includes(b.status)) throw bad('Invalid status.');
      out.status = b.status;
    }
    return out;
  }

  r.post('/', requireRole('admin'), (req, res) => {
    const v = validate(req.body || {});
    if (v.asset_tag && db.prepare('SELECT 1 FROM resources WHERE asset_tag=?').get(v.asset_tag)) throw conflict('That asset tag is already in use.');
    const info = db.prepare('INSERT INTO resources (asset_tag, name, category, location, description, max_hours, status) VALUES (?,?,?,?,?,?,?)')
      .run(v.asset_tag ?? null, v.name, v.category, v.location ?? '', v.description ?? '', v.max_hours ?? 4, v.status ?? 'available');
    const id = Number(info.lastInsertRowid);
    if (!v.asset_tag) db.prepare('UPDATE resources SET asset_tag=? WHERE id=?').run(`KCA-${String(id).padStart(4, '0')}`, id);
    audit(db, req.user.id, 'create', 'resource', id, { name: v.name });
    res.status(201).json(db.prepare('SELECT * FROM resources WHERE id=?').get(id));
  });

  r.put('/:id', requireRole('admin'), (req, res) => {
    const cur = db.prepare('SELECT * FROM resources WHERE id=?').get(req.params.id);
    if (!cur) throw notFound('Resource not found');
    const v = validate(req.body || {}, true);
    if (v.asset_tag && v.asset_tag !== cur.asset_tag && db.prepare('SELECT 1 FROM resources WHERE asset_tag=?').get(v.asset_tag)) throw conflict('That asset tag is already in use.');
    const next = { ...cur, ...v };
    db.prepare('UPDATE resources SET asset_tag=?, name=?, category=?, location=?, description=?, max_hours=?, status=? WHERE id=?')
      .run(next.asset_tag, next.name, next.category, next.location, next.description, next.max_hours, next.status, cur.id);
    audit(db, req.user.id, 'update', 'resource', cur.id, v);
    res.json(db.prepare('SELECT * FROM resources WHERE id=?').get(cur.id));
  });

  r.delete('/:id', requireRole('admin'), (req, res) => {
    if (db.prepare('SELECT 1 FROM reservations WHERE resource_id=?').get(req.params.id)) throw conflict('This item has booking history. Set its status to "retired" instead.');
    db.prepare('DELETE FROM maintenance_logs WHERE resource_id=?').run(req.params.id);
    const info = db.prepare('DELETE FROM resources WHERE id=?').run(req.params.id);
    if (!info.changes) throw notFound('Resource not found');
    audit(db, req.user.id, 'delete', 'resource', Number(req.params.id));
    res.json({ ok: true });
  });

  return r;
};
