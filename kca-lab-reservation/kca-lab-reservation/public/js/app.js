/* KCA Lab Reservation – single-page front end (vanilla JS, no build step). */
'use strict';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (iso) => (iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const label = (s) => String(s || '').replace(/_/g, ' ');
const badge = (s) => `<span class="badge ${esc(s)}">${esc(label(s))}</span>`;
const pad = (n) => String(n).padStart(2, '0');
const localInput = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const toIso = (v) => new Date(v).toISOString();

const state = { user: null, scanner: null };
const isStaff = () => state.user && state.user.role !== 'user';
const isAdmin = () => state.user && state.user.role === 'admin';

async function api(method, url, body) {
  const res = await fetch(url, {
    method, credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : await res.text();
  if (!res.ok) {
    if (res.status === 401 && state.user) { state.user = null; location.hash = '#/login'; }
    throw new Error((data && data.error) || `Request failed (${res.status})`);
  }
  return data;
}

function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = `toast ${type}`; el.textContent = msg;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), 4500);
}
const guard = (fn) => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message, 'error'); } };

// ---------- modal ----------
function openModal(html) { const m = $('#modal'); m.innerHTML = html; if (!m.open) m.showModal(); return m; }
function closeModal() { const m = $('#modal'); if (m.open) m.close(); }
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal' || e.target.dataset.close !== undefined) closeModal(); });

// ---------- routing ----------
const routes = {
  '/login': { view: authView, public: true },
  '/catalog': { view: catalogView, title: 'Catalog' },
  '/bookings': { view: bookingsView, title: 'Bookings' },
  '/scan': { view: scanView, title: 'Scan', staff: true },
  '/maintenance': { view: maintenanceView, title: 'Maintenance', staff: true },
  '/tags': { view: tagsView, title: 'QR Tags', staff: true },
  '/reports': { view: reportsView, title: 'Reports', staff: true },
  '/users': { view: usersView, title: 'Users', admin: true },
  '/notifications': { view: notificationsView, title: 'Notifications' },
};

async function route() {
  stopScanner();
  const path = (location.hash.slice(1) || '/catalog').split('?')[0];
  const r = routes[path] || routes['/catalog'];
  if (!state.user && !r.public) { location.hash = '#/login'; return; }
  if (state.user && r.public) { location.hash = '#/catalog'; return; }
  if ((r.staff && !isStaff()) || (r.admin && !isAdmin())) { location.hash = '#/catalog'; return; }
  renderChrome(path);
  try { await r.view(); } catch (e) { $('#app').innerHTML = `<div class="card"><p class="error-text">${esc(e.message)}</p></div>`; }
  $('#topbar').classList.remove('open');
}

function renderChrome(path) {
  const bar = $('#topbar');
  bar.hidden = !state.user;
  if (!state.user) return;
  $('#user-label').textContent = `${state.user.name} · ${state.user.role}`;
  $('#nav').innerHTML = Object.entries(routes)
    .filter(([, r]) => !r.public && r.title !== 'Notifications' && (!r.staff || isStaff()) && (!r.admin || isAdmin()))
    .map(([p, r]) => `<a href="#${p}" class="${p === path ? 'active' : ''}">${esc(r.title)}</a>`).join('');
  refreshBadge();
}

async function refreshBadge() {
  try {
    const { unread } = await api('GET', '/api/notifications');
    const b = $('#badge'); b.textContent = unread; b.hidden = !unread;
  } catch { /* ignore */ }
}

