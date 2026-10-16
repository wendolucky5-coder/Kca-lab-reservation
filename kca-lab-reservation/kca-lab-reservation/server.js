const fs = require('fs');
const path = require('path');
if (fs.existsSync(path.join(__dirname, '.env'))) process.loadEnvFile(path.join(__dirname, '.env'));

const { openDb } = require('./src/db');
const { createApp } = require('./src/app');
const { startScheduler, runJobs } = require('./src/scheduler');
const { seed } = require('./database/seed');

const db = openDb(process.env.DB_FILE || './data/kca_lab.db');
if (!db.prepare('SELECT 1 FROM users LIMIT 1').get()) {
  seed(db);
  console.log('Empty database detected — demo data loaded (see README for demo logins).');
}
runJobs(db);
startScheduler(db);

const port = Number(process.env.PORT || 3000);
createApp(db).listen(port, () => console.log(`KCA Lab Reservation running at http://localhost:${port}`));
