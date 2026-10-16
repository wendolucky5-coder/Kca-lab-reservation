# KCA Campus Smart Equipment & Lab Asset Reservation System

Web-based system that replaces paper sign-in logs for KCA University labs: students book equipment and lab spaces,
technicians hand items over with QR codes, and admins get maintenance tracking, audit trails and usage reports.
Built from the project proposal (Node.js + Express, HTML/CSS/JavaScript, SQL database).

## Quick start (VS Code)

Requirements: **Node.js 22.13 or newer** (`node -v`) — it provides the built-in SQLite engine, so there is no database server to install.

```bash
npm install          # installs express, qrcode, html5-qrcode (+ nodemon for dev)
cp .env.example .env # then set JWT_SECRET
npm run dev          # http://localhost:3000   (or `npm start`)
```

Open the folder in VS Code (`code .`) and press **F5** ("Run server"). On first start the database is created in `data/`
and filled with demo data. Install the recommended extensions when prompted (REST Client, SQLite Viewer…).

| Demo account | E-mail | Password | Role |
|---|---|---|---|
| Student | student@kca.local | Password123! | user |
| Technician | tech@kca.local | Password123! | technician |
| Admin | admin@kca.local | Password123! | admin |

Change these passwords (or run `npm run reset` with your own seed) before any real deployment.

Other scripts: `npm test` (API tests) · `npm run reset` (wipe DB and re-seed) · `requests.http` (try the API from VS Code).

## How it maps to the proposal

| Objective / module (proposal) | Where it lives |
|---|---|
| Authentication & user management, RBAC (student / technician / admin) | `src/routes/auth.js`, `src/routes/users.js`, `src/middleware.js` — scrypt password hashing, signed HttpOnly session cookie, role checks on every route |
| Resource catalog & search with real-time availability | `src/routes/resources.js`, catalog page; "free from/until" filter shows only items open in a window |
| Smart reservation engine | `src/routes/reservations.js` — no overlapping bookings for an item (checked inside a write-locked transaction), no overlapping bookings for one user, per-item max duration, no past bookings, max active bookings per user, max days ahead, items under maintenance cannot be booked |
| QR code handover verification | `src/routes/handover.js`; tags from `GET /api/resources/:id/qr.png`, printable sheet at **QR Tags**, camera scanner at **Scan** (html5-qrcode) with manual entry fallback |
| Notification system | `src/services.js`, `src/scheduler.js` — in-app notifications for booking, check-out/return, start/due/overdue reminders; optional e-mail via Resend when `RESEND_API_KEY` is set |
| Maintenance & audit logs, monthly reports | `src/routes/maintenance.js`, `src/routes/reports.js` — fault reports, repair history, audit trail, monthly usage report (on-screen + CSV) |

## Roles

* **user** (student/staff): browse, reserve, cancel own bookings, report faults, see notifications.
* **technician**: everything above plus scan/hand over items, see all bookings, maintenance queue, QR tags, reports and audit trail.
* **admin**: everything above plus manage catalog items and user roles. Self-registration always creates a `user`; promote people on the **Users** page.

## Typical flow

1. Student books *Epson Portable Projector* for tomorrow 10:00–12:00 (overlaps are rejected).
2. At the lab desk the technician opens **Scan**, scans the item's QR tag → system finds the booking → **Confirm check-out**.
3. On return the technician scans again, records condition. *Damaged/missing parts* automatically opens a maintenance log and takes the item out of the bookable catalog.
4. Technician resolves the issue → item is available again. Reports show usage, late returns and problem returns per month.

## Project layout

```
server.js               entry point (loads .env, opens DB, starts scheduler)
src/app.js              Express app + routes wiring
src/routes/*.js         REST API (auth, resources, reservations, handover, maintenance, notifications, reports, users)
src/db.js, services.js  database helpers, audit + notifications
src/scheduler.js        reminder / overdue jobs (every minute)
database/               schema.sqlite.sql, seed.js, schema.mysql.sql (see note)
public/                 front end (index.html, css/style.css, js/app.js – no build step)
tests/api.test.js       API tests (node:test)
```

## Configuration (`.env`)

`PORT`, `JWT_SECRET` (required in production), `DB_FILE`, `MAX_ACTIVE_RESERVATIONS` (3), `MAX_ADVANCE_DAYS` (30),
`CHECKOUT_EARLY_MINUTES` (15), `RESEND_API_KEY`, `MAIL_FROM`.

## Notes & known limits

* **Database:** the proposal lists MySQL (§3.3) and also SQLite (§5.1). This build uses SQLite (Node's built-in `node:sqlite`) so it runs with no setup. `database/schema.mysql.sql` is provided as the equivalent MySQL schema, but the app code is not ported to MySQL.
* Camera scanning needs HTTPS or `localhost` (browser rule). For phones on the campus network, deploy behind HTTPS; manual tag entry always works.
* Times are stored in UTC and displayed in each user's local time zone.
* Rate limiting is in-memory and per process; use a shared store if you run multiple instances.
