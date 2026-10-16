-- MySQL 8 equivalent of schema.sqlite.sql (proposal §3.3 lists MySQL as the target DBMS).
-- NOTE: the running application ships on SQLite for zero-setup; this file is the migration path
-- (to use it you must swap src/db.js for a mysql2 pool and port the `?` queries — not included/tested).
CREATE DATABASE IF NOT EXISTS kca_lab CHARACTER SET utf8mb4;
USE kca_lab;

CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY, reg_no VARCHAR(30), name VARCHAR(120) NOT NULL,
  email VARCHAR(160) NOT NULL UNIQUE, password_hash VARCHAR(255) NOT NULL,
  role ENUM('user','technician','admin') NOT NULL DEFAULT 'user', created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
);
CREATE TABLE resources (
  id INT AUTO_INCREMENT PRIMARY KEY, asset_tag VARCHAR(30) UNIQUE, name VARCHAR(160) NOT NULL, category VARCHAR(60) NOT NULL,
  location VARCHAR(120) NOT NULL DEFAULT '', description TEXT, status ENUM('available','maintenance','retired') NOT NULL DEFAULT 'available',
  max_hours DECIMAL(5,1) NOT NULL DEFAULT 4, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
);
CREATE TABLE reservations (
  id INT AUTO_INCREMENT PRIMARY KEY, resource_id INT NOT NULL, user_id INT NOT NULL,
  start_time DATETIME(3) NOT NULL, end_time DATETIME(3) NOT NULL, purpose VARCHAR(300) NOT NULL DEFAULT '',
  status ENUM('booked','checked_out','returned','cancelled') NOT NULL DEFAULT 'booked',
  checked_out_at DATETIME(3), checked_out_by INT, returned_at DATETIME(3), returned_by INT,
  return_condition ENUM('good','damaged','missing_parts'), return_notes VARCHAR(300),
  reminded_start TINYINT NOT NULL DEFAULT 0, reminded_due TINYINT NOT NULL DEFAULT 0, reminded_overdue TINYINT NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  FOREIGN KEY (resource_id) REFERENCES resources(id), FOREIGN KEY (user_id) REFERENCES users(id),
  INDEX idx_res_resource_time (resource_id, start_time, end_time), CHECK (end_time > start_time)
);
CREATE TABLE maintenance_logs (
  id INT AUTO_INCREMENT PRIMARY KEY, resource_id INT NOT NULL, reported_by INT, issue VARCHAR(500) NOT NULL,
  severity ENUM('minor','major','critical') NOT NULL DEFAULT 'minor', status ENUM('open','in_progress','resolved') NOT NULL DEFAULT 'open',
  resolution VARCHAR(500), resolved_by INT, resolved_at DATETIME(3), created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  FOREIGN KEY (resource_id) REFERENCES resources(id)
);
CREATE TABLE notifications (
  id INT AUTO_INCREMENT PRIMARY KEY, user_id INT NOT NULL, type VARCHAR(40) NOT NULL, message VARCHAR(500) NOT NULL,
  is_read TINYINT NOT NULL DEFAULT 0, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE TABLE audit_logs (
  id INT AUTO_INCREMENT PRIMARY KEY, user_id INT, action VARCHAR(40) NOT NULL, entity VARCHAR(40) NOT NULL, entity_id INT,
  details TEXT, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
);