// ---------- auth ----------
function authView() {
  let mode = 'login';
  const draw = () => {
    $('#app').innerHTML = `
    <div class="auth card">
      <h1><span class="logo">KCA</span> Lab Reservation</h1>
      <p class="muted" style="text-align:center">Reserve campus equipment and lab spaces</p>
      <form id="auth-form" novalidate>
        ${mode === 'register' ? `
          <div class="field"><label for="name">Full name</label><input id="name" required autocomplete="name"></div>
          <div class="field"><label for="reg_no">Registration number (optional)</label><input id="reg_no" placeholder="24/06571"></div>` : ''}
        <div class="field"><label for="email">E-mail</label><input id="email" type="email" required autocomplete="username"></div>
        <div class="field"><label for="password">Password</label><input id="password" type="password" required minlength="8" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}"></div>
        <p class="error-text" id="auth-error"></p>
        <button class="btn" style="width:100%">${mode === 'login' ? 'Sign in' : 'Create account'}</button>
      </form>
      <p class="small" style="text-align:center">${mode === 'login' ? 'New here?' : 'Already registered?'}
        <a href="#" id="toggle">${mode === 'login' ? 'Create an account' : 'Sign in'}</a></p>
    </div>`;
    $('#toggle').onclick = (e) => { e.preventDefault(); mode = mode === 'login' ? 'register' : 'login'; draw(); };
    $('#auth-form').onsubmit = async (e) => {
      e.preventDefault();
      const body = { email: $('#email').value.trim(), password: $('#password').value };
      if (mode === 'register') { body.name = $('#name').value; body.reg_no = $('#reg_no').value; }
      try {
        const { user } = await api('POST', `/api/auth/${mode}`, body);
        state.user = user; location.hash = '#/catalog'; route();
      } catch (err) { $('#auth-error').textContent = err.message; }
    };
  };
  draw();
}

