import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, createItem, createSchool, syncDefaultSchool, DEFAULT_SCHOOL_NAME } from '../src/db.js';
import { createApp } from '../src/app.js';

const ADMIN_CODE = 'test-admin-code';
const TEACHER_CODE = 'test-teacher-code';
const ADMIN = { name: 'Test Admin', email: 'admin@example.edu', password: 'test-only-password' };
let server;
let base;
let db;
let dbFolder;
let demoEmails = [];
let demoNotifier = async (request) => {
  demoEmails.push(request);
};
let camera;
let tripod;

const tomorrow = () => new Date(Date.now() + 24 * 60 * 60 * 1000).toLocaleDateString('en-CA');

let studentCount = 0;

// Signs a new student up and returns their account and login cookie.
async function studentSignup(overrides = {}) {
  studentCount += 1;
  const account = {
    name: 'Test Student',
    student_id: '100200',
    email: `student${studentCount}@example.edu`,
    password: 'student-pass-123',
    ...overrides,
  };
  const response = await request('/student/signup', {
    method: 'POST',
    form: { ...account, phone: '', confirm_password: account.password, next: '/account' },
  });
  assert.equal(response.status, 303, `sign-up failed for ${account.email}`);
  return { account, cookie: cookiesFrom(response) };
}

// A new student signs up and checks the item out. Accepts the old field names student_name and student_id.
async function checkoutFor(item, { student_name, student_id, email, ...rest } = {}) {
  const { account, cookie } = await studentSignup({
    ...(student_name && { name: student_name }),
    ...(student_id && { student_id }),
    ...(email && { email }),
  });
  const response = await request(`/i/${item.code}/checkout`, {
    method: 'POST',
    cookie,
    form: { due_date: tomorrow(), purpose: 'Club photo day', phone: '', ...rest },
  });
  return { response, cookie, account };
}

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

async function signUp(account, code) {
  return request('/admin/signup', { method: 'POST', form: { ...account, signup_code: code } });
}

async function login({ email, password }) {
  const response = await request('/admin/login', { method: 'POST', form: { email, password } });
  assert.equal(response.status, 303);
  return cookiesFrom(response);
}

const adminLogin = () => login(ADMIN);

before(async () => {
  dbFolder = mkdtempSync(join(tmpdir(), 'checkout-test-'));
  db = await openDb({ url: `file:${join(dbFolder, 'test.db')}` });
  await createItem(db, { name: 'Test Camera' });
  await createItem(db, { name: 'Test Tripod' });
  [camera, tripod] = (await db.prepare('SELECT * FROM items ORDER BY id').all());
  await syncDefaultSchool(db, { adminCode: ADMIN_CODE, teacherCode: TEACHER_CODE });
  const app = createApp({ db, sessionSecret: 'test-secret', notifyDemo: (request) => demoNotifier(request) });
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await signUp(ADMIN, ADMIN_CODE)).status, 303);
});

after(() => {
  server.close();
  db.close();
  rmSync(dbFolder, { recursive: true, force: true });
});

test('scanning while logged out asks to log in, then logged-in students get the form', async () => {
  const loggedOut = await request(`/i/${camera.code}`);
  const loggedOutHtml = await loggedOut.text();
  assert.equal(loggedOut.status, 200);
  assert.match(loggedOutHtml, /Log in to check this item out/);
  assert.match(loggedOutHtml, new RegExp(`/student/login\\?next=%2Fi%2F${camera.code}`));
  assert.doesNotMatch(loggedOutHtml, /name="due_date"/);

  // Checking out without an account does nothing.
  const blocked = await request(`/i/${camera.code}/checkout`, { method: 'POST', form: { due_date: tomorrow() } });
  assert.equal(blocked.status, 303);
  assert.match(blocked.headers.get('location'), /^\/student\/login/);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM checkouts').get()).n, 0);

  const { cookie } = await studentSignup();
  const html = await (await request(`/i/${camera.code}`, { cookie })).text();
  assert.match(html, /value="Test Camera" readonly/);
  assert.match(html, /name="due_date"/);
  assert.match(html, /Checking out as/);
  assert.doesNotMatch(html, /name="student_id"/);
});

test('unknown code shows "not found"', async () => {
  const response = await request('/i/doesnotexist');
  assert.equal(response.status, 404);
});

test('form rejects missing and invalid fields', async () => {
  const { cookie } = await studentSignup();
  const response = await request(`/i/${camera.code}/checkout`, {
    method: 'POST',
    cookie,
    form: { phone: 'abc', due_date: '2000-01-01' },
  });
  const html = await response.text();
  assert.equal(response.status, 400);
  assert.match(html, /valid phone number/);
  assert.match(html, /cannot be in the past/);
  const noDate = await request(`/i/${camera.code}/checkout`, { method: 'POST', cookie, form: {} });
  assert.match(await noDate.text(), /Choose an expected return date/);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM checkouts').get()).n, 0);
});

