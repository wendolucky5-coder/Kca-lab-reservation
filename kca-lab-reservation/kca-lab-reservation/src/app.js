const path = require('path');
const express = require('express');
const { loadUser, requireJsonForWrites, securityHeaders } = require('./middleware');

function createApp(db) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(securityHeaders);
  app.use(express.json({ limit: '50kb' }));
  app.use(requireJsonForWrites);
  app.use(loadUser(db));

  app.use('/api/auth', require('./routes/auth')(db));
  app.use('/api/resources', require('./routes/resources')(db));
  app.use('/api/reservations', require('./routes/reservations')(db));
  app.use('/api/handover', require('./routes/handover')(db));
  app.use('/api/maintenance', require('./routes/maintenance')(db));
  app.use('/api/notifications', require('./routes/notifications')(db));
  app.use('/api/reports', require('./routes/reports')(db));
  app.use('/api/users', require('./routes/users')(db));

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Unknown API endpoint.' }));

  // Browser QR scanner library, served locally (no CDN needed)
  app.use('/vendor', express.static(path.join(__dirname, '..', 'node_modules', 'html5-qrcode'), { index: false }));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err.status) return res.status(err.status).json({ error: err.message });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed JSON.' });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  });
  return app;
}

module.exports = { createApp };
