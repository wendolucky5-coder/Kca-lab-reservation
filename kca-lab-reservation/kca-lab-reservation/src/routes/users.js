const express = require('express');
const { bad, notFound, HttpError } = require('../errors');
const { requireRole } = require('../middleware');
const { audit } = require('../services');

module.exports = (db) => {
  const r = express.Router();
  r.use(requireRole('admin'));
  r.get('/', (_req, res) => res.json(db.prepare('SELECT id, reg_no, name, email, role, created_at FROM users ORDER BY created_at DESC').all()));
  r.patch('/:id/role', (req, res) => {
    const { role } = req.body || {};
    if (!['user', 'technician', 'admin'].includes(role)) throw bad('Invalid role.');
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
    if (!u) throw notFound('User not found');
    if (u.id === req.user.id) throw new HttpError(409, 'You cannot change your own role.');
    db.prepare('UPDATE users SET role=? WHERE id=?').run(role, u.id);
    audit(db, req.user.id, 'role_change', 'user', u.id, { from: u.role, to: role });
    res.json({ ok: true });
  });
  return r;
};
