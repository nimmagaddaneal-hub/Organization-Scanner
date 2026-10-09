import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, createItem, createSchool, syncDefaultSchool, DEFAULT_SCHOOL_NAME } from '../src/db.js';
import { createApp } from '../src/app.js';

const OWNER_PASSWORD = 'test-owner-password-1';
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

// A student fills in the form and checks the item out. Returns the response, that phone's cookie and the details used.
async function checkoutFor(item, { student_name, student_id, email, ...rest } = {}) {
  studentCount += 1;
  const account = {
    name: student_name ?? 'Test Student',
    student_id: student_id ?? '100200',
    email: email ?? `student${studentCount}@example.edu`,
  };
  const response = await request(`/i/${item.code}/checkout`, {
    method: 'POST',
    form: {
      student_name: account.name,
      student_id: account.student_id,
      email: account.email,
      due_date: tomorrow(),
      purpose: 'Club photo day',
      phone: '',
      ...rest,
    },
  });
  return { response, cookie: cookiesFrom(response), account };
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
  const app = createApp({ db, sessionSecret: 'test-secret', notifyDemo: (request) => demoNotifier(request), ownerPassword: OWNER_PASSWORD });
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

test('scanned link opens the form with the item filled in, and there are no student accounts', async () => {
  const response = await request(`/i/${camera.code}`);
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /value="Test Camera" readonly/);
  assert.match(html, /name="student_name"/);
  assert.match(html, /name="student_id"/);
  assert.match(html, /name="due_date"/);
  for (const path of ['/student/login', '/student/signup', '/account', '/student/new-password']) {
    assert.equal((await request(path)).status, 404, path);
  }
  assert.doesNotMatch(await (await request('/')).text(), /student\/login|student\/signup|Create student account/);
});

test('unknown code shows "not found"', async () => {
  const response = await request('/i/doesnotexist');
  assert.equal(response.status, 404);
});

test('form rejects missing and invalid fields', async () => {
  const response = await request(`/i/${camera.code}/checkout`, {
    method: 'POST',
    form: { student_name: '', student_id: 'bad id!', email: 'not-an-email', phone: 'abc', due_date: '2000-01-01' },
  });
  const html = await response.text();
  assert.equal(response.status, 400);
  assert.match(html, /Enter your full name/);
  assert.match(html, /letters, numbers and dashes/);
  assert.match(html, /valid email/);
  assert.match(html, /valid phone number/);
  assert.match(html, /cannot be in the past/);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM checkouts').get()).n, 0);
});