test('every admin route requires the login', async () => {
  for (const path of ['/admin', '/admin/history', '/admin/items', '/admin/qr', '/admin/export.csv', '/admin/items/1/edit', '/admin/items/1/delete', '/admin/people', '/admin/settings', '/admin/settings/delete', '/admin/people/1/delete', '/admin/students']) {
    const response = await request(path);
    assert.equal(response.status, 302, path);
    assert.equal(response.headers.get('location'), '/admin/login', path);
  }
  for (const path of ['/admin/items', '/admin/items/1', '/admin/items/1/delete', '/admin/checkouts/1/return', '/admin/logout', '/admin/people/1/active', '/admin/people/1/delete', '/admin/settings/name', '/admin/settings/password', '/admin/settings/delete', ]) {
    const response = await request(path, { method: 'POST', form: { name: 'x' } });
    assert.equal(response.status, 401, path);
  }
  const forged = await request('/admin', { cookie: 'admin_session=1.99999999999999.forged' });
  assert.equal(forged.status, 302);
});

test('wrong admin password is rejected', async () => {
  const response = await request('/admin/login', { method: 'POST', form: { email: ADMIN.email, password: 'wrong-password' } });
  assert.equal(response.status, 401);
  assert.equal(response.headers.getSetCookie().length, 0);
});

test('full flow: check out, dashboard, duplicate blocked, return', async () => {
  // A student with an account submits the form.
  const { response: submit, cookie: studentCookie } = await checkoutFor(camera, {
    student_name: 'Test Student', student_id: '100200', email: 'test.student@example.edu',
  });
  assert.equal(submit.status, 303);

  // Confirmation screen.
  const confirmation = await (await request(submit.headers.get('location'), { cookie: studentCookie })).text();
  assert.match(confirmation, /You're all set/);

  // Admin dashboard lists it, with the account marker.
  const adminCookie = await adminLogin();
  const dashboard = await (await request('/admin', { cookie: adminCookie })).text();
  assert.match(dashboard, /Test Camera/);
  assert.match(dashboard, /Test Student/);
  assert.match(dashboard, /100200/);
  assert.match(dashboard, /On time/);
  assert.match(dashboard, /Account/);
  const linked = (await db.prepare("SELECT student_account_id FROM checkouts WHERE student_id = '100200'").get()).student_account_id;
  assert.ok(linked);

  // A different student scans it: unavailable, and no personal data shown.
  const { cookie: otherCookie } = await studentSignup({ name: 'Other Person', student_id: '999', email: 'other@example.edu' });
  const other = await (await request(`/i/${camera.code}`, { cookie: otherCookie })).text();
  assert.match(other, /Unavailable/);
  assert.doesNotMatch(other, /Test Student|100200|test\.student@example\.edu/);
  assert.doesNotMatch(await (await request(`/i/${camera.code}`)).text(), /Test Student|100200/);

  // A duplicate check-out is refused.
  const duplicate = await request(`/i/${camera.code}/checkout`, { method: 'POST', cookie: otherCookie, form: { due_date: tomorrow() } });
  assert.equal(duplicate.status, 409);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM checkouts WHERE returned_at IS NULL').get()).n, 1);

  // A different student cannot return it. Logged out, they are sent to log in.
  assert.equal((await request(`/i/${camera.code}/return`, { method: 'POST', cookie: otherCookie })).status, 403);
  assert.equal((await request(`/i/${camera.code}/return`, { method: 'POST' })).status, 303);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM checkouts WHERE returned_at IS NULL').get()).n, 1);

  // The same student scans again: "Return this item" is offered, and My items lists it.
  const own = await (await request(`/i/${camera.code}`, { cookie: studentCookie })).text();
  assert.match(own, /You have this item checked out/);
  assert.match(own, /Return this item/);
  assert.match(await (await request('/account', { cookie: studentCookie })).text(), /Test Camera/);

  // The student returns it.
  const returned = await request(`/i/${camera.code}/return`, { method: 'POST', cookie: studentCookie });
  assert.match(await returned.text(), /Returned/);

  // The item is available again, and the dashboard no longer lists it.
  assert.match(await (await request(`/i/${camera.code}`, { cookie: studentCookie })).text(), /name="due_date"/);
  assert.doesNotMatch(await (await request('/admin', { cookie: adminCookie })).text(), /Test Student/);

  // History keeps the record.
  const history = await (await request('/admin/history', { cookie: adminCookie })).text();
  assert.match(history, /Test Student/);
  assert.match(history, /Returned/);
  assert.match(await (await request('/account', { cookie: studentCookie })).text(), /History/);
});

test('a student can return from another phone by logging in', async () => {
  const { account } = await checkoutFor(tripod, { student_id: 'AB-77' });
  const login = await request('/student/login', { method: 'POST', form: { email: account.email, password: account.password, next: `/i/${tripod.code}` } });
  assert.equal(login.status, 303);
  assert.equal(login.headers.get('location'), `/i/${tripod.code}`);
  const secondPhone = cookiesFrom(login);
  const response = await request(`/i/${tripod.code}/return`, { method: 'POST', cookie: secondPhone });
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Returned/);
});

