const express = require('express');
const { bad } = require('../errors');
const { requireRole } = require('../middleware');

const csvCell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

module.exports = (db) => {
  const r = express.Router();
  r.use(requireRole('technician', 'admin'));

  r.get('/summary', (_req, res) => {
    const since30 = new Date(Date.now() - 30 * 864e5).toISOString();
    const now = new Date().toISOString();
    const count = (sql, ...p) => db.prepare(sql).get(...p).n;
    res.json({
      resources: db.prepare('SELECT status, COUNT(*) AS n FROM resources GROUP BY status').all(),
      users: count('SELECT COUNT(*) AS n FROM users'),
      reservations_30d: count('SELECT COUNT(*) AS n FROM reservations WHERE created_at >= ?', since30),
      checked_out_now: count("SELECT COUNT(*) AS n FROM reservations WHERE status='checked_out'"),
      overdue_now: count("SELECT COUNT(*) AS n FROM reservations WHERE status='checked_out' AND end_time < ?", now),
      open_issues: count("SELECT COUNT(*) AS n FROM maintenance_logs WHERE status != 'resolved'"),
      top_resources: db.prepare(`SELECT r.name, r.asset_tag, COUNT(*) AS bookings FROM reservations x JOIN resources r ON r.id=x.resource_id
        WHERE x.start_time >= ? AND x.status != 'cancelled' GROUP BY r.id ORDER BY bookings DESC LIMIT 5`).all(since30),
      daily: db.prepare(`SELECT substr(start_time,1,10) AS day, COUNT(*) AS n FROM reservations WHERE start_time >= ? AND status != 'cancelled' GROUP BY day ORDER BY day`).all(new Date(Date.now() - 14 * 864e5).toISOString()),
    });
  });

  // Monthly usage report (JSON or CSV). month=YYYY-MM
  r.get('/monthly', (req, res) => {
    const month = String(req.query.month || new Date().toISOString().slice(0, 7));
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw bad('month must look like 2026-10');
    const [y, m] = month.split('-').map(Number);
    const from = new Date(Date.UTC(y, m - 1, 1)).toISOString(), to = new Date(Date.UTC(y, m, 1)).toISOString();
    const rows = db.prepare(`
      SELECT r.asset_tag, r.name, r.category,
        COUNT(x.id) AS bookings,
        ROUND(COALESCE(SUM((julianday(x.end_time)-julianday(x.start_time))*24),0),1) AS hours_booked,
        COALESCE(SUM(x.status IN ('checked_out','returned')),0) AS handovers,
        COALESCE(SUM(x.status='cancelled'),0) AS cancellations,
        COALESCE(SUM(x.status='returned' AND x.returned_at > x.end_time),0) AS late_returns,
        COALESCE(SUM(x.return_condition IN ('damaged','missing_parts')),0) AS problem_returns,
        (SELECT COUNT(*) FROM maintenance_logs m WHERE m.resource_id=r.id AND m.created_at>=? AND m.created_at<?) AS issues_reported
      FROM resources r LEFT JOIN reservations x ON x.resource_id=r.id AND x.start_time>=? AND x.start_time<?
      GROUP BY r.id ORDER BY bookings DESC, r.name`).all(from, to, from, to);
    if (req.query.format === 'csv') {
      const cols = ['asset_tag', 'name', 'category', 'bookings', 'hours_booked', 'handovers', 'cancellations', 'late_returns', 'problem_returns', 'issues_reported'];
      const csv = [cols.join(','), ...rows.map((x) => cols.map((c) => csvCell(x[c])).join(','))].join('\n');
      res.set('Content-Disposition', `attachment; filename="usage-${month}.csv"`).type('text/csv').send(csv);
    } else res.json({ month, rows });
  });

  r.get('/audit', (req, res) => {
    const where = req.query.entity ? 'WHERE a.entity = ?' : '';
    const rows = db.prepare(`SELECT a.*, u.name AS user_name FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id ${where} ORDER BY a.id DESC LIMIT 200`)
      .all(...(req.query.entity ? [req.query.entity] : []));
    res.json(rows);
  });

  return r;
};
