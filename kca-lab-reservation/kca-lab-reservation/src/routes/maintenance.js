const express = require('express');
const { bad, notFound } = require('../errors');
const { requireAuth, requireRole } = require('../middleware');
const { audit, notify, notifyRoles, ACTIVE, fmt } = require('../services');

module.exports = (db) => {
  const r = express.Router();
  r.use(requireAuth);

  r.get('/', requireRole('technician', 'admin'), (req, res) => {
    const where = req.query.status ? 'WHERE m.status = ?' : '';
    const rows = db.prepare(`SELECT m.*, r.name AS resource_name, r.asset_tag, u.name AS reporter, v.name AS resolver
      FROM maintenance_logs m JOIN resources r ON r.id=m.resource_id LEFT JOIN users u ON u.id=m.reported_by LEFT JOIN users v ON v.id=m.resolved_by
      ${where} ORDER BY (m.status='resolved'), m.created_at DESC LIMIT 300`).all(...(req.query.status ? [req.query.status] : []));
    res.json(rows);
  });

  // Anyone can report a fault; technicians/admins (or a "critical" report) take the item out of circulation.
  r.post('/', (req, res) => {
    const { resource_id, issue, severity = 'minor' } = req.body || {};
    if (!['minor', 'major', 'critical'].includes(severity)) throw bad('Invalid severity.');
    if (!issue || String(issue).trim().length < 3) throw bad('Please describe the problem.');
    const item = db.prepare('SELECT * FROM resources WHERE id=?').get(resource_id);
    if (!item) throw notFound('Resource not found');
    const info = db.prepare('INSERT INTO maintenance_logs (resource_id, reported_by, issue, severity) VALUES (?,?,?,?)')
      .run(item.id, req.user.id, String(issue).trim().slice(0, 500), severity);
    const id = Number(info.lastInsertRowid);
    const takeOut = req.user.role !== 'user' || severity === 'critical';
    if (takeOut && item.status === 'available') {
      db.prepare("UPDATE resources SET status='maintenance' WHERE id=?").run(item.id);
      const affected = db.prepare(`SELECT x.id, x.user_id, x.start_time FROM reservations x WHERE x.resource_id=? AND x.status='booked' AND x.end_time>?`).all(item.id, new Date().toISOString());
      affected.forEach((a) => notify(db, a.user_id, 'maintenance', `${item.name} was flagged for maintenance. Your booking on ${fmt(a.start_time)} may be affected — check with the lab desk.`));
    }
    audit(db, req.user.id, 'report', 'maintenance', id, { item: item.asset_tag, severity });
    notifyRoles(db, ['technician', 'admin'], 'maintenance', `New ${severity} issue on ${item.name} (${item.asset_tag}): ${String(issue).trim().slice(0, 120)}`);
    res.status(201).json(db.prepare('SELECT * FROM maintenance_logs WHERE id=?').get(id));
  });

  r.patch('/:id', requireRole('technician', 'admin'), (req, res) => {
    const m = db.prepare('SELECT * FROM maintenance_logs WHERE id=?').get(req.params.id);
    if (!m) throw notFound('Log not found');
    const { status, resolution = '' } = req.body || {};
    if (!['open', 'in_progress', 'resolved'].includes(status)) throw bad('Invalid status.');
    if (status === 'resolved') {
      db.prepare("UPDATE maintenance_logs SET status='resolved', resolution=?, resolved_by=?, resolved_at=? WHERE id=?")
        .run(String(resolution).slice(0, 500), req.user.id, new Date().toISOString(), m.id);
      const stillOpen = db.prepare("SELECT 1 FROM maintenance_logs WHERE resource_id=? AND status!='resolved'").get(m.resource_id);
      if (!stillOpen) db.prepare("UPDATE resources SET status='available' WHERE id=? AND status='maintenance'").run(m.resource_id);
    } else {
      db.prepare("UPDATE maintenance_logs SET status=?, resolved_by=NULL, resolved_at=NULL WHERE id=?").run(status, m.id);
      db.prepare("UPDATE resources SET status='maintenance' WHERE id=? AND status='available'").run(m.resource_id);
    }
    audit(db, req.user.id, status, 'maintenance', m.id, { resolution });
    res.json(db.prepare('SELECT * FROM maintenance_logs WHERE id=?').get(m.id));
  });

  return r;
};
