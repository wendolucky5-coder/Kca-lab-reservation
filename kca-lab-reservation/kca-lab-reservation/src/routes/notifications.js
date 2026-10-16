const express = require('express');
const { requireAuth } = require('../middleware');

module.exports = (db) => {
  const r = express.Router();
  r.use(requireAuth);
  r.get('/', (req, res) => {
    const items = db.prepare('SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 50').all(req.user.id);
    const unread = db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id=? AND is_read=0').get(req.user.id).n;
    res.json({ unread, items });
  });
  r.post('/read-all', (req, res) => { db.prepare('UPDATE notifications SET is_read=1 WHERE user_id=?').run(req.user.id); res.json({ ok: true }); });
  r.post('/:id/read', (req, res) => { db.prepare('UPDATE notifications SET is_read=1 WHERE id=? AND user_id=?').run(req.params.id, req.user.id); res.json({ ok: true }); });
  return r;
};
