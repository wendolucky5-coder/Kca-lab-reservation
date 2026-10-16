const express = require('express');
const { bad, HttpError } = require('../errors');
const { hashPassword, verifyPassword, signToken, rateLimit } = require('../security');
const { requireAuth } = require('../middleware');
const { audit } = require('../services');

module.exports = (db) => {
  const r = express.Router();
  const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30 });
  const cookieOpts = () => ({ httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', maxAge: 8 * 3600 * 1000, path: '/' });
  const pub = (u) => ({ id: u.id, reg_no: u.reg_no, name: u.name, email: u.email, role: u.role });

  r.post('/register', limiter, (req, res) => {
    const { name, email, password, reg_no = '' } = req.body || {};
    if (!name || String(name).trim().length < 2) throw bad('Please enter your full name.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ''))) throw bad('Please enter a valid e-mail address.');
    if (typeof password !== 'string' || password.length < 8) throw bad('Password must be at least 8 characters.');
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) throw new HttpError(409, 'An account with that e-mail already exists.');
    const info = db.prepare('INSERT INTO users (reg_no, name, email, password_hash, role) VALUES (?,?,?,?,?)')
      .run(String(reg_no).trim(), String(name).trim(), String(email).trim(), hashPassword(password), 'user'); // self-registration is always the lowest role
    audit(db, info.lastInsertRowid, 'register', 'user', info.lastInsertRowid);
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(info.lastInsertRowid);
    res.cookie('token', signToken({ sub: user.id }), cookieOpts());
    res.status(201).json({ user: pub(user) });
  });

  r.post('/login', limiter, (req, res) => {
    const { email, password } = req.body || {};
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email || ''));
    if (!user || !verifyPassword(String(password || ''), user.password_hash)) {
      audit(db, user?.id, 'login_failed', 'user', user?.id, { email });
      throw new HttpError(401, 'Incorrect e-mail or password.');
    }
    audit(db, user.id, 'login', 'user', user.id);
    res.cookie('token', signToken({ sub: user.id }), cookieOpts());
    res.json({ user: pub(user) });
  });

  r.post('/logout', (_req, res) => { res.clearCookie('token', { path: '/' }); res.json({ ok: true }); });

  r.get('/me', (req, res) => res.json({ user: req.user }));

  r.post('/change-password', requireAuth, limiter, (req, res) => {
    const { current_password, new_password } = req.body || {};
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
    if (!verifyPassword(String(current_password || ''), user.password_hash)) throw new HttpError(401, 'Current password is incorrect.');
    if (typeof new_password !== 'string' || new_password.length < 8) throw bad('New password must be at least 8 characters.');
    db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(new_password), user.id);
    audit(db, user.id, 'change_password', 'user', user.id);
    res.json({ ok: true });
  });

  return r;
};
