const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../src/db');
const { createApp } = require('../src/app');
const { seed, DEMO_PASSWORD } = require('../database/seed');
const { runJobs } = require('../src/scheduler');

let server, base, db;
test.before(async () => {
  process.env.NODE_ENV = 'test';
  db = openDb(':memory:');
  seed(db);
  server = createApp(db).listen(0);
  await new Promise((r) => server.on('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

// tiny cookie-aware client
function client() {
  let cookie = '';
  const call = async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), cookie }, body: body ? JSON.stringify(body) : undefined });
    const sc = res.headers.getSetCookie?.() || [];
    if (sc.length) cookie = sc.map((c) => c.split(';')[0]).join('; ');
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data };
  };
  return { call, login: (email, password = DEMO_PASSWORD) => call('POST', '/api/auth/login', { email, password }) };
}
const hoursFromNow = (h) => new Date(Date.now() + h * 3600000).toISOString();

test('authentication & role protection', async () => {
  const c = client();
  assert.equal((await c.call('GET', '/api/resources')).status, 401);
  assert.equal((await c.login('student@kca.local', 'wrong')).status, 401);
  assert.equal((await c.login('student@kca.local')).status, 200);
  assert.equal((await c.call('GET', '/api/resources')).status, 200);
  assert.equal((await c.call('GET', '/api/users')).status, 403);
  assert.equal((await c.call('GET', '/api/reports/summary')).status, 403);
  assert.equal((await c.call('POST', '/api/resources', { name: 'x', category: 'y' })).status, 403);
  const reg = await client().call('POST', '/api/auth/register', { name: 'New Person', email: 'new@kca.local', password: 'longenough1', role: 'admin' });
  assert.equal(reg.status, 201);
  assert.equal(reg.data.user.role, 'user', 'self-registration must never grant elevated roles');
  assert.equal((await client().call('POST', '/api/auth/register', { name: 'Dup', email: 'NEW@kca.local', password: 'longenough1' })).status, 409);
});

test('reservation engine blocks double-booking, overlaps, long and past bookings', async () => {
  const s = client(); await s.login('student@kca.local');
  const other = client(); await other.call('POST', '/api/auth/register', { name: 'Other User', email: 'other@kca.local', password: 'longenough1' });
  const book = (c, id, a, b) => c.call('POST', '/api/reservations', { resource_id: id, start_time: hoursFromNow(a), end_time: hoursFromNow(b) });

  assert.equal((await book(s, 3, 2, 3)).status, 201);
  assert.equal((await book(other, 3, 2.5, 3.5)).status, 409, 'overlapping slot on same item');
  assert.equal((await book(other, 3, 3, 4)).status, 201, 'back-to-back slot is allowed');
  assert.equal((await book(s, 4, 2.5, 3.5)).status, 409, 'same user cannot hold two overlapping bookings');
  assert.equal((await book(s, 3, 10, 15)).status, 400, 'exceeds max_hours (4)');
  assert.equal((await book(s, 3, -5, -4)).status, 400, 'in the past');
  assert.equal((await book(s, 3, 6, 5)).status, 400, 'end before start');
  assert.equal((await book(s, 999, 6, 7)).status, 404);

  // max active reservations (3): student holds 1 so far
  assert.equal((await book(s, 5, 20, 21)).status, 201);
  assert.equal((await book(s, 6, 30, 31)).status, 201);
  assert.equal((await book(s, 7, 40, 41)).status, 409, 'active reservation cap');

  const free = await s.call('GET', `/api/resources?free_from=${encodeURIComponent(hoursFromNow(2))}&free_to=${encodeURIComponent(hoursFromNow(3))}`);
  assert.ok(!free.data.some((r) => r.id === 3), 'booked item is filtered out of "free" search');
});

test('cancel rules', async () => {
  const s = client(); await s.login('student@kca.local');
  const mine = (await s.call('GET', '/api/reservations')).data;
  const target = mine.find((r) => r.resource_id === 6);
  const o = client(); await o.login('other@kca.local', 'longenough1');
  assert.equal((await o.call('POST', `/api/reservations/${target.id}/cancel`)).status, 403);
  assert.equal((await s.call('POST', `/api/reservations/${target.id}/cancel`)).status, 200);
  assert.equal((await s.call('POST', `/api/reservations/${target.id}/cancel`)).status, 409);
});