// ---------- catalog ----------
async function catalogView() {
  const cats = await api('GET', '/api/resources/categories');
  const f = state.filters || (state.filters = { q: '', category: '', from: '', to: '' });
  $('#app').innerHTML = `
    <div class="page-head"><div><h1>Equipment &amp; lab catalog</h1><p class="muted">Live availability. Pick a slot to reserve.</p></div>
      ${isAdmin() ? '<button class="btn" data-act="new-resource">+ Add item</button>' : ''}</div>
    <div class="toolbar card">
      <div class="field" style="flex:2"><label for="f-q">Search</label><input id="f-q" placeholder="Name, tag, location…" value="${esc(f.q)}"></div>
      <div class="field"><label for="f-cat">Category</label><select id="f-cat"><option value="">All</option>${cats.map((c) => `<option ${c === f.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
      <div class="field"><label for="f-from">Free from</label><input id="f-from" type="datetime-local" value="${esc(f.from)}"></div>
      <div class="field"><label for="f-to">Free until</label><input id="f-to" type="datetime-local" value="${esc(f.to)}"></div>
      <button class="btn ghost" id="f-clear">Clear</button>
    </div>
    <div id="results" class="grid"></div>`;

  const load = guard(async () => {
    f.q = $('#f-q').value; f.category = $('#f-cat').value; f.from = $('#f-from').value; f.to = $('#f-to').value;
    const p = new URLSearchParams();
    if (f.q) p.set('q', f.q); if (f.category) p.set('category', f.category);
    if (f.from && f.to) { p.set('free_from', toIso(f.from)); p.set('free_to', toIso(f.to)); }
    const items = await api('GET', `/api/resources?${p}`);
    $('#results').innerHTML = items.length ? items.map(resourceCard).join('') : '<p class="muted">No items match your filters.</p>';
    $$('#results [data-act]').forEach((b) => (b.onclick = () => resourceAction(b.dataset.act, items.find((i) => i.id == b.dataset.id))));
  });
  let t; $('#f-q').oninput = () => { clearTimeout(t); t = setTimeout(load, 250); };
  ['#f-cat', '#f-from', '#f-to'].forEach((s) => ($(s).onchange = load));
  $('#f-clear').onclick = () => { state.filters = null; catalogView(); };
  $('[data-act="new-resource"]')?.addEventListener('click', () => resourceForm());
  load();
}

function resourceCard(r) {
  return `<article class="card">
    <div style="display:flex;justify-content:space-between;gap:.5rem"><h3>${esc(r.name)}</h3>${badge(r.live_status)}</div>
    <p class="muted small">${esc(r.category)} · ${esc(r.location)} · <code>${esc(r.asset_tag)}</code></p>
    <p class="small">${esc(r.description)}</p>
    <p class="small muted">Max ${esc(r.max_hours)} h per booking${r.next_booking ? ` · next booked ${esc(fmt(r.next_booking))}` : ''}</p>
    <div class="actions">
      <button class="btn small" data-act="reserve" data-id="${r.id}" ${r.status !== 'available' ? 'disabled' : ''}>Reserve</button>
      <button class="btn small ghost" data-act="report" data-id="${r.id}">Report issue</button>
      ${isAdmin() ? `<button class="btn small ghost" data-act="edit" data-id="${r.id}">Edit</button>` : ''}
    </div></article>`;
}

function resourceAction(act, r) {
  if (act === 'reserve') return reserveForm(r);
  if (act === 'report') return issueForm(r);
  if (act === 'edit') return resourceForm(r);
}

async function reserveForm(r) {
  const start = new Date(Math.ceil(Date.now() / 900000) * 900000), end = new Date(start.getTime() + 3600000);
  const m = openModal(`
    <h2>Reserve ${esc(r.name)}</h2>
    <p class="muted small">Up to ${esc(r.max_hours)} hour(s) per booking.</p>
    <div id="slots" class="small" style="margin-bottom:.8rem"><b>Already booked (next 7 days)</b><div id="slot-list" class="muted">Loading…</div></div>
    <form id="rf">
      <div class="row"><div class="field"><label for="rs">Start</label><input id="rs" type="datetime-local" value="${localInput(start)}" required></div>
      <div class="field"><label for="re">End</label><input id="re" type="datetime-local" value="${localInput(end)}" required></div></div>
      <div class="field"><label for="rp">Purpose</label><input id="rp" maxlength="300" placeholder="e.g. Networking practical, group 4"></div>
      <p class="error-text" id="rf-err"></p>
      <div class="actions"><button class="btn">Confirm booking</button><button type="button" class="btn ghost" data-close>Cancel</button></div>
    </form>`);
  api('GET', `/api/resources/${r.id}/bookings`).then((slots) => {
    $('#slot-list', m).innerHTML = slots.length
      ? slots.map((s) => `<div class="slot"><span>${esc(fmt(s.start_time))} → ${esc(fmt(s.end_time))}</span>${s.user_name ? `<span>${esc(s.user_name)}</span>` : ''}</div>`).join('')
      : 'No bookings — wide open.';
  }).catch(() => {});
  $('#rf', m).onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('POST', '/api/reservations', { resource_id: r.id, start_time: toIso($('#rs').value), end_time: toIso($('#re').value), purpose: $('#rp').value });
      closeModal(); toast('Booking confirmed!', 'success'); refreshBadge(); route();
    } catch (err) { $('#rf-err').textContent = err.message; }
  };
}

function issueForm(r) {
  const m = openModal(`
    <h2>Report an issue</h2><p class="muted small">${esc(r.name)} (${esc(r.asset_tag)})</p>
    <form id="mf">
      <div class="field"><label for="mi">What is wrong?</label><textarea id="mi" rows="3" required></textarea></div>
      <div class="field"><label for="ms">Severity</label><select id="ms"><option value="minor">Minor – still usable</option><option value="major">Major – needs repair</option><option value="critical">Critical – unsafe / unusable</option></select></div>
      <p class="error-text" id="mf-err"></p>
      <div class="actions"><button class="btn">Submit</button><button type="button" class="btn ghost" data-close>Cancel</button></div>
    </form>`);
  $('#mf', m).onsubmit = async (e) => {
    e.preventDefault();
    try { await api('POST', '/api/maintenance', { resource_id: r.id, issue: $('#mi').value, severity: $('#ms').value }); closeModal(); toast('Issue reported. Thank you!', 'success'); route(); }
    catch (err) { $('#mf-err').textContent = err.message; }
  };
}

function resourceForm(r = {}) {
  const m = openModal(`
    <h2>${r.id ? 'Edit' : 'Add'} item</h2>
    <form id="ef">
      <div class="field"><label for="en">Name</label><input id="en" value="${esc(r.name)}" required></div>
      <div class="row"><div class="field"><label for="ec">Category</label><input id="ec" value="${esc(r.category)}" required></div>
      <div class="field"><label for="el">Location</label><input id="el" value="${esc(r.location)}"></div></div>
      <div class="field"><label for="ed">Description</label><textarea id="ed" rows="2">${esc(r.description)}</textarea></div>
      <div class="row"><div class="field"><label for="eh">Max hours / booking</label><input id="eh" type="number" min="0.5" step="0.5" value="${esc(r.max_hours ?? 4)}"></div>
      <div class="field"><label for="es">Status</label><select id="es">${['available', 'maintenance', 'retired'].map((s) => `<option ${s === (r.status || 'available') ? 'selected' : ''}>${s}</option>`).join('')}</select></div></div>
      <div class="field"><label for="et">Asset tag ${r.id ? '' : '(blank = auto)'}</label><input id="et" value="${esc(r.asset_tag)}"></div>
      <p class="error-text" id="ef-err"></p>
      <div class="actions"><button class="btn">Save</button><button type="button" class="btn ghost" data-close>Cancel</button></div>
    </form>`);
  $('#ef', m).onsubmit = async (e) => {
    e.preventDefault();
    const body = { name: $('#en').value, category: $('#ec').value, location: $('#el').value, description: $('#ed').value, max_hours: $('#eh').value, status: $('#es').value, asset_tag: $('#et').value };
    try { await api(r.id ? 'PUT' : 'POST', `/api/resources${r.id ? '/' + r.id : ''}`, body); closeModal(); toast('Saved.', 'success'); route(); }
    catch (err) { $('#ef-err').textContent = err.message; }
  };
}

// ---------- bookings ----------
async function bookingsView() {
  const mine = !isStaff() || state.onlyMine;
  const rows = await api('GET', `/api/reservations${isStaff() && state.onlyMine ? '?mine=1' : ''}`);
  $('#app').innerHTML = `
    <div class="page-head"><div><h1>${isStaff() && !state.onlyMine ? 'All bookings' : 'My bookings'}</h1></div>
      ${isStaff() ? `<button class="btn ghost" id="toggle-mine">${state.onlyMine ? 'Show all bookings' : 'Show only mine'}</button>` : ''}</div>
    ${rows.length ? `<div class="table-wrap"><table><thead><tr><th>Item</th>${!mine ? '<th>Borrower</th>' : ''}<th>When</th><th>Status</th><th></th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td><b>${esc(r.resource_name)}</b><br><span class="muted small">${esc(r.asset_tag)}</span></td>
        ${!mine ? `<td>${esc(r.user_name)}</td>` : ''}
        <td>${esc(fmt(r.start_time))}<br><span class="muted small">to ${esc(fmt(r.end_time))}</span>${r.purpose ? `<br><span class="small">${esc(r.purpose)}</span>` : ''}</td>
        <td>${badge(r.state)}${r.return_condition && r.return_condition !== 'good' ? ' ' + badge(r.return_condition) : ''}</td>
        <td>${r.status === 'booked' && r.end_time > new Date().toISOString() ? `<button class="btn small danger" data-cancel="${r.id}">Cancel</button>` : ''}</td></tr>`).join('')}
    </tbody></table></div>` : '<div class="card"><p class="muted">No bookings yet. Head to the catalog to reserve something.</p></div>'}`;
  $('#toggle-mine')?.addEventListener('click', () => { state.onlyMine = !state.onlyMine; bookingsView(); });
  $$('[data-cancel]').forEach((b) => (b.onclick = guard(async () => {
    if (!confirm('Cancel this booking?')) return;
    await api('POST', `/api/reservations/${b.dataset.cancel}/cancel`); toast('Booking cancelled.'); bookingsView(); refreshBadge();
  })));
}