test('admin: mark returned, overdue highlight, search, filter, CSV, items, QR', async () => {
  const adminCookie = await adminLogin();

  await checkoutFor(camera, { student_name: 'Late Larry', student_id: '555' });
  await checkoutFor(tripod, { student_name: 'Punctual Pat', student_id: '666' });
  // Make the camera check-out overdue.
  (await db.prepare("UPDATE checkouts SET due_date = '2020-01-01' WHERE student_id = '555'").run());

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
  const overdueId = (await db.prepare("SELECT id FROM checkouts WHERE student_id = '555' AND returned_at IS NULL").get()).id;
  const mark = await request(`/admin/checkouts/${overdueId}/return`, { method: 'POST', cookie: adminCookie });
  assert.equal(mark.status, 303);
  assert.doesNotMatch(await (await request('/admin', { cookie: adminCookie })).text(), /Late Larry/);
  assert.equal((await db.prepare('SELECT returned_by FROM checkouts WHERE id = ?').get(overdueId)).returned_by, 'admin');

  // Add and edit an item.
  const added = await request('/admin/items', { method: 'POST', cookie: adminCookie, form: { name: 'New Banner', description: '' } });
  // Listing an item goes straight to its label, with a QR code and a barcode.
  assert.match(added.headers.get('location'), /^\/admin\/qr\?item=\d+&listed=1$/);
  const label = await (await request(added.headers.get('location'), { cookie: adminCookie })).text();
  assert.match(label, /Item listed/);
  assert.equal(label.match(/<svg/g).length, 2);
  const banner = (await db.prepare("SELECT * FROM items WHERE name = 'New Banner'").get());
  assert.ok(banner.code);
  await request(`/admin/items/${banner.id}`, {
    method: 'POST',
    cookie: adminCookie,
    form: { name: 'Club Banner', description: 'Vinyl', active: '1' },
  });
  assert.equal((await db.prepare('SELECT name FROM items WHERE id = ?').get(banner.id)).name, 'Club Banner');

  // QR sheet has one code per active item.
  const qr = await (await request('/admin/qr', { cookie: adminCookie })).text();
  assert.equal(qr.match(/<svg/g).length, 6);
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
    body: new URLSearchParams({ email: ADMIN.email, password: ADMIN.password }),
    redirect: 'manual',
  });
  assert.equal(response.status, 303);
});

test('sign-up needs a valid code, and the code decides the role', async () => {
  const nobody = { name: 'No Code', email: 'nocode@example.edu', password: 'long-enough-password' };
  const refused = await signUp(nobody, 'wrong-code');
  assert.equal(refused.status, 400);
  assert.equal(refused.headers.getSetCookie().length, 0);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM users WHERE email = ?').get(nobody.email)).n, 0);

  const weak = await signUp({ ...nobody, password: 'short' }, TEACHER_CODE);
  assert.equal(weak.status, 400);

  const teacher = { name: 'Role Teacher', email: 'role.teacher@example.edu', password: 'long-enough-password' };
  assert.equal((await signUp(teacher, TEACHER_CODE)).status, 303);
  const stored = (await db.prepare('SELECT * FROM users WHERE email = ?').get(teacher.email));
  assert.equal(stored.role, 'teacher');
  assert.doesNotMatch(stored.password_hash, /long-enough-password/);

  // The same email cannot sign up twice.
  assert.equal((await signUp(teacher, ADMIN_CODE)).status, 400);
  assert.equal((await db.prepare('SELECT role FROM users WHERE email = ?').get(teacher.email)).role, 'teacher');
});

