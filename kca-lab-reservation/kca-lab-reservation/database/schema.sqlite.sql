-- KCA Smart Equipment & Lab Asset Reservation System (SQLite schema)
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  reg_no        TEXT,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','technician','admin')),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS resources (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_tag   TEXT UNIQUE COLLATE NOCASE,
  name        TEXT NOT NULL,
  category    TEXT NOT NULL,
  location    TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available','maintenance','retired')),
  max_hours   REAL NOT NULL DEFAULT 4 CHECK (max_hours > 0),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS reservations (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  resource_id      INTEGER NOT NULL REFERENCES resources(id),
  user_id          INTEGER NOT NULL REFERENCES users(id),
  start_time       TEXT NOT NULL,   -- ISO-8601 UTC
  end_time         TEXT NOT NULL,   -- ISO-8601 UTC
  purpose          TEXT NOT NULL DEFAULT '',
  status           TEXT NOT NULL DEFAULT 'booked' CHECK (status IN ('booked','checked_out','returned','cancelled')),
  checked_out_at   TEXT,
  checked_out_by   INTEGER REFERENCES users(id),
  returned_at      TEXT,
  returned_by      INTEGER REFERENCES users(id),
  return_condition TEXT CHECK (return_condition IN ('good','damaged','missing_parts')),
  return_notes     TEXT,
  reminded_start   INTEGER NOT NULL DEFAULT 0,
  reminded_due     INTEGER NOT NULL DEFAULT 0,
  reminded_overdue INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (end_time > start_time)
);
CREATE INDEX IF NOT EXISTS idx_res_resource_time ON reservations(resource_id, start_time, end_time);
CREATE INDEX IF NOT EXISTS idx_res_user ON reservations(user_id);

CREATE TABLE IF NOT EXISTS maintenance_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  resource_id INTEGER NOT NULL REFERENCES resources(id),
  reported_by INTEGER REFERENCES users(id),
  issue       TEXT NOT NULL,
  severity    TEXT NOT NULL DEFAULT 'minor' CHECK (severity IN ('minor','major','critical')),
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','resolved')),
  resolution  TEXT,
  resolved_by INTEGER REFERENCES users(id),
  resolved_at TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  type       TEXT NOT NULL,
  message    TEXT NOT NULL,
  is_read    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, is_read);

CREATE TABLE IF NOT EXISTS audit_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER REFERENCES users(id),
  action     TEXT NOT NULL,
  entity     TEXT NOT NULL,
  entity_id  INTEGER,
  details    TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
