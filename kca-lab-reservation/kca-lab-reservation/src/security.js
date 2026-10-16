// Password hashing, signed session tokens, cookies and a tiny rate limiter — Node built-ins only.
const crypto = require('crypto');

const DEV_SECRET = 'dev-only-secret-change-me';
function secret() {
  const s = process.env.JWT_SECRET || DEV_SECRET;
  if (process.env.NODE_ENV === 'production' && (s === DEV_SECRET || s === 'change-me-in-production' || s.length < 24)) {
    throw new Error('Set a strong JWT_SECRET (24+ chars) in production.');
  }
  return s;
}

// ---- passwords (scrypt) ----
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}
function verifyPassword(password, stored) {
  const [alg, saltHex, keyHex] = String(stored).split('$');
  if (alg !== 'scrypt' || !saltHex || !keyHex) return false;
  const key = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), 64);
  const expected = Buffer.from(keyHex, 'hex');
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}

// ---- signed tokens (HS256-style, compact) ----
const b64 = (b) => Buffer.from(b).toString('base64url');
function signToken(payload, ttlSeconds = 8 * 3600) {
  const body = b64(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds }));
  const sig = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}
function verifyToken(token) {
  if (typeof token !== 'string') return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    return payload.exp > Date.now() / 1000 ? payload : null;
  } catch { return null; }
}

function parseCookies(header = '') {
  const out = {};
  header.split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

// ---- rate limiter (per key, fixed window, in memory) ----
function rateLimit({ windowMs, max, message = 'Too many attempts, try again later.' }) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip || 'x';
    const rec = hits.get(key);
    if (!rec || rec.reset < now) { hits.set(key, { n: 1, reset: now + windowMs }); return next(); }
    rec.n += 1;
    if (rec.n > max) return res.status(429).json({ error: message });
    next();
  };
}

module.exports = { hashPassword, verifyPassword, signToken, verifyToken, parseCookies, rateLimit };