test('teacher lists an item, gets a code, and sees only their own items and check-outs', async () => {
  const teacher = { name: 'Ms Rivera', email: 'rivera@example.edu', password: 'long-enough-password' };
  const teacherCookie = cookiesFrom(await signUp(teacher, TEACHER_CODE));

  // List an item and land on its label.
  const added = await request('/admin/items', { method: 'POST', cookie: teacherCookie, form: { name: 'Lab Microscope' } });
  const label = await (await request(added.headers.get('location'), { cookie: teacherCookie })).text();
  assert.match(label, /Lab Microscope/);
  const microscope = (await db.prepare("SELECT * FROM items WHERE name = 'Lab Microscope'").get());
  assert.equal(label.match(/<svg/g).length, 2);

  // The barcode value opens the item form.
  const found = await request(`/find?code=${microscope.code.toUpperCase()}`);
  assert.equal(found.headers.get('location'), `/i/${microscope.code}`);

  // One check-out on the teacher's item, one on an organization item.
  await checkoutFor(microscope, { student_name: 'Micro Mia', student_id: '777' });
  await checkoutFor(camera, { student_name: 'Camera Cam', student_id: '888' });

  for (const path of ['/admin', '/admin/history', '/admin/export.csv?scope=all', '/admin/items', '/admin/qr']) {
    const page = await (await request(path, { cookie: teacherCookie })).text();
    assert.doesNotMatch(page, /Camera Cam|Test Camera|Test Student|Late Larry/, path);
  }
  assert.match(await (await request('/admin', { cookie: teacherCookie })).text(), /Micro Mia/);

  // The teacher cannot touch other people's items or check-outs, or the People page.
  const cameraCheckout = (await db.prepare("SELECT id FROM checkouts WHERE student_id = '888' AND returned_at IS NULL").get());
  assert.equal((await request(`/admin/checkouts/${cameraCheckout.id}/return`, { method: 'POST', cookie: teacherCookie })).status, 404);
  assert.equal((await request(`/admin/items/${camera.id}/edit`, { cookie: teacherCookie })).status, 404);
  assert.equal((await request(`/admin/items/${camera.id}`, { method: 'POST', cookie: teacherCookie, form: { name: 'Hacked' } })).status, 404);
  assert.equal((await request(`/admin/qr?item=${camera.id}`, { cookie: teacherCookie })).status, 200);
  assert.doesNotMatch(await (await request(`/admin/qr?item=${camera.id}`, { cookie: teacherCookie })).text(), /<svg/);
  assert.equal((await request('/admin/people', { cookie: teacherCookie })).status, 403);

  // The teacher can mark their own item returned.
  const ownCheckout = (await db.prepare("SELECT id FROM checkouts WHERE student_id = '777' AND returned_at IS NULL").get());
  assert.equal((await request(`/admin/checkouts/${ownCheckout.id}/return`, { method: 'POST', cookie: teacherCookie })).status, 303);

  // The admin sees both, and can deactivate the teacher, which ends the teacher's session at once.
  const adminCookie = await adminLogin();
  assert.match(await (await request('/admin', { cookie: adminCookie })).text(), /Camera Cam/);
  assert.match(await (await request('/admin/items', { cookie: adminCookie })).text(), /Ms Rivera/);
  const teacherId = (await db.prepare('SELECT id FROM users WHERE email = ?').get(teacher.email)).id;
  await request(`/admin/people/${teacherId}/active`, { method: 'POST', cookie: adminCookie, form: { active: '0' } });
  assert.equal((await request('/admin', { cookie: teacherCookie })).status, 302);
  assert.equal((await request('/admin/login', { method: 'POST', form: { email: teacher.email, password: teacher.password } })).status, 401);
});

test('deleting an item: confirmation, blocked while checked out, owner only', async () => {
  const adminCookie = await adminLogin();
  await request('/admin/items', { method: 'POST', cookie: adminCookie, form: { name: 'Doomed Easel' } });
  const easel = (await db.prepare("SELECT * FROM items WHERE name = 'Doomed Easel'").get());

  // A teacher cannot delete an item they did not list.
  const teacher = { name: 'Mr Okafor', email: 'okafor@example.edu', password: 'long-enough-password' };
  const teacherCookie = cookiesFrom(await signUp(teacher, TEACHER_CODE));
  assert.equal((await request(`/admin/items/${easel.id}/delete`, { cookie: teacherCookie })).status, 404);
  assert.equal((await request(`/admin/items/${easel.id}/delete`, { method: 'POST', cookie: teacherCookie })).status, 404);

  // Opening the confirmation page deletes nothing.
  const confirm = await (await request(`/admin/items/${easel.id}/delete`, { cookie: adminCookie })).text();
  assert.match(confirm, /cannot be undone/);
  assert.ok((await db.prepare('SELECT id FROM items WHERE id = ?').get(easel.id)));

  // While a student holds it, deleting is refused.
  await checkoutFor(easel, { student_name: 'Easel Eve', student_id: '4242' });
  const blocked = await request(`/admin/items/${easel.id}/delete`, { method: 'POST', cookie: adminCookie });
  assert.equal(blocked.status, 409);
  assert.ok((await db.prepare('SELECT id FROM items WHERE id = ?').get(easel.id)));

  // After the return, deleting removes the item, its link and its records. Other records stay.
  const checkout = (await db.prepare('SELECT id FROM checkouts WHERE item_id = ?').get(easel.id));
  await request(`/admin/checkouts/${checkout.id}/return`, { method: 'POST', cookie: adminCookie });
  const others = (await db.prepare('SELECT COUNT(*) AS n FROM checkouts WHERE item_id != ?').get(easel.id)).n;
  const deleted = await request(`/admin/items/${easel.id}/delete`, { method: 'POST', cookie: adminCookie });
  assert.equal(deleted.status, 303);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM items WHERE id = ?').get(easel.id)).n, 0);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM checkouts WHERE item_id = ?').get(easel.id)).n, 0);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM checkouts').get()).n, others);
  assert.equal((await request(`/i/${easel.code}`)).status, 404);
});