test('QR handover: check-out, damaged return creates maintenance, resolve restores', async () => {
  const s = client(); await s.login('student@kca.local');
  const t = client(); await t.login('tech@kca.local');
  // a booking that is active right now for item 1 (student has a free slot: cancel earlier ones first)
  for (const r of (await s.call('GET', '/api/reservations')).data) if (r.status === 'booked') await s.call('POST', `/api/reservations/${r.id}/cancel`);
  const now = await s.call('POST', '/api/reservations', { resource_id: 1, start_time: new Date().toISOString(), end_time: hoursFromNow(2) });
  assert.equal(now.status, 201);

  assert.equal((await s.call('GET', '/api/handover/lookup?code=KCA-0001')).status, 403, 'students cannot use the scanner');
  assert.equal((await t.call('GET', '/api/handover/lookup?code=NOPE')).status, 404);
  let look = (await t.call('GET', '/api/handover/lookup?code=kca-0001')).data;
  assert.equal(look.action, 'checkout');
  assert.equal((await t.call('GET', '/api/handover/lookup?code=KCA-0002')).data.action, null, 'no booking => cannot check out');

  assert.equal((await t.call('POST', '/api/handover/confirm', { reservation_id: look.reservation.id, action: 'checkout' })).status, 200);
  assert.equal((await t.call('POST', '/api/handover/confirm', { reservation_id: look.reservation.id, action: 'checkout' })).status, 409, 'cannot check out twice');
  look = (await t.call('GET', '/api/handover/lookup?code=KCA-0001')).data;
  assert.equal(look.action, 'return');
  const cat = (await s.call('GET', '/api/resources')).data.find((r) => r.id === 1);
  assert.equal(cat.live_status, 'in_use');

  assert.equal((await t.call('POST', '/api/handover/confirm', { reservation_id: look.reservation.id, action: 'return', condition: 'damaged', notes: 'cracked screen' })).status, 200);
  const after = (await s.call('GET', '/api/resources')).data.find((r) => r.id === 1);
  assert.equal(after.status, 'maintenance');
  const logs = (await t.call('GET', '/api/maintenance?status=open')).data;
  assert.equal(logs.length, 1);
  assert.equal((await s.call('POST', '/api/reservations', { resource_id: 1, start_time: hoursFromNow(5), end_time: hoursFromNow(6) })).status, 409, 'items in maintenance cannot be booked');

  assert.equal((await t.call('PATCH', `/api/maintenance/${logs[0].id}`, { status: 'resolved', resolution: 'Replaced screen' })).status, 200);
  assert.equal((await s.call('GET', '/api/resources')).data.find((r) => r.id === 1).status, 'available');
});

test('maintenance reporting by users & critical issues take item out of service', async () => {
  const s = client(); await s.login('student@kca.local');
  await s.call('POST', '/api/maintenance', { resource_id: 8, issue: 'Port 3 flickers', severity: 'minor' });
  assert.equal((await s.call('GET', '/api/resources/8')).data.status, 'available');
  await s.call('POST', '/api/maintenance', { resource_id: 8, issue: 'Smoking!', severity: 'critical' });
  assert.equal((await s.call('GET', '/api/resources/8')).data.status, 'maintenance');
  assert.equal((await s.call('GET', '/api/maintenance')).status, 403);
});

test('notifications, scheduler overdue alerts, reports, audit', async () => {
  const s = client(); await s.login('student@kca.local');
  const n = (await s.call('GET', '/api/notifications')).data;
  assert.ok(n.unread > 0 && n.items.some((i) => i.type === 'booking_confirmed'));
  await s.call('POST', '/api/notifications/read-all');
  assert.equal((await s.call('GET', '/api/notifications')).data.unread, 0);

  // simulate an overdue checkout
  const past = (h) => new Date(Date.now() - h * 3600000).toISOString();
  db.prepare("INSERT INTO reservations (resource_id,user_id,start_time,end_time,status,checked_out_at) VALUES (9,3,?,?,'checked_out',?)").run(past(5), past(1), past(5));
  runJobs(db); runJobs(db);
  const n2 = (await s.call('GET', '/api/notifications')).data.items.filter((i) => i.type === 'overdue');
  assert.equal(n2.length, 1, 'overdue alert is sent once');

  const t = client(); await t.login('tech@kca.local');
  const sum = (await t.call('GET', '/api/reports/summary')).data;
  assert.equal(sum.overdue_now, 1);
  const csv = await t.call('GET', `/api/reports/monthly?month=${new Date().toISOString().slice(0, 7)}&format=csv`);
  assert.match(csv.data, /asset_tag,name,category,bookings/);
  assert.equal((await t.call('GET', '/api/reports/monthly?month=bad')).status, 400);
  assert.ok((await t.call('GET', '/api/reports/audit')).data.some((a) => a.action === 'check_out'));
});

test('admin: resources CRUD & users', async () => {
  const a = client(); await a.login('admin@kca.local');
  const created = await a.call('POST', '/api/resources', { name: 'Test Drone', category: 'Multimedia', max_hours: 2 });
  assert.equal(created.status, 201);
  assert.match(created.data.asset_tag, /^KCA-\d{4}$/);
  assert.equal((await a.call('POST', '/api/resources', { name: 'Dup', category: 'X', asset_tag: created.data.asset_tag })).status, 409);
  assert.equal((await a.call('PUT', `/api/resources/${created.data.id}`, { max_hours: 0 })).status, 400);
  assert.equal((await a.call('DELETE', `/api/resources/${created.data.id}`)).status, 200);
  const users = (await a.call('GET', '/api/users')).data;
  const stu = users.find((u) => u.email === 'student@kca.local');
  assert.equal((await a.call('PATCH', `/api/users/${stu.id}/role`, { role: 'technician' })).status, 200);
  const me = users.find((u) => u.email === 'admin@kca.local');
  assert.equal((await a.call('PATCH', `/api/users/${me.id}/role`, { role: 'user' })).status, 409);
  assert.equal((await a.call('GET', `/api/resources/1/qr.png`)).status, 200);
});