// ---------- QR scan / handover ----------
function stopScanner() {
  if (state.scanner) { const s = state.scanner; state.scanner = null; s.stop().catch(() => {}).finally(() => { try { s.clear(); } catch { /* ignore */ } }); }
}

function scanView() {
  $('#app').innerHTML = `
    <div class="page-head"><div><h1>QR check-out / check-in</h1><p class="muted">Scan an item's tag or type it in, then confirm the handover.</p></div></div>
    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr))">
      <div class="card scanbox"><h2>Scan</h2><div id="reader"></div>
        <div class="actions" style="margin:.6rem 0"><button class="btn" id="cam-start">Start camera</button><button class="btn ghost" id="cam-stop" hidden>Stop camera</button></div>
        <form id="manual" class="row"><input id="code" placeholder="Asset tag e.g. KCA-0003" autocomplete="off" aria-label="Asset tag"><button class="btn" style="flex:0 0 auto">Look up</button></form></div>
      <div class="card" id="result"><p class="muted">Waiting for a scan…</p></div>
    </div>`;

  const lookup = guard(async (code) => {
    const d = await api('GET', `/api/handover/lookup?code=${encodeURIComponent(code)}`);
    renderHandover(d);
  });
  $('#manual').onsubmit = (e) => { e.preventDefault(); const c = $('#code').value.trim(); if (c) lookup(c); };

  $('#cam-start').onclick = guard(async () => {
    if (typeof Html5Qrcode === 'undefined') throw new Error('Scanner library not loaded — run "npm install" and restart.');
    const sc = new Html5Qrcode('reader');
    state.scanner = sc;
    let busy = false;
    await sc.start({ facingMode: 'environment' }, { fps: 10, qrbox: 240 }, async (text) => {
      if (busy) return; busy = true; await lookup(text); setTimeout(() => (busy = false), 2500);
    });
    $('#cam-start').hidden = true; $('#cam-stop').hidden = false;
  });
  $('#cam-stop').onclick = () => { stopScanner(); $('#cam-start').hidden = false; $('#cam-stop').hidden = true; };
}