test('settings: change name and password', async () => {
  const account = { name: 'Old Name', email: 'settings@example.edu', password: 'first-long-password' };
  const cookie = cookiesFrom(await signUp(account, TEACHER_CODE));

  // Name.
  assert.equal((await request('/admin/settings/name', { method: 'POST', cookie, form: { name: '  ' } })).status, 400);
  assert.equal((await request('/admin/settings/name', { method: 'POST', cookie, form: { name: 'New Name' } })).status, 303);
  assert.match(await (await request('/admin/settings?saved=name', { cookie })).text(), /New Name/);
  assert.match(await (await request('/admin', { cookie })).text(), /New Name/);

  // Password: wrong current, too short, mismatch, then success.
  const change = (form) => request('/admin/settings/password', { method: 'POST', cookie, form });
  assert.equal((await change({ current_password: 'nope-nope-nope', new_password: 'second-long-password', confirm_password: 'second-long-password' })).status, 403);
  assert.equal((await change({ current_password: account.password, new_password: 'short', confirm_password: 'short' })).status, 400);
  assert.equal((await change({ current_password: account.password, new_password: 'second-long-password', confirm_password: 'different-password' })).status, 400);
  assert.equal((await change({ current_password: account.password, new_password: 'second-long-password', confirm_password: 'second-long-password' })).status, 303);

  // The old password stops working; the new one works.
  assert.equal((await request('/admin/login', { method: 'POST', form: { email: account.email, password: account.password } })).status, 401);
  assert.equal((await request('/admin/login', { method: 'POST', form: { email: account.email, password: 'second-long-password' } })).status, 303);
});

test('delete accounts: own account, other accounts, last admin protected', async () => {
  const adminCookie = await adminLogin();

  // A teacher lists an item, then deletes their own account. A wrong password is refused first.
  const teacher = { name: 'Leaving Teacher', email: 'leaving@example.edu', password: 'long-enough-password' };
  const teacherCookie = cookiesFrom(await signUp(teacher, TEACHER_CODE));
  await request('/admin/items', { method: 'POST', cookie: teacherCookie, form: { name: 'Orphan Drum' } });
  const drum = (await db.prepare("SELECT * FROM items WHERE name = 'Orphan Drum'").get());
  await checkoutFor(drum, { student_name: 'Drum Dan', student_id: '31337' });

  assert.equal((await request('/admin/settings/delete', { method: 'POST', cookie: teacherCookie, form: { password: 'wrong-password-x' } })).status, 403);
  assert.ok((await db.prepare('SELECT id FROM users WHERE email = ?').get(teacher.email)));
  const gone = await request('/admin/settings/delete', { method: 'POST', cookie: teacherCookie, form: { password: teacher.password } });
  assert.equal(gone.status, 303);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM users WHERE email = ?').get(teacher.email)).n, 0);
  assert.equal((await request('/admin', { cookie: teacherCookie })).status, 302);

  // The item and its history stay, now owned by the organization and visible to admins.
  assert.equal((await db.prepare('SELECT owner_id FROM items WHERE id = ?').get(drum.id)).owner_id, null);
  assert.match(await (await request('/admin', { cookie: adminCookie })).text(), /Drum Dan/);

  // An admin deletes another account, including a deactivated one.
  const other = { name: 'Other Teacher', email: 'other.teacher@example.edu', password: 'long-enough-password' };
  await signUp(other, TEACHER_CODE);
  const otherId = (await db.prepare('SELECT id FROM users WHERE email = ?').get(other.email)).id;
  assert.match(await (await request(`/admin/people/${otherId}/delete`, { cookie: adminCookie })).text(), /cannot be undone/);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM users WHERE id = ?').get(otherId)).n, 1);
  assert.equal((await request(`/admin/people/${otherId}/delete`, { method: 'POST', cookie: adminCookie })).status, 303);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM users WHERE id = ?').get(otherId)).n, 0);

  // Teachers cannot delete accounts.
  const teacher2 = cookiesFrom(await signUp({ name: 'T Two', email: 't2@example.edu', password: 'long-enough-password' }, TEACHER_CODE));
  const adminId = (await db.prepare('SELECT id FROM users WHERE email = ?').get(ADMIN.email)).id;
  assert.equal((await request(`/admin/people/${adminId}/delete`, { method: 'POST', cookie: teacher2 })).status, 403);

  // The only admin cannot delete their own account.
  const blocked = await request('/admin/settings/delete', { method: 'POST', cookie: adminCookie, form: { password: ADMIN.password } });
  assert.equal(blocked.status, 409);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM users WHERE id = ?').get(adminId)).n, 1);
  // Deleting yourself through the People route is redirected to the safe flow.
  assert.equal((await request(`/admin/people/${adminId}/delete`, { method: 'POST', cookie: adminCookie })).headers.get('location'), '/admin/settings/delete');
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM users WHERE id = ?').get(adminId)).n, 1);
});

