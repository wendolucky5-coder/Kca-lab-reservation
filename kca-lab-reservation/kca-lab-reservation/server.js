const fs = require('fs');
const path = require('path');
if (fs.existsSync(path.join(__dirname, '.env'))) process.loadEnvFile(path.join(__dirname, '.env'));

const { openDb } = require('./src/db');
const { createApp } = require('./src/app');
const { startScheduler, runJobs } = require('./src/scheduler');
const { seed } = require('./database/seed');

const dbFile = process.env.DB_FILE || './data/kca_lab.db';
const dbDir = path.dirname(dbFile);

// Ensure the data directory exists
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = openDb(dbFile);
runJobs(db);
startScheduler(db);

const port = Number(process.env.PORT || 3000);
createApp(db).listen(port, () => console.log(`KCA Lab Reservation running at http://localhost:${port}`));