function renderHandover({ item, action, reservation, message }) {
  const res = $('#result');
  res.innerHTML = `
    <h2>${esc(item.name)} ${badge(item.status)}</h2>
    <p class="muted small">${esc(item.asset_tag)} · ${esc(item.location)}</p>
    <p>${esc(message)}</p>
    ${action === 'checkout' ? `<div class="field"><label for="hn">Notes (optional)</label><input id="hn"></div><button class="btn ok" id="confirm">Confirm check-out</button>` : ''}
    ${action === 'return' ? `
      <div class="field"><label for="hc">Condition on return</label><select id="hc"><option value="good">Good</option><option value="damaged">Damaged</option><option value="missing_parts">Missing parts</option></select></div>
      <div class="field"><label for="hn">Notes</label><input id="hn" placeholder="Describe any damage"></div>
      <button class="btn ok" id="confirm">Confirm return</button>` : ''}`;
  $('#confirm')?.addEventListener('click', guard(async () => {
    await api('POST', '/api/handover/confirm', { reservation_id: reservation.id, action, condition: $('#hc')?.value, notes: $('#hn')?.value });
    toast(action === 'checkout' ? 'Checked out.' : 'Return recorded.', 'success');
    res.innerHTML = `<p>✅ ${action === 'checkout' ? 'Checked out' : 'Returned'}: <b>${esc(item.name)}</b></p>`;
  }));
}

// ---------- QR tags (printable) ----------
async function tagsView() {
  const items = await api('GET', '/api/resources');
  $('#app').innerHTML = `
    <div class="page-head no-print"><div><h1>Printable QR tags</h1><p class="muted">Print and stick one on each item. The QR code contains the asset tag.</p></div>
      <button class="btn" id="print">Print</button></div>
    <div class="tags">${items.filter((i) => i.status !== 'retired').map((i) => `<div class="tag"><img src="/api/resources/${i.id}/qr.png" alt="QR for ${esc(i.asset_tag)}" loading="lazy"><b>${esc(i.asset_tag)}</b><span class="small">${esc(i.name)}</span></div>`).join('')}</div>`;
  $('#print').onclick = () => window.print();
}