test('student accounts: sign-up checks, login, safe redirect, separate sessions', async () => {
  const good = { name: 'Sam Student', student_id: '12345', email: 'sam@example.edu', phone: '', password: 'student-pass-123', confirm_password: 'student-pass-123' };
  const post = (form) => request('/student/signup', { method: 'POST', form });

  for (const [override, message] of [
    [{ name: '' }, /full name/],
    [{ student_id: '' }, /student ID/],
    [{ student_id: 'bad id!' }, /letters, numbers and dashes/],
    [{ email: 'nope' }, /valid email/],
    [{ password: 'short', confirm_password: 'short' }, /8 characters/],
    [{ confirm_password: 'different-pass-1' }, /do not match/],
    [{ phone: 'abc' }, /phone/],
  ]) {
    const response = await post({ ...good, ...override });
    assert.equal(response.status, 400);
    assert.match(await response.text(), message);
  }
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM students WHERE email = ?').get(good.email)).n, 0);

  // Success. The password is stored only as a hash.
  const created = await post({ ...good, next: '/i/not-a-real-place-/../' });
  assert.equal(created.status, 303);
  assert.equal(created.headers.get('location'), '/account');
  const stored = await db.prepare('SELECT * FROM students WHERE email = ?').get(good.email);
  assert.doesNotMatch(stored.password_hash, /student-pass-123/);
  assert.equal((await post(good)).status, 400);

  // Login: wrong password, then right; only our own paths are valid places to go next.
  const login = (form) => request('/student/login', { method: 'POST', form });
  assert.equal((await login({ email: good.email, password: 'wrong-password-1' })).status, 401);
  assert.equal((await login({ email: 'ghost@example.edu', password: 'wrong-password-1' })).status, 401);
  const ok = await login({ email: good.email, password: good.password, next: 'https://evil.example/' });
  assert.equal(ok.status, 303);
  assert.equal(ok.headers.get('location'), '/account');
  const cookie = cookiesFrom(ok);

  // A student login is not a staff login, and a staff login is not a student login.
  assert.equal((await request('/admin', { cookie })).status, 302);
  const adminCookie = await adminLogin();
  assert.equal((await request('/account', { cookie: adminCookie })).status, 302);
  const forged = adminCookie.replace('admin_session', 'student_session');
  assert.equal((await request('/account', { cookie: forged })).status, 302);

  // Logging out ends the session. A deactivated account is logged out at once.
  const loggedOut = await request('/student/logout', { method: 'POST', cookie });
  assert.equal(loggedOut.status, 303);
  assert.equal((await request('/account', { cookie: cookiesFrom(await login({ email: good.email, password: good.password })) + '' })).status, 200);
  const again = cookiesFrom(await login({ email: good.email, password: good.password }));
  await db.prepare('UPDATE students SET active = 0 WHERE email = ?').run(good.email);
  assert.equal((await request('/account', { cookie: again })).status, 302);
  assert.equal((await login({ email: good.email, password: good.password })).status, 401);
});

test('admins see the students who borrowed from their school; teachers cannot', async () => {
  const adminCookie = await adminLogin();
  const { account } = await studentSignup({ name: 'Findable Fran', student_id: '8080' });
  // An account that has not borrowed anything is not shown to a school.
  assert.doesNotMatch(await (await request('/admin/students?q=findable', { cookie: adminCookie })).text(), /Findable Fran/);

  const lamp = await db.prepare('SELECT * FROM items WHERE id = ?').get(await createItem(db, { name: 'Students Test Lamp' }));
  const tripodCheckout = await request(`/i/${lamp.code}/checkout`, {
    method: 'POST',
    cookie: (await request('/student/login', { method: 'POST', form: { email: account.email, password: account.password } })).headers
      .getSetCookie().map((line) => line.split(';')[0]).join('; '),
    form: { due_date: tomorrow() },
  });
  assert.equal(tripodCheckout.status, 303);
  const page = await (await request('/admin/students?q=findable', { cookie: adminCookie })).text();
  assert.match(page, /Findable Fran/);
  assert.match(page, /8080/);
  assert.doesNotMatch(page, /password_hash|scrypt/);

  const teacherCookie = cookiesFrom(await signUp({ name: 'Plain Teacher', email: 'plain.teacher@example.edu', password: 'long-enough-password' }, TEACHER_CODE));
  assert.equal((await request('/admin/students', { cookie: teacherCookie })).status, 403);
  // The old owner-wide demo page is gone.
  assert.equal((await request('/admin/demos', { cookie: adminCookie })).status, 404);
  await request(`/admin/checkouts/${(await db.prepare("SELECT id FROM checkouts WHERE student_id = '8080'").get()).id}/return`, { method: 'POST', cookie: adminCookie });
});