test('every admin route requires the login', async () => {
  for (const path of ['/admin', '/admin/history', '/admin/items', '/admin/qr', '/admin/export.csv', '/admin/items/1/edit', '/admin/items/1/delete', '/admin/people', '/admin/settings', '/admin/settings/delete', '/admin/people/1/delete']) {
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
  // A student submits the form.
  const { response: submit, cookie: studentCookie } = await checkoutFor(camera, {
    student_name: 'Test Student', student_id: '100200', email: 'test.student@example.edu',
  });
  assert.equal(submit.status, 303);

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
  const duplicate = await checkoutFor(camera, { student_name: 'Other Person', student_id: '999', email: 'other@example.edu' });
  assert.equal(duplicate.response.status, 409);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM checkouts WHERE returned_at IS NULL').get()).n, 1);

  // A different student cannot return it with wrong details.
  const wrongReturn = await request(`/i/${camera.code}/return`, { method: 'POST', form: { student_id: '999', email: 'other@example.edu' } });
  assert.equal(wrongReturn.status, 403);

  // The same student scans again on the same phone: "Return this item" is offered.
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

test('a student can return from another phone with student ID and email', async () => {
  const { account } = await checkoutFor(tripod, { student_id: 'AB-77', email: 'test.student@example.edu' });
  const response = await request(`/i/${tripod.code}/return`, {
    method: 'POST',
    form: { student_id: 'ab-77', email: account.email.toUpperCase() },
  });
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
  for (const path of ['/admin', '/admin/people', '/admin/items', '/admin/history']) {
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
  await checkoutFor(kayak, { student_name: 'Kay Kayaker', student_id: '5150' });
  for (const path of ['/admin', '/admin/history', '/admin/items', '/admin/qr', '/admin/people', '/admin/export.csv?scope=all']) {
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
  const refused = await checkoutFor(telescope, { email: 'someone@elsewhere.org' });
  assert.equal(refused.response.status, 400);
  assert.match(await refused.response.text(), /@other\.edu/);
  const accepted = await checkoutFor(telescope, { email: 'pat@other.edu' });
  assert.equal(accepted.response.status, 303);
  assert.match(await (await request('/admin', { cookie: otherCookie })).text(), /pat@other\.edu/);
  assert.doesNotMatch(await (await request('/admin', { cookie: adminCookie })).text(), /pat@other\.edu/);
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
test('the home page has the animated diagram and its script, and no separate scroll story', async () => {
  const home = await (await request('/')).text();
  assert.match(home, /id="diagram"/);
  assert.match(home, /id="dg-canvas"/);
  assert.match(home, /Your organization/);
  assert.match(home, /<script src="\/diagram\.js"/);
  assert.match(home, /class="story-track"/);
  assert.doesNotMatch(home, /story-canvas|story\.js/);
  const script = await request('/diagram.js');
  assert.equal(script.status, 200);
  assert.match(await script.text(), /dg-canvas/);
  assert.equal((await request('/story.js')).status, 404);
});

test('admins reset passwords without email: temporary password, forced change, old logins end', async () => {
  const adminCookie = await adminLogin();
  const teacher = { name: 'Forgetful Teacher', email: 'forgetful@example.edu', password: 'long-enough-password' };
  const oldCookie = cookiesFrom(await signUp(teacher, TEACHER_CODE));
  const teacherId = (await db.prepare('SELECT id FROM users WHERE email = ?').get(teacher.email)).id;

  // Only admins can reset, never your own account, never another school's.
  assert.equal((await request(`/admin/people/${teacherId}/reset-password`, { method: 'POST', cookie: oldCookie })).status, 403);
  const adminId = (await db.prepare('SELECT id FROM users WHERE email = ?').get(ADMIN.email)).id;
  assert.equal((await request(`/admin/people/${adminId}/reset-password`, { method: 'POST', cookie: adminCookie })).status, 303);
  const otherSchool = await createSchool(db, { name: 'Reset Test Academy' });
  const otherCodes = await db.prepare('SELECT admin_code FROM schools WHERE id = ?').get(otherSchool);
  const otherAdminCookie = cookiesFrom(await signUp({ name: 'Other Admin', email: 'reset.other@example.edu', password: 'long-enough-password' }, otherCodes.admin_code));
  assert.equal((await request(`/admin/people/${teacherId}/reset-password`, { method: 'POST', cookie: otherAdminCookie })).status, 404);

  // The reset shows a temporary password once.
  const reset = await request(`/admin/people/${teacherId}/reset-password`, { method: 'POST', cookie: adminCookie });
  assert.equal(reset.status, 200);
  const temporary = (await reset.text()).match(/<code>([A-Za-z0-9]{12})<\/code>/)[1];
  const stored = await db.prepare('SELECT password_hash, must_change FROM users WHERE id = ?').get(teacherId);
  assert.equal(stored.must_change, 1);
  assert.doesNotMatch(stored.password_hash, new RegExp(temporary));

  // The old password and the old login stop working.
  assert.equal((await request('/admin', { cookie: oldCookie })).status, 302);
  assert.equal((await request('/admin/login', { method: 'POST', form: { email: teacher.email, password: teacher.password } })).status, 401);

  // The temporary password works, but only to choose a new one.
  const login = await request('/admin/login', { method: 'POST', form: { email: teacher.email, password: temporary } });
  assert.equal(login.status, 303);
  const tempCookie = cookiesFrom(login);
  for (const path of ['/admin', '/admin/items', '/admin/history', '/admin/settings']) {
    const response = await request(path, { cookie: tempCookie });
    assert.equal(response.headers.get('location'), '/admin/settings/new-password', path);
  }
  const mustChange = await request('/admin/settings/new-password', { cookie: tempCookie });
  assert.equal(mustChange.status, 200);
  assert.match(await mustChange.text(), /Choose a new password/);
  const bad = (form) => request('/admin/settings/new-password', { method: 'POST', cookie: tempCookie, form });
  assert.equal((await bad({ password: 'short', confirm_password: 'short' })).status, 400);
  assert.equal((await bad({ password: 'a-brand-new-password', confirm_password: 'different-password-x' })).status, 400);
  const done = await bad({ password: 'a-brand-new-password', confirm_password: 'a-brand-new-password' });
  assert.equal(done.status, 303);
  const newCookie = cookiesFrom(done);
  assert.equal((await request('/admin/items', { cookie: newCookie })).status, 200);
  assert.equal((await db.prepare('SELECT must_change FROM users WHERE id = ?').get(teacherId)).must_change, 0);
  // The temporary password is spent.
  assert.equal((await request('/admin/login', { method: 'POST', form: { email: teacher.email, password: temporary } })).status, 401);
});

test('changing your password logs out your other devices', async () => {
  const account = { name: 'Two Phones', email: 'twophones@example.edu', password: 'long-enough-password' };
  const first = cookiesFrom(await signUp(account, TEACHER_CODE));
  const second = cookiesFrom(await request('/admin/login', { method: 'POST', form: { email: account.email, password: account.password } }));
  assert.equal((await request('/admin/items', { cookie: second })).status, 200);
  const change = await request('/admin/settings/password', {
    method: 'POST',
    cookie: first,
    form: { current_password: account.password, new_password: 'the-new-long-password', confirm_password: 'the-new-long-password' },
  });
  assert.equal(change.status, 303);
  assert.equal((await request('/admin/items', { cookie: second })).status, 302);
  assert.equal((await request('/admin/items', { cookie: cookiesFrom(change) })).status, 200);
});

test('a student sees a warning on a late item', async () => {
  const lamp = await db.prepare('SELECT * FROM items WHERE id = ?').get(await createItem(db, { name: 'Late Warning Lamp' }));
  const { cookie } = await checkoutFor(lamp, { student_id: '9191' });
  assert.doesNotMatch(await (await request(`/i/${lamp.code}`, { cookie })).text(), /This is late/);
  await db.prepare("UPDATE checkouts SET due_date = '2020-01-01' WHERE item_id = ? AND returned_at IS NULL").run(lamp.id);
  assert.match(await (await request(`/i/${lamp.code}`, { cookie })).text(), /This is late/);
  await db.prepare('UPDATE checkouts SET returned_at = ? WHERE item_id = ?').run(new Date().toISOString(), lamp.id);
});

test('late items get a ready-written email link, on time items do not', async () => {
  const adminCookie = await adminLogin();
  const [late, fine] = await Promise.all(
    ['Mail Test Late', 'Mail Test Fine'].map(async (name) =>
      db.prepare('SELECT * FROM items WHERE id = ?').get(await createItem(db, { name }))
    )
  );
  const a = await checkoutFor(late, { student_name: 'Lena Late', email: 'lena.late@example.edu' });
  const b = await checkoutFor(fine, { student_name: 'Oscar Ontime', email: 'oscar.ontime@example.edu' });
  assert.equal(a.response.status, 303);
  assert.equal(b.response.status, 303);
  await db.prepare("UPDATE checkouts SET due_date = '2020-01-01' WHERE item_id = ? AND returned_at IS NULL").run(late.id);

  const page = await (await request('/admin', { cookie: adminCookie })).text();
  const links = [...page.matchAll(/href="(mailto:[^"]*subject=[^"]*)"/g)].map((match) => match[1].replaceAll('&amp;', '&'));
  const one = links.find((link) => link.startsWith('mailto:lena.late%40example.edu'));
  assert.ok(one, 'reminder link for the late student');
  const decoded = decodeURIComponent(one);
  assert.match(decoded, /Reminder: Mail Test Late was due/);
  assert.match(decoded, /Hi Lena,/);
  assert.match(decoded, /Test Admin/);
  assert.ok(!links.some((link) => link.includes('oscar.ontime')), 'no reminder for on-time items');

  const all = links.find((link) => link.startsWith('mailto:?bcc='));
  assert.ok(all, 'one email for everyone late');
  assert.match(decodeURIComponent(all), /lena\.late@example\.edu/);
  assert.doesNotMatch(decodeURIComponent(all), /oscar\.ontime/);

  // A student's name with markup is escaped on the page and encoded in the link.
  await db.prepare("UPDATE checkouts SET student_name = ? WHERE item_id = ? AND returned_at IS NULL").run('<b>Bold</b> "Quote"', late.id);
  const risky = await (await request('/admin', { cookie: adminCookie })).text();
  assert.doesNotMatch(risky, /<b>Bold<\/b>/);

  for (const item of [late, fine]) {
    await db.prepare('UPDATE checkouts SET returned_at = ? WHERE item_id = ?').run(new Date().toISOString(), item.id);
  }
});

test('privacy and terms page is public and linked from the forms and footers', async () => {
  const page = await request('/privacy');
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /<h1>Privacy and terms<\/h1>/);
  assert.match(html, /Other schools never see it/);
  assert.match(html, /You do not make an account/);
  for (const path of ['/', '/admin/signup', '/admin/login', '/privacy']) {
    assert.match(await (await request(path)).text(), /href="\/privacy"/, path);
  }
  assert.match(await (await request('/admin/signup')).text(), /you agree to the <a href="\/privacy">/);
  const lamp = await db.prepare('SELECT * FROM items WHERE id = ?').get(await createItem(db, { name: 'Privacy Test Lamp' }));
  assert.match(await (await request(`/i/${lamp.code}`)).text(), /agree to the <a href="\/privacy">/);
});

async function ownerLogin() {
  const response = await request('/owner/login', { method: 'POST', form: { password: OWNER_PASSWORD } });
  assert.equal(response.status, 303);
  return cookiesFrom(response);
}

test('the owner page is off without a password, and locked without the login', async () => {
  // A second copy of the app with no owner password: the owner pages do not exist.
  const bare = createApp({ db, sessionSecret: 'test-secret' });
  const bareServer = await new Promise((resolve) => {
    const started = bare.listen(0, '127.0.0.1', () => resolve(started));
  });
  const bareUrl = `http://127.0.0.1:${bareServer.address().port}`;
  assert.equal((await fetch(`${bareUrl}/owner`, { redirect: 'manual' })).status, 404);
  assert.equal((await fetch(`${bareUrl}/owner/login`, { redirect: 'manual' })).status, 404);
  bareServer.close();

  for (const path of ['/owner', '/owner/demos', '/owner/accounts', '/owner/students/erase?who=x', '/owner/accounts/staff/1/delete']) {
    const response = await request(path);
    assert.equal(response.status, 302, path);
    assert.equal(response.headers.get('location'), '/owner/login', path);
  }
  for (const path of ['/owner/schools', '/owner/schools/1', '/owner/schools/2/codes', '/owner/demos/1/status', '/owner/demos/1/delete',
    '/owner/accounts/staff/1/reset-password', '/owner/students/erase', '/owner/accounts/staff/1/delete', '/owner/logout']) {
    assert.equal((await request(path, { method: 'POST', form: {} })).status, 401, path);
  }
  assert.equal((await request('/owner/login', { method: 'POST', form: { password: 'wrong-owner-password' } })).status, 401);

  // Staff and student logins are not owner logins, and the owner login is not a staff login.
  const adminCookie = await adminLogin();
  assert.equal((await request('/owner', { cookie: adminCookie })).status, 302);
  assert.equal((await request('/owner', { cookie: adminCookie.replace('admin_session', 'owner_session') })).status, 302);
  const ownerCookie = await ownerLogin();
  assert.equal((await request('/owner', { cookie: ownerCookie })).status, 200);
  assert.equal((await request('/admin', { cookie: ownerCookie })).status, 302);
});

test('owner: add a school, new codes, rename, read and clear demo requests', async () => {
  const ownerCookie = await ownerLogin();
  const add = await request('/owner/schools', { method: 'POST', cookie: ownerCookie, form: { name: 'Owner Made Academy', email_domain: '@made.edu' } });
  assert.equal(add.status, 303);
  const school = await db.prepare("SELECT * FROM schools WHERE name = 'Owner Made Academy'").get();
  assert.equal(school.email_domain, 'made.edu');
  assert.ok(school.admin_code && school.teacher_code);
  const page = await (await request('/owner', { cookie: ownerCookie })).text();
  assert.match(page, new RegExp(school.admin_code));
  assert.match(page, new RegExp(DEFAULT_SCHOOL_NAME));

  // New codes replace the old ones; the first school's codes are not touched here.
  await request(`/owner/schools/${school.id}/codes`, { method: 'POST', cookie: ownerCookie });
  const fresh = await db.prepare('SELECT * FROM schools WHERE id = ?').get(school.id);
  assert.notEqual(fresh.admin_code, school.admin_code);
  assert.equal((await signUp({ name: 'Old Code', email: 'oldcode@made.edu', password: 'long-enough-password' }, school.admin_code)).status, 400);
  assert.equal((await signUp({ name: 'New Code', email: 'newcode@made.edu', password: 'long-enough-password' }, fresh.admin_code)).status, 303);
  const firstBefore = await db.prepare('SELECT admin_code FROM schools WHERE id = 1').get();
  await request('/owner/schools/1/codes', { method: 'POST', cookie: ownerCookie });
  assert.equal((await db.prepare('SELECT admin_code FROM schools WHERE id = 1').get()).admin_code, firstBefore.admin_code);

  await request(`/owner/schools/${school.id}`, { method: 'POST', cookie: ownerCookie, form: { name: 'Renamed Academy', email_domain: 'renamed.edu' } });
  assert.deepEqual(
    { ...(await db.prepare('SELECT name, email_domain FROM schools WHERE id = ?').get(school.id)) },
    { name: 'Renamed Academy', email_domain: 'renamed.edu' }
  );

  // Demo requests: only the owner reads them.
  await db.prepare('DELETE FROM demo_requests').run();
  // (The public form is rate limited per address and has used its allowance in an earlier test.)
  await db
    .prepare('INSERT INTO demo_requests (name, email, school, role, message, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('Dee', 'dee@elsewhere.org', 'Elsewhere <i>High</i>', '', 'hi', new Date().toISOString());
  const demos = await (await request('/owner/demos', { cookie: ownerCookie })).text();
  assert.match(demos, /Elsewhere &lt;i&gt;High&lt;\/i&gt;/);
  const demoId = (await db.prepare('SELECT id FROM demo_requests').get()).id;
  await request(`/owner/demos/${demoId}/status`, { method: 'POST', cookie: ownerCookie, form: { status: 'contacted' } });
  assert.equal((await db.prepare('SELECT status FROM demo_requests WHERE id = ?').get(demoId)).status, 'contacted');
  assert.doesNotMatch(await (await request('/admin/people', { cookie: await adminLogin() })).text(), /Elsewhere/);
  await request(`/owner/demos/${demoId}/delete`, { method: 'POST', cookie: ownerCookie });
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM demo_requests').get()).n, 0);
});

test('owner: erase a student by email or ID, reset a staff password, delete a staff account', async () => {
  const ownerCookie = await ownerLogin();
  const adminCookie = await adminLogin();

  // Erasing a student removes their details from every check-out, matched by email or by student ID.
  const lamp = await db.prepare('SELECT * FROM items WHERE id = ?').get(await createItem(db, { name: 'Erase Test Lamp' }));
  const rug = await db.prepare('SELECT * FROM items WHERE id = ?').get(await createItem(db, { name: 'Erase Test Rug' }));
  await checkoutFor(lamp, { student_name: 'Erase Me', student_id: '5959', email: 'erase.me@example.edu', phone: '555-123-4567', purpose: 'my private note' });
  await checkoutFor(rug, { student_name: 'Erase Me', student_id: '5959', email: 'ERASE.ME@example.edu' });
  const mat = await db.prepare('SELECT * FROM items WHERE id = ?').get(await createItem(db, { name: 'Erase Test Mat' }));
  await checkoutFor(mat, { student_name: 'Keep Me', student_id: '6060', email: 'keep.me@example.edu' });
  // Left over from the time when students had accounts.
  await db
    .prepare('INSERT INTO students (name, student_id, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)')
    .run('Erase Me', '5959', 'erase.me@example.edu', 'scrypt$00$00', new Date().toISOString());

  const review = await (await request(`/owner/students/erase?who=${encodeURIComponent('Erase.Me@example.edu')}`, { cookie: ownerCookie })).text();
  assert.match(review, /<strong>2<\/strong> check-outs/);
  assert.match(review, /cannot be undone/);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM checkouts WHERE student_name = 'Erase Me'").get()).n, 2);

  assert.equal((await request('/owner/students/erase', { method: 'POST', cookie: ownerCookie, form: { who: 'erase.me@example.edu' } })).status, 303);
  const erased = await db.prepare("SELECT * FROM checkouts WHERE student_name = '(erased)' ORDER BY id").all();
  assert.equal(erased.length, 2);
  for (const row of erased) for (const field of ['student_id', 'email', 'phone', 'purpose']) assert.equal(row[field], '', field);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM students WHERE email = 'erase.me@example.edu'").get()).n, 0);
  assert.doesNotMatch(await (await request('/admin/history', { cookie: adminCookie })).text(), /Erase Me|erase\.me|5959|my private note/);
  // Other students are untouched.
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM checkouts WHERE student_name = 'Keep Me' AND email = 'keep.me@example.edu'").get()).n, 1);

  // Matching by student ID alone works too.
  const byId = await db.prepare('SELECT * FROM items WHERE id = ?').get(await createItem(db, { name: 'Erase By Id Lamp' }));
  await checkoutFor(byId, { student_name: 'Id Only', student_id: '7171', email: 'id.only@example.edu' });
  await request('/owner/students/erase', { method: 'POST', cookie: ownerCookie, form: { who: '7171' } });
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM checkouts WHERE student_id = '7171'").get()).n, 0);
  for (const id of [lamp.id, rug.id, mat.id, byId.id]) await db.prepare('UPDATE checkouts SET returned_at = ? WHERE item_id = ? AND returned_at IS NULL').run(new Date().toISOString(), id);

  // Staff: reset a password, then delete the account (their items stay with the school).
  const teacher = { name: 'Owner Helped', email: 'owner.helped@example.edu', password: 'long-enough-password' };
  const teacherCookie = cookiesFrom(await signUp(teacher, TEACHER_CODE));
  await request('/admin/items', { method: 'POST', cookie: teacherCookie, form: { name: 'Owner Helped Item' } });
  const teacherId = (await db.prepare('SELECT id FROM users WHERE email = ?').get(teacher.email)).id;
  const found = await (await request(`/owner/accounts?q=${encodeURIComponent('owner.helped')}`, { cookie: ownerCookie })).text();
  assert.match(found, /Owner Helped/);
  const staffReset = await request(`/owner/accounts/staff/${teacherId}/reset-password`, { method: 'POST', cookie: ownerCookie });
  assert.match(await staffReset.text(), /<code>[A-Za-z0-9]{12}<\/code>/);
  assert.equal((await request('/admin', { cookie: teacherCookie })).status, 302);
  assert.equal((await request(`/owner/accounts/staff/${teacherId}/delete`, { method: 'POST', cookie: ownerCookie })).status, 303);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM users WHERE id = ?').get(teacherId)).n, 0);
  const item = await db.prepare("SELECT owner_id, school_id FROM items WHERE name = 'Owner Helped Item'").get();
  assert.equal(item.owner_id, null);
  assert.equal(item.school_id, 1);
});


test('the scan page, its script and the QR reader library are served', async () => {
  const page = await request('/scan');
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /id="scan-video"/);
  assert.match(html, /<script src="\/scan\.js"/);
  assert.match(html, /action="\/find"/);
  assert.match(await (await request('/')).text(), /href="\/scan"/);
  const script = await request('/scan.js');
  assert.equal(script.status, 200);
  assert.match(await script.text(), /getUserMedia/);
  const library = await request('/vendor/jsQR.js');
  assert.equal(library.status, 200);
  assert.match(await library.text(), /jsQR/);
  // The typed code goes to the item.
  const found = await request(`/find?code=${camera.code.toUpperCase()}`);
  assert.equal(found.headers.get('location'), `/i/${camera.code}`);
});

const dayFrom = (days) => new Date(Date.now() + days * 24 * 60 * 60 * 1000).toLocaleDateString('en-CA');

test('return notes: students and staff can record damage or missing parts, staff see them', async () => {
  const adminCookie = await adminLogin();
  const [bike, pump] = await Promise.all(
    ['Notes Test Bike', 'Notes Test Pump'].map(async (name) =>
      db.prepare('SELECT * FROM items WHERE id = ?').get(await createItem(db, { name }))
    )
  );
  const first = await checkoutFor(bike, { student_name: 'Nora Notes', student_id: '3131' });
  const returned = await request(`/i/${bike.code}/return`, {
    method: 'POST',
    cookie: first.cookie,
    form: { return_notes: 'Left tire is flat <script>alert(1)</script>' },
  });
  assert.match(await returned.text(), /Returned/);
  assert.equal((await db.prepare('SELECT return_notes FROM checkouts WHERE item_id = ?').get(bike.id)).return_notes, 'Left tire is flat <script>alert(1)</script>');

  // Staff return with a note, too. Notes are capped.
  await checkoutFor(pump, { student_name: 'Pete Pump', student_id: '3232' });
  const checkoutId = (await db.prepare('SELECT id FROM checkouts WHERE item_id = ?').get(pump.id)).id;
  await request(`/admin/checkouts/${checkoutId}/return`, { method: 'POST', cookie: adminCookie, form: { return_notes: 'x'.repeat(500) } });
  assert.equal((await db.prepare('SELECT return_notes FROM checkouts WHERE id = ?').get(checkoutId)).return_notes.length, 300);

  const history = await (await request('/admin/history?q=Notes+Test', { cookie: adminCookie })).text();
  assert.match(history, /Left tire is flat/);
  assert.doesNotMatch(history, /<script>alert/);
  const csv = await (await request('/admin/export.csv?scope=all', { cookie: adminCookie })).text();
  assert.match(csv, /"Return notes"/);
  assert.match(csv, /Left tire is flat/);

  // The return forms ask for notes.
  const free = await (await request(`/i/${bike.code}`)).text();
  assert.doesNotMatch(free, /return_notes/);
  const taken = await checkoutFor(bike, { student_name: 'Next Student', student_id: '3333' });
  assert.match(await (await request(`/i/${bike.code}`, { cookie: taken.cookie })).text(), /name="return_notes"/);
  assert.match(await (await request(`/i/${bike.code}`)).text(), /name="return_notes"/);
  await db.prepare('UPDATE checkouts SET returned_at = ? WHERE item_id = ? AND returned_at IS NULL').run(new Date().toISOString(), bike.id);
});

test('extension: the phone that checked out can move the date once, up to 7 days; staff can change it any time', async () => {
  const adminCookie = await adminLogin();
  const lamp = await db.prepare('SELECT * FROM items WHERE id = ?').get(await createItem(db, { name: 'Extension Test Lamp' }));
  const due = dayFrom(2);
  const { cookie } = await checkoutFor(lamp, { student_name: 'Eve Extends', student_id: '4141', due_date: due });
  const extend = (form, who = cookie) => request(`/i/${lamp.code}/extend`, { method: 'POST', cookie: who, form });
  const row = () => db.prepare('SELECT due_date, original_due_date, extended FROM checkouts WHERE item_id = ? AND returned_at IS NULL').get(lamp.id);

  assert.match(await (await request(`/i/${lamp.code}`, { cookie })).text(), /I need more time/);
  // Not the same phone, too early, or too far: nothing changes.
  assert.equal((await extend({ due_date: dayFrom(4) }, '')).status, 303);
  assert.equal((await row()).extended, 0);
  assert.equal((await extend({ due_date: due })).status, 400);
  assert.equal((await extend({ due_date: dayFrom(1) })).status, 400);
  const tooFar = await extend({ due_date: dayFrom(10) });
  assert.equal(tooFar.status, 400);
  assert.match(await tooFar.text(), /up to 7 days/);
  assert.equal((await extend({ due_date: 'nonsense' })).status, 400);
  assert.equal((await row()).due_date, due);

  // A good request works once.
  const ok = await extend({ due_date: dayFrom(8) });
  assert.equal(ok.status, 303);
  assert.equal(ok.headers.get('location'), `/i/${lamp.code}?extended=1`);
  assert.deepEqual({ ...(await row()) }, { due_date: dayFrom(8), original_due_date: due, extended: 1 });
  const own = await (await request(`/i/${lamp.code}?extended=1`, { cookie })).text();
  assert.match(own, /Return date extended/);
  assert.doesNotMatch(own, /I need more time/);
  const again = await extend({ due_date: dayFrom(9) });
  assert.equal(again.status, 400);
  assert.equal((await row()).due_date, dayFrom(8));

  // The dashboard shows the original date. Staff change the date themselves, and only for their own school's items.
  assert.match(await (await request('/admin', { cookie: adminCookie })).text(), /was /);
  const checkoutId = (await db.prepare('SELECT id FROM checkouts WHERE item_id = ? AND returned_at IS NULL').get(lamp.id)).id;
  assert.equal((await request(`/admin/checkouts/${checkoutId}/due`, { method: 'POST', cookie: adminCookie, form: { due_date: dayFrom(20) } })).status, 303);
  assert.equal((await row()).due_date, dayFrom(20));
  assert.equal((await row()).original_due_date, due);
  await request(`/admin/checkouts/${checkoutId}/due`, { method: 'POST', cookie: adminCookie, form: { due_date: 'bad' } });
  assert.equal((await row()).due_date, dayFrom(20));
  const otherSchool = await createSchool(db, { name: 'Extension Other School' });
  const otherCookie = cookiesFrom(await signUp({ name: 'Ext Other', email: 'ext.other@example.edu', password: 'long-enough-password' }, (await db.prepare('SELECT admin_code FROM schools WHERE id = ?').get(otherSchool)).admin_code));
  assert.equal((await request(`/admin/checkouts/${checkoutId}/due`, { method: 'POST', cookie: otherCookie, form: { due_date: dayFrom(30) } })).status, 404);
  const csv = await (await request('/admin/export.csv?scope=current', { cookie: adminCookie })).text();
  assert.match(csv, /Original due date/);
  await db.prepare('UPDATE checkouts SET returned_at = ? WHERE item_id = ?').run(new Date().toISOString(), lamp.id);
});