// ---------- maintenance ----------
async function maintenanceView() {
  const tab = state.mtab || 'active';
  const rows = await api('GET', '/api/maintenance');
  const list = rows.filter((r) => (tab === 'active' ? r.status !== 'resolved' : r.status === 'resolved'));
  $('#app').innerHTML = `
    <div class="page-head"><div><h1>Maintenance &amp; audit log</h1></div><button class="btn" id="new-issue">+ Flag equipment</button></div>
    <div class="tabs"><button data-tab="active" class="${tab === 'active' ? 'active' : ''}">Open (${rows.filter((r) => r.status !== 'resolved').length})</button>
      <button data-tab="done" class="${tab === 'done' ? 'active' : ''}">Repair history</button></div>
    ${list.length ? `<div class="table-wrap"><table><thead><tr><th>Item</th><th>Issue</th><th>Severity</th><th>Status</th><th></th></tr></thead><tbody>
      ${list.map((m) => `<tr><td><b>${esc(m.resource_name)}</b><br><span class="muted small">${esc(m.asset_tag)}</span></td>
        <td>${esc(m.issue)}<br><span class="muted small">Reported by ${esc(m.reporter || 'system')} · ${esc(fmt(m.created_at))}</span>
        ${m.resolution ? `<br><span class="small">Fix: ${esc(m.resolution)} (${esc(m.resolver || '')}, ${esc(fmt(m.resolved_at))})</span>` : ''}</td>
        <td>${badge(m.severity)}</td><td>${badge(m.status)}</td>
        <td class="actions">${m.status === 'open' ? `<button class="btn small ghost" data-prog="${m.id}">Start repair</button>` : ''}
        ${m.status !== 'resolved' ? `<button class="btn small ok" data-resolve="${m.id}">Resolve</button>` : ''}</td></tr>`).join('')}
    </tbody></table></div>` : '<div class="card"><p class="muted">Nothing here. 🎉</p></div>'}`;
  $$('[data-tab]').forEach((b) => (b.onclick = () => { state.mtab = b.dataset.tab; maintenanceView(); }));
  $$('[data-prog]').forEach((b) => (b.onclick = guard(async () => { await api('PATCH', `/api/maintenance/${b.dataset.prog}`, { status: 'in_progress' }); maintenanceView(); })));
  $$('[data-resolve]').forEach((b) => (b.onclick = () => {
    const m = openModal(`<h2>Resolve issue</h2><form id="rv"><div class="field"><label for="rr">What was done?</label><textarea id="rr" rows="3" required></textarea></div>
      <div class="actions"><button class="btn ok">Mark resolved</button><button type="button" class="btn ghost" data-close>Cancel</button></div></form>`);
    $('#rv', m).onsubmit = guard(async (e) => { e.preventDefault(); await api('PATCH', `/api/maintenance/${b.dataset.resolve}`, { status: 'resolved', resolution: $('#rr').value }); closeModal(); toast('Resolved — item available again if no other issues.', 'success'); maintenanceView(); });
  }));
  $('#new-issue').onclick = guard(async () => {
    const items = await api('GET', '/api/resources');
    const m = openModal(`<h2>Flag equipment</h2><form id="nf"><div class="field"><label for="nr">Item</label><select id="nr">${items.map((i) => `<option value="${i.id}">${esc(i.name)} (${esc(i.asset_tag)})</option>`).join('')}</select></div>
      <div class="field"><label for="ni">Issue</label><textarea id="ni" rows="3" required></textarea></div>
      <div class="field"><label for="nsv">Severity</label><select id="nsv"><option value="minor">Minor</option><option value="major">Major</option><option value="critical">Critical</option></select></div>
      <p class="muted small">Flagged items are removed from the bookable catalog until resolved.</p>
      <div class="actions"><button class="btn">Flag</button><button type="button" class="btn ghost" data-close>Cancel</button></div></form>`);
    $('#nf', m).onsubmit = guard(async (e) => { e.preventDefault(); await api('POST', '/api/maintenance', { resource_id: $('#nr').value, issue: $('#ni').value, severity: $('#nsv').value }); closeModal(); maintenanceView(); });
  });
}

// ---------- reports ----------
async function reportsView() {
  const tab = state.rtab || 'summary';
  const month = state.month || new Date().toISOString().slice(0, 7);
  $('#app').innerHTML = `<div class="page-head"><h1>Reports &amp; analytics</h1></div>
    <div class="tabs"><button data-tab="summary" class="${tab === 'summary' ? 'active' : ''}">Overview</button><button data-tab="monthly" class="${tab === 'monthly' ? 'active' : ''}">Monthly usage</button><button data-tab="audit" class="${tab === 'audit' ? 'active' : ''}">Audit trail</button></div><div id="rbody"></div>`;
  $$('[data-tab]').forEach((b) => (b.onclick = () => { state.rtab = b.dataset.tab; reportsView(); }));
  const body = $('#rbody');
  if (tab === 'summary') {
    const s = await api('GET', '/api/reports/summary');
    const byStatus = Object.fromEntries(s.resources.map((x) => [x.status, x.n]));
    const max = Math.max(1, ...s.daily.map((d) => d.n));
    body.innerHTML = `<div class="stats">
      ${[['Items available', byStatus.available || 0], ['Under maintenance', byStatus.maintenance || 0], ['Checked out now', s.checked_out_now], ['Overdue', s.overdue_now], ['Bookings (30 d)', s.reservations_30d], ['Open issues', s.open_issues], ['Users', s.users]]
        .map(([k, v]) => `<div class="card stat"><b>${esc(v)}</b><span>${esc(k)}</span></div>`).join('')}</div>
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr))">
        <div class="card"><h2>Bookings per day (last 14 days)</h2>${s.daily.length ? `<div class="bars">${s.daily.map((d) => `<div title="${esc(d.day)}: ${esc(d.n)}" style="height:${Math.round((d.n / max) * 100)}%"></div>`).join('')}</div>` : '<p class="muted">No data yet.</p>'}</div>
        <div class="card"><h2>Most used (30 days)</h2>${s.top_resources.length ? `<ol>${s.top_resources.map((t) => `<li>${esc(t.name)} — <b>${esc(t.bookings)}</b></li>`).join('')}</ol>` : '<p class="muted">No data yet.</p>'}</div>
      </div>`;
  } else if (tab === 'monthly') {
    const d = await api('GET', `/api/reports/monthly?month=${month}`);
    body.innerHTML = `<div class="toolbar"><div class="field"><label for="mo">Month</label><input id="mo" type="month" value="${esc(month)}"></div>
      <a class="btn" href="/api/reports/monthly?month=${esc(month)}&format=csv">Download CSV</a></div>
      <div class="table-wrap"><table><thead><tr><th>Item</th><th>Category</th><th>Bookings</th><th>Hours</th><th>Handovers</th><th>Cancelled</th><th>Late</th><th>Problem returns</th><th>Issues</th></tr></thead><tbody>
      ${d.rows.map((r) => `<tr><td><b>${esc(r.name)}</b><br><span class="muted small">${esc(r.asset_tag)}</span></td><td>${esc(r.category)}</td><td>${esc(r.bookings)}</td><td>${esc(r.hours_booked)}</td><td>${esc(r.handovers)}</td><td>${esc(r.cancellations)}</td><td>${esc(r.late_returns)}</td><td>${esc(r.problem_returns)}</td><td>${esc(r.issues_reported)}</td></tr>`).join('')}</tbody></table></div>`;
    $('#mo').onchange = (e) => { if (e.target.value) { state.month = e.target.value; reportsView(); } };
  } else {
    const rows = await api('GET', '/api/reports/audit');
    body.innerHTML = `<div class="table-wrap"><table><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Details</th></tr></thead><tbody>
      ${rows.map((a) => `<tr><td>${esc(fmt(a.created_at))}</td><td>${esc(a.user_name || 'system')}</td><td>${esc(a.action)} <span class="muted small">${esc(a.entity)}${a.entity_id ? ' #' + esc(a.entity_id) : ''}</span></td><td class="small muted">${esc(a.details || '')}</td></tr>`).join('')}</tbody></table></div>`;
  }
}