test('demo requests: validated, saved, emailed to the owner, spam-resistant, not shown to admins', async () => {
  demoEmails = [];
  const send = (form) => request('/demo', { method: 'POST', form });
  const valid = { name: 'Dana Director', email: 'dana@otherschool.org', school: 'Other High School', role: 'Librarian', message: 'Cameras and laptops' };

  const home = await (await request('/')).text();
  assert.match(home, /action="\/demo"/);
  assert.match(home, /Request a demo/);

  // Missing fields are refused: nothing saved, nothing emailed.
  const bad = await send({ ...valid, name: '', email: 'nope', school: '' });
  assert.equal(bad.status, 400);
  const badHtml = await bad.text();
  assert.match(badHtml, /Enter your name/);
  assert.match(badHtml, /valid email/);
  assert.match(badHtml, /school or organization/);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM demo_requests').get()).n, 0);
  assert.equal(demoEmails.length, 0);

  // A valid request is saved, emailed to the owner, and shows a thank-you.
  const ok = await send(valid);
  assert.equal(ok.status, 303);
  assert.equal(ok.headers.get('location'), '/?demo=sent#demo');
  assert.match(await (await request('/?demo=sent')).text(), /Request received/);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM demo_requests').get()).n, 1);
  assert.equal(demoEmails.length, 1);
  assert.equal(demoEmails[0].school, 'Other High School');
  assert.equal(demoEmails[0].email, 'dana@otherschool.org');

  // The hidden field catches bots: fake success, nothing saved or emailed.
  assert.equal((await send({ ...valid, website: 'http://spam.example' })).status, 303);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM demo_requests').get()).n, 1);
  assert.equal(demoEmails.length, 1);

  // A school admin cannot see demo requests anywhere.
  const adminCookie = await adminLogin();
  for (const path of ['/admin', '/admin/students', '/admin/people', '/admin/items', '/admin/history']) {
    assert.doesNotMatch(await (await request(path, { cookie: adminCookie })).text(), /Other High School|dana@otherschool/, path);
  }

  // If the email service fails, the visitor still gets a success and the request is kept.
  const working = demoNotifier;
  demoNotifier = async () => {
    throw new Error('email service down');
  };
  assert.equal((await send({ ...valid, school: 'Offline School' })).status, 303);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM demo_requests WHERE school = 'Offline School'").get()).n, 1);
  demoNotifier = working;

  // Too many requests from one address are limited.
  let last;
  for (let i = 0; i < 6; i++) last = await send({ ...valid, school: `School ${i}` });
  assert.equal(last.status, 429);
});

test('schools are separate: each admin sees only their own school', async () => {
  const otherId = await createSchool(db, { name: 'Other Academy', emailDomain: 'other.edu' });
  const other = await db.prepare('SELECT * FROM schools WHERE id = ?').get(otherId);
  assert.ok(other.admin_code && other.teacher_code && other.admin_code !== other.teacher_code);

  // The first school keeps its name, and its admin is shown it.
  const adminCookie = await adminLogin();
  assert.match(await (await request('/admin', { cookie: adminCookie })).text(), new RegExp(DEFAULT_SCHOOL_NAME));

  // The other school's codes create accounts in that school only.
  const otherAdmin = { name: 'Olive Other', email: 'olive@other.edu', password: 'long-enough-password' };
  const otherCookie = cookiesFrom(await signUp(otherAdmin, other.admin_code));
  const otherTeacher = { name: 'Tom Other', email: 'tom@other.edu', password: 'long-enough-password' };
  const otherTeacherCookie = cookiesFrom(await signUp(otherTeacher, other.teacher_code));
  const roles = await db.prepare('SELECT email, role, school_id FROM users WHERE school_id = ? ORDER BY email').all(otherId);
  assert.deepEqual(roles.map((row) => [row.email, row.role]), [['olive@other.edu', 'admin'], ['tom@other.edu', 'teacher']]);
  assert.match(await (await request('/admin', { cookie: otherCookie })).text(), /Other Academy/);

  // They start empty: nothing from the first school shows, not items, not check-outs, not people, not students.
  await request('/admin/items', { method: 'POST', cookie: adminCookie, form: { name: 'Rowland Only Kayak' } });
  const kayak = await db.prepare("SELECT * FROM items WHERE name = 'Rowland Only Kayak'").get();
  await request(`/i/${kayak.code}/checkout`, {
    method: 'POST',
    cookie: (await studentSignup({ name: 'Kay Kayaker', student_id: '5150' })).cookie,
    form: { due_date: tomorrow() },
  });
  for (const path of ['/admin', '/admin/history', '/admin/items', '/admin/qr', '/admin/people', '/admin/students', '/admin/export.csv?scope=all']) {
    const page = await (await request(path, { cookie: otherCookie })).text();
    assert.doesNotMatch(page, /Rowland Only Kayak|Kay Kayaker|Test Admin|admin@example\.edu|Test Camera/, path);
  }

  // Direct links into the first school fail.
  const kayakCheckout = await db.prepare('SELECT id FROM checkouts WHERE item_id = ?').get(kayak.id);
  assert.equal((await request(`/admin/items/${kayak.id}/edit`, { cookie: otherCookie })).status, 404);
  assert.equal((await request(`/admin/items/${kayak.id}/delete`, { cookie: otherCookie })).status, 404);
  assert.equal((await request(`/admin/items/${kayak.id}`, { method: 'POST', cookie: otherCookie, form: { name: 'Stolen' } })).status, 404);
  assert.equal((await request(`/admin/checkouts/${kayakCheckout.id}/return`, { method: 'POST', cookie: otherCookie })).status, 404);
  assert.equal((await db.prepare('SELECT returned_at FROM checkouts WHERE id = ?').get(kayakCheckout.id)).returned_at, null);
  assert.equal((await request(`/admin/qr?item=${kayak.id}`, { cookie: otherCookie })).status, 200);
  assert.doesNotMatch(await (await request(`/admin/qr?item=${kayak.id}`, { cookie: otherCookie })).text(), /<svg/);

  // Admins cannot manage people from another school.
  const rowlandAdminId = (await db.prepare('SELECT id FROM users WHERE email = ?').get(ADMIN.email)).id;
  const olive = await db.prepare('SELECT id FROM users WHERE email = ?').get(otherAdmin.email);
  assert.equal((await request(`/admin/people/${rowlandAdminId}/active`, { method: 'POST', cookie: otherCookie, form: { active: '0' } })).status, 303);
  assert.equal((await db.prepare('SELECT active FROM users WHERE id = ?').get(rowlandAdminId)).active, 1);
  assert.equal((await request(`/admin/people/${rowlandAdminId}/delete`, { method: 'POST', cookie: otherCookie })).status, 404);
  assert.equal((await request(`/admin/people/${rowlandAdminId}/delete`, { cookie: otherCookie })).status, 404);
  assert.ok(await db.prepare('SELECT id FROM users WHERE id = ?').get(rowlandAdminId));

  // And the first school's admin cannot reach the other school's people either.
  const tom = await db.prepare('SELECT id FROM users WHERE email = ?').get(otherTeacher.email);
  assert.equal((await request(`/admin/people/${tom.id}/delete`, { method: 'POST', cookie: adminCookie })).status, 404);
  await request(`/admin/people/${tom.id}/active`, { method: 'POST', cookie: adminCookie, form: { active: '0' } });
  assert.equal((await db.prepare('SELECT active FROM users WHERE id = ?').get(tom.id)).active, 1);
  assert.doesNotMatch(await (await request('/admin/people', { cookie: adminCookie })).text(), /olive@other\.edu|tom@other\.edu|Other Academy/);

  // Each admin sees their own school's sign-up codes, and not the other's.
  const own = await (await request('/admin/people', { cookie: otherCookie })).text();
  assert.match(own, new RegExp(other.teacher_code));
  assert.doesNotMatch(own, new RegExp(TEACHER_CODE));
  assert.doesNotMatch(await (await request('/admin/people', { cookie: adminCookie })).text(), new RegExp(other.teacher_code));

  // The other school's items belong to it: a teacher there lists one, and only that school's admin sees it.
  await request('/admin/items', { method: 'POST', cookie: otherTeacherCookie, form: { name: 'Academy Telescope' } });
  assert.match(await (await request('/admin/items', { cookie: otherCookie })).text(), /Academy Telescope/);
  assert.doesNotMatch(await (await request('/admin/items', { cookie: adminCookie })).text(), /Academy Telescope/);

  // The other school's email domain is checked when a student checks out one of its items.
  const telescope = await db.prepare("SELECT * FROM items WHERE name = 'Academy Telescope'").get();
  const { cookie: wrongDomain } = await studentSignup({ email: 'someone@elsewhere.org' });
  const refused = await request(`/i/${telescope.code}/checkout`, { method: 'POST', cookie: wrongDomain, form: { due_date: tomorrow() } });
  assert.equal(refused.status, 400);
  assert.match(await refused.text(), /@other\.edu/);
  const { cookie: rightDomain } = await studentSignup({ email: 'pat@other.edu' });
  assert.equal((await request(`/i/${telescope.code}/checkout`, { method: 'POST', cookie: rightDomain, form: { due_date: tomorrow() } })).status, 303);
  assert.match(await (await request('/admin/students', { cookie: otherCookie })).text(), /pat@other\.edu/);
  assert.doesNotMatch(await (await request('/admin/students', { cookie: adminCookie })).text(), /pat@other\.edu/);
});

