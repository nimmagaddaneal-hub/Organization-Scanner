import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, createItem } from '../src/db.js';
import { createApp } from '../src/app.js';

const ADMIN_PASSWORD = 'test-only-password';
let server;
let base;
let db;
let camera;
let tripod;

const tomorrow = () => new Date(Date.now() + 24 * 60 * 60 * 1000).toLocaleDateString('en-CA');

const student = (overrides = {}) => ({
  student_name: 'Test Student',
  student_id: '100200',
  email: 'test.student@example.edu',
  phone: '',
  due_date: tomorrow(),
  purpose: 'Club photo day',
  ...overrides,
});

function request(path, { method = 'GET', form, cookie } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (form) headers['content-type'] = 'application/x-www-form-urlencoded';
  return fetch(base + path, {
    method,
    headers,
    body: form ? new URLSearchParams(form) : undefined,
    redirect: 'manual',
  });
}

// "name=value" pairs from a response, ready to send back.
const cookiesFrom = (response) =>
  response.headers.getSetCookie().map((line) => line.split(';')[0]).join('; ');

async function adminLogin() {
  const response = await request('/admin/login', { method: 'POST', form: { password: ADMIN_PASSWORD } });
  assert.equal(response.status, 303);
  return cookiesFrom(response);
}

before(async () => {
  db = openDb(':memory:');
  createItem(db, { name: 'Test Camera' });
  createItem(db, { name: 'Test Tripod' });
  [camera, tripod] = db.prepare('SELECT * FROM items ORDER BY id').all();
  const app = createApp({ db, adminPassword: ADMIN_PASSWORD, sessionSecret: 'test-secret' });
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

test('scanned link opens the form with the item filled in', async () => {
  const response = await request(`/i/${camera.code}`);
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /value="Test Camera" readonly/);
  assert.match(html, /name="due_date"/);
});

test('unknown code shows "not found"', async () => {
  const response = await request('/i/doesnotexist');
  assert.equal(response.status, 404);
});

test('form rejects missing and invalid fields', async () => {
  const response = await request(`/i/${camera.code}/checkout`, {
    method: 'POST',
    form: student({ student_name: '', email: 'not-an-email', due_date: '2000-01-01' }),
  });
  const html = await response.text();
  assert.equal(response.status, 400);
  assert.match(html, /Enter your full name/);
  assert.match(html, /valid email/);
  assert.match(html, /cannot be in the past/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM checkouts').get().n, 0);
});

test('every admin route requires the login', async () => {
  for (const path of ['/admin', '/admin/history', '/admin/items', '/admin/qr', '/admin/export.csv', '/admin/items/1/edit']) {
    const response = await request(path);
    assert.equal(response.status, 302, path);
    assert.equal(response.headers.get('location'), '/admin/login', path);
  }
  for (const path of ['/admin/items', '/admin/items/1', '/admin/checkouts/1/return', '/admin/logout']) {
    const response = await request(path, { method: 'POST', form: { name: 'x' } });
    assert.equal(response.status, 401, path);
  }
  const forged = await request('/admin', { cookie: 'admin_session=99999999999999.forged' });
  assert.equal(forged.status, 302);
});

test('wrong admin password is rejected', async () => {
  const response = await request('/admin/login', { method: 'POST', form: { password: 'wrong' } });
  assert.equal(response.status, 401);
  assert.equal(response.headers.getSetCookie().length, 0);
});

test('full flow: check out, dashboard, duplicate blocked, return', async () => {
  // Student submits the form.
  const submit = await request(`/i/${camera.code}/checkout`, { method: 'POST', form: student() });
  assert.equal(submit.status, 303);
  const studentCookie = cookiesFrom(submit);

  // Confirmation screen.
  const confirmation = await (await request(submit.headers.get('location'), { cookie: studentCookie })).text();
  assert.match(confirmation, /You're all set/);

  // Admin dashboard lists it.
  const adminCookie = await adminLogin();
  const dashboard = await (await request('/admin', { cookie: adminCookie })).text();
  assert.match(dashboard, /Test Camera/);
  assert.match(dashboard, /Test Student/);
  assert.match(dashboard, /100200/);
  assert.match(dashboard, /On time/);

  // A different student scans it: unavailable, and no personal data shown.
  const other = await (await request(`/i/${camera.code}`)).text();
  assert.match(other, /Unavailable/);
  assert.doesNotMatch(other, /Test Student|100200|test\.student@example\.edu/);

  // A duplicate check-out is refused.
  const duplicate = await request(`/i/${camera.code}/checkout`, {
    method: 'POST',
    form: student({ student_name: 'Other Person', student_id: '999', email: 'other@example.edu' }),
  });
  assert.equal(duplicate.status, 409);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM checkouts WHERE returned_at IS NULL').get().n, 1);

  // A different student cannot return it with wrong details.
  const wrongReturn = await request(`/i/${camera.code}/return`, {
    method: 'POST',
    form: { student_id: '999', email: 'other@example.edu' },
  });
  assert.equal(wrongReturn.status, 403);

  // The same student scans again: "Return this item" is offered.
  const own = await (await request(`/i/${camera.code}`, { cookie: studentCookie })).text();
  assert.match(own, /You have this item checked out/);
  assert.match(own, /Return this item/);

  // The student returns it.
  const returned = await request(`/i/${camera.code}/return`, { method: 'POST', cookie: studentCookie });
  assert.match(await returned.text(), /Returned/);

  // The item is available again, and the dashboard no longer lists it.
  assert.match(await (await request(`/i/${camera.code}`)).text(), /name="student_name"/);
  assert.doesNotMatch(await (await request('/admin', { cookie: adminCookie })).text(), /Test Student/);

  // History keeps the record.
  const history = await (await request('/admin/history', { cookie: adminCookie })).text();
  assert.match(history, /Test Student/);
  assert.match(history, /Returned/);
});

test('student can return from another phone with student ID and email', async () => {
  await request(`/i/${tripod.code}/checkout`, { method: 'POST', form: student({ student_id: 'AB-77' }) });
  const response = await request(`/i/${tripod.code}/return`, {
    method: 'POST',
    form: { student_id: 'ab-77', email: 'Test.Student@example.edu' },
  });
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Returned/);
});

test('admin: mark returned, overdue highlight, search, filter, CSV, items, QR', async () => {
  const adminCookie = await adminLogin();

  await request(`/i/${camera.code}/checkout`, { method: 'POST', form: student({ student_name: 'Late Larry', student_id: '555' }) });
  await request(`/i/${tripod.code}/checkout`, { method: 'POST', form: student({ student_name: 'Punctual Pat', student_id: '666' }) });
  // Make the camera check-out overdue.
  db.prepare("UPDATE checkouts SET due_date = '2020-01-01' WHERE student_id = '555'").run();

  const dashboard = await (await request('/admin', { cookie: adminCookie })).text();
  assert.match(dashboard, /row-overdue/);
  assert.match(dashboard, /badge overdue/);

  const overdueOnly = await (await request('/admin?status=overdue', { cookie: adminCookie })).text();
  assert.match(overdueOnly, /Late Larry/);
  assert.doesNotMatch(overdueOnly, /Punctual Pat/);

  const search = await (await request('/admin?q=tripod', { cookie: adminCookie })).text();
  assert.match(search, /Punctual Pat/);
  assert.doesNotMatch(search, /Late Larry/);

  const csvResponse = await request('/admin/export.csv?scope=all', { cookie: adminCookie });
  assert.match(csvResponse.headers.get('content-type'), /text\/csv/);
  const csv = await csvResponse.text();
  assert.match(csv, /"Late Larry"/);
  assert.match(csv, /"Overdue"/);
  assert.match(csv, /"Returned"/);

  // Mark the overdue one as returned.
  const overdueId = db.prepare("SELECT id FROM checkouts WHERE student_id = '555' AND returned_at IS NULL").get().id;
  const mark = await request(`/admin/checkouts/${overdueId}/return`, { method: 'POST', cookie: adminCookie });
  assert.equal(mark.status, 303);
  assert.doesNotMatch(await (await request('/admin', { cookie: adminCookie })).text(), /Late Larry/);
  assert.equal(db.prepare('SELECT returned_by FROM checkouts WHERE id = ?').get(overdueId).returned_by, 'admin');

  // Add and edit an item.
  await request('/admin/items', { method: 'POST', cookie: adminCookie, form: { name: 'New Banner', description: '' } });
  const banner = db.prepare("SELECT * FROM items WHERE name = 'New Banner'").get();
  assert.ok(banner.code);
  await request(`/admin/items/${banner.id}`, {
    method: 'POST',
    cookie: adminCookie,
    form: { name: 'Club Banner', description: 'Vinyl', active: '1' },
  });
  assert.equal(db.prepare('SELECT name FROM items WHERE id = ?').get(banner.id).name, 'Club Banner');

  // QR sheet has one code per active item.
  const qr = await (await request('/admin/qr', { cookie: adminCookie })).text();
  assert.equal(qr.match(/<svg/g).length, 3);
  assert.match(qr, /Club Banner/);

  // Retiring an item turns off its link.
  await request(`/admin/items/${banner.id}`, { method: 'POST', cookie: adminCookie, form: { name: 'Club Banner' } });
  assert.equal((await request(`/i/${banner.code}`)).status, 404);
});

test('admin form posts from another website are refused', async () => {
  const adminCookie = await adminLogin();
  const response = await fetch(`${base}/admin/items`, {
    method: 'POST',
    headers: { cookie: adminCookie, origin: 'https://evil.example', 'content-type': 'application/x-www-form-urlencoded' },
    body: 'name=Injected',
  });
  assert.equal(response.status, 403);
});

test('admin form posts from the site itself are accepted', async () => {
  // Browsers send "Origin: null" under a no-referrer policy, which would break every admin form.
  const page = await request('/admin/login');
  assert.equal(page.headers.get('referrer-policy'), 'same-origin');
  const response = await fetch(`${base}/admin/login`, {
    method: 'POST',
    headers: { origin: base, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: ADMIN_PASSWORD }),
    redirect: 'manual',
  });
  assert.equal(response.status, 303);
});