// ---------- users (admin) ----------
async function usersView() {
  const users = await api('GET', '/api/users');
  $('#app').innerHTML = `<div class="page-head"><h1>User management</h1></div>
    <div class="table-wrap"><table><thead><tr><th>Name</th><th>E-mail</th><th>Reg. no.</th><th>Role</th></tr></thead><tbody>
    ${users.map((u) => `<tr><td>${esc(u.name)}</td><td>${esc(u.email)}</td><td>${esc(u.reg_no)}</td><td>
      <select data-role="${u.id}" ${u.id === state.user.id ? 'disabled' : ''} aria-label="Role for ${esc(u.name)}">${['user', 'technician', 'admin'].map((r) => `<option ${r === u.role ? 'selected' : ''}>${r}</option>`).join('')}</select></td></tr>`).join('')}
    </tbody></table></div>`;
  $$('[data-role]').forEach((s) => (s.onchange = guard(async () => { await api('PATCH', `/api/users/${s.dataset.role}/role`, { role: s.value }); toast('Role updated.', 'success'); })));
}

// ---------- notifications ----------
async function notificationsView() {
  const { items } = await api('GET', '/api/notifications');
  $('#app').innerHTML = `<div class="page-head"><h1>Notifications</h1><button class="btn ghost" id="read-all">Mark all read</button></div>
    <div class="card" style="padding:0">${items.length ? items.map((n) => `<div class="notif ${n.is_read ? '' : 'unread'}"><div>${esc(n.message)}</div><div class="muted small">${esc(fmt(n.created_at))} · ${esc(label(n.type))}</div></div>`).join('') : '<p class="muted" style="padding:1rem">You are all caught up.</p>'}</div>`;
  $('#read-all').onclick = guard(async () => { await api('POST', '/api/notifications/read-all'); notificationsView(); refreshBadge(); });
  refreshBadge();
}

// ---------- boot ----------
$('#logout').onclick = async () => { try { await api('POST', '/api/auth/logout'); } catch { /* ignore */ } state.user = null; location.hash = '#/login'; route(); };
$('#menu-btn').onclick = () => $('#topbar').classList.toggle('open');
window.addEventListener('hashchange', route);
setInterval(() => { if (state.user) refreshBadge(); }, 60000);
(async () => {
  try { state.user = (await api('GET', '/api/auth/me')).user; } catch { state.user = null; }
  route();
})();