test('the demo email goes to the owner through the email service', async () => {
  const { makeDemoNotifier } = await import('../src/mail.js');
  assert.equal(makeDemoNotifier({ apiKey: '', to: 'owner@example.com' }), null);
  assert.equal(makeDemoNotifier({ apiKey: 'key', to: '' }), null);

  const calls = [];
  const notify = makeDemoNotifier({
    apiKey: 'test-key',
    to: 'owner@example.com',
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 200 };
    },
  });
  await notify({ name: 'Dana\nBcc: evil@example.com', email: 'dana@school.org', school: 'Line\r\nBreak School', role: '', message: 'hello' });
  assert.equal(calls[0].url, 'https://api.resend.com/emails');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer test-key');
  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual(body.to, ['owner@example.com']);
  assert.equal(body.reply_to, 'dana@school.org');
  assert.doesNotMatch(body.subject, /[\r\n]/);
  assert.match(body.subject, /Line Break School/);

  const failing = makeDemoNotifier({ apiKey: 'k', to: 'o@example.com', fetchImpl: async () => ({ ok: false, status: 403 }) });
  await assert.rejects(() => failing({ name: 'a', email: 'a@b.co', school: 's' }), /403/);
});
test('wrong student passwords lock only that account, not everyone on the same network', async () => {
  const victim = (await studentSignup({ email: 'victim@example.edu' })).account;
  const bystander = (await studentSignup({ email: 'bystander@example.edu' })).account;
  const login = (account, password) =>
    request('/student/login', { method: 'POST', form: { email: account.email, password } });
  for (let i = 0; i < 8; i++) assert.equal((await login(victim, 'wrong-password-1')).status, 401);
  assert.equal((await login(victim, victim.password)).status, 429);
  assert.equal((await login(bystander, bystander.password)).status, 303);
});
