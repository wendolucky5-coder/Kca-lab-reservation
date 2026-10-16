const { verifyToken, parseCookies } = require('./security');
const { HttpError } = require('./errors');

function loadUser(db) {
  const q = db.prepare('SELECT id, reg_no, name, email, role FROM users WHERE id = ?');
  return (req, _res, next) => {
    const token = parseCookies(req.headers.cookie).token;
    const payload = verifyToken(token);
    req.user = payload ? q.get(payload.sub) || null : null;
    next();
  };
}

const requireAuth = (req, _res, next) => (req.user ? next() : next(new HttpError(401, 'Please sign in.')));

const requireRole = (...roles) => (req, _res, next) => {
  if (!req.user) return next(new HttpError(401, 'Please sign in.'));
  if (!roles.includes(req.user.role)) return next(new HttpError(403, 'You do not have permission to do that.'));
  next();
};

/** Basic CSRF defence: cookies are SameSite=Strict and state-changing calls must be JSON. */
function requireJsonForWrites(req, _res, next) {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && req.headers['content-length'] !== '0'
      && req.headers['content-type'] && !req.headers['content-type'].includes('application/json')) {
    return next(new HttpError(415, 'Content-Type must be application/json.'));
  }
  next();
}

function securityHeaders(_req, res, next) {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; media-src 'self' blob:",
  });
  next();
}

module.exports = { loadUser, requireAuth, requireRole, requireJsonForWrites, securityHeaders };
