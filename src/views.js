// HTML pages, built from template strings. Every dynamic value goes through esc().

export function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function formatDateTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

export function formatDate(day) {
  if (!day) return '';
  const [year, month, date] = day.split('-').map(Number);
  return new Date(year, month - 1, date).toLocaleDateString('en-US', { dateStyle: 'medium' });
}

const STAFF_LINKS = [
  ['dashboard', '/admin', 'Checked out'],
  ['history', '/admin/history', 'History'],
  ['items', '/admin/items', 'Items'],
  ['codes', '/admin/qr', 'Codes'],
  ['people', '/admin/people', 'People', 'admin'],
];

function layout({ title, body, user = null, active = '', wide = false, landing = false, staffLink = true }) {
  const current = (key) => (active === key ? ' aria-current="page"' : '');
  const links = STAFF_LINKS.filter(([, , , role]) => !role || role === user?.role)
    .map(([key, href, label]) => `<a href="${href}"${current(key)}>${label}</a>`)
    .join('');
  const themeButton =
    '<button type="button" class="icon-button" data-theme-toggle aria-label="Switch between light and dark theme" title="Light / dark">&#9680;</button>';
  const header = `<header class="site-header no-print">
  <div class="header-inner">
    <a class="brand" href="${user ? '/admin' : '/'}"><img src="/logo.svg" alt="" width="28" height="28"><span>Item Check-out</span></a>
    ${
      user
        ? `<nav class="nav-links" aria-label="Staff">${links}</nav>
    <div class="nav-user">
      <a class="who" href="/admin/settings"${current('settings')}>${esc(user.name)}<span class="role-tag">${esc(user.role)}</span></a>
      <form method="post" action="/admin/logout"><button class="link-button">Log out</button></form>
      ${themeButton}
    </div>`
        : landing
          ? `<nav class="nav-links" aria-label="Page"><a href="#how">How it works</a><a href="#features">Features</a><a href="#staff">For staff</a></nav>
    <div class="nav-user">${themeButton}<a class="button primary small" href="/admin">Staff login</a></div>`
          : `<div class="nav-user">${themeButton}${staffLink ? '<a class="button secondary small" href="/admin">Staff login</a>' : ''}</div>`
    }
  </div>
</header>`;
  const content = landing
    ? `<main class="page landing">\n${body}\n</main>`
    : `<div class="page"><main class="sheet ${wide ? 'wide' : 'narrow'}">\n${body}\n</main></div>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="color-scheme" content="light dark">
<title>${esc(title)}</title>
<link rel="icon" href="/logo.svg" type="image/svg+xml">
<link rel="stylesheet" href="/style.css">
<script src="/theme.js"></script>
</head>
<body>
${header}
${content}
</body>
</html>`;
}

function errorList(errors) {
  if (!errors || errors.length === 0) return '';
  return `<div class="alert error" role="alert"><ul>${errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>`;
}

// ---------- Student pages ----------

export function homePage() {
  return layout({
    title: 'Item check-out',
    landing: true,
    body: `<section class="sheet hero-split">
  <div class="hero-copy">
    <div class="hero-band"><h1>Check out anything<br><span class="accent">with a scan.</span></h1></div>
    <p class="lede">Scan the QR code on an item with your phone camera, fill in a short form, and it is logged. No app, no login.</p>
    <form method="get" action="/find" class="find-form">
      <label for="code-input">Have a code instead? Type or scan the code printed under the barcode.</label>
      <div class="row">
        <input id="code-input" type="text" name="code" autocomplete="off" autocapitalize="none" maxlength="40" placeholder="e.g. 0b6539c17b7d" required>
        <button class="primary">Find item</button>
      </div>
      <p class="mono">Scanning with a phone? Just point the camera at the QR code.</p>
    </form>
  </div>
  <div class="hero-art">
    <canvas id="ink-canvas" aria-label="Decorative 3D sculpture. Drag to rotate, click to make a new one." role="img"></canvas>
    <span class="corner tl">N 00&deg;</span>
    <span class="corner tr">SCAN &middot; 3D</span>
    <span class="corner bl">Drag to rotate &middot; Click to reforge</span>
    <span class="corner br" id="ink-seed">seed 04211</span>
  </div>
</section>

<section class="sheet section" id="how">
  <div class="section-head">
    <span class="pill">How it works</span>
    <h2>Three steps, <span class="accent">no paperwork.</span></h2>
  </div>
  <div class="steps frame">
    <div class="step"><span class="num">01</span><h3>Scan</h3><p>Point your phone camera at the QR code on the item. The form opens with the item already filled in.</p></div>
    <div class="step"><span class="num">02</span><h3>Fill in</h3><p>Name, ID number, school email and a return date. You get a confirmation right away.</p></div>
    <div class="step"><span class="num">03</span><h3>Return</h3><p>Scan the same code again and tap Return this item. That is all.</p></div>
  </div>
</section>

<section class="sheet section" id="features">
  <div class="section-head">
    <span class="pill">Features</span>
    <h2>Everything you lend, <span class="accent">accounted for.</span></h2>
  </div>
  <div class="bento">
    <div class="bento-card frame">
      <div class="bento-art">
        <svg viewBox="0 0 260 130" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
          <rect x="92" y="14" width="76" height="102" rx="12"/>
          <rect x="106" y="30" width="48" height="48" rx="4"/>
          <path d="M112 36h12v12h-12zM136 36h12v12h-12zM112 60h12v12h-12z"/>
          <path d="M136 62h4v4h-4zM144 66h4v4h-4zM136 70h4v4h-4z" fill="currentColor"/>
          <path d="M112 92h36M118 100h24" stroke-linecap="round"/>
          <path d="M40 40l28 20M220 40l-28 20M40 90l28-20M220 90l-28-20" stroke-dasharray="3 4" opacity=".5"/>
        </svg>
      </div>
      <h3>Scan and done</h3>
      <p>A 30-second form on any phone. The item is identified by the code, so there is nothing to look up.</p>
    </div>
    <div class="bento-card frame">
      <div class="bento-art">
        <div class="mini-list" aria-hidden="true">
          <div class="mini-row"><span>Projector</span><span class="badge returned">Available</span></div>
          <div class="mini-row"><span>Camera</span><span class="badge overdue-soft">Checked out</span></div>
          <div class="mini-row"><span>Speaker</span><span class="badge overdue-soft">Checked out</span></div>
        </div>
      </div>
      <h3>Never double-booked</h3>
      <p>An item that is out shows as unavailable to everyone else, and nothing about who has it.</p>
    </div>
    <div class="bento-card frame">
      <div class="bento-art">
        <div class="mini-list" aria-hidden="true">
          <div class="mini-row late"><span>Tripod &middot; due Mon</span><strong>Overdue</strong></div>
          <div class="mini-row"><span>Table &middot; due Fri</span><span class="badge ontime">On time</span></div>
          <div class="mini-row"><span>Speaker &middot; due Fri</span><span class="badge ontime">On time</span></div>
        </div>
      </div>
      <h3>Overdue at a glance</h3>
      <p>Staff see everything that is out, highlighted when late, with search, filters and CSV export.</p>
    </div>
    <div class="bento-card frame">
      <div class="bento-art">
        <svg viewBox="0 0 260 130" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
          <rect x="50" y="14" width="64" height="64" rx="6"/>
          <path d="M58 22h16v16H58zM90 22h16v16H90zM58 54h16v16H58z"/>
          <path d="M90 54h6v6h-6zM100 62h6v6h-6zM90 70h6v6h-6z" fill="currentColor"/>
          <path d="M138 24v56M143 24v56M150 24v56M156 24v56M163 24v56M168 24v56M176 24v56M182 24v56" stroke-width="2"/>
          <path d="M50 98h132" stroke-linecap="round" opacity=".5"/>
          <path d="M50 108h90" stroke-linecap="round" opacity=".5"/>
        </svg>
      </div>
      <h3>Labels in one click</h3>
      <p>List an item and print its QR code and barcode right away. Teachers see only their own items.</p>
    </div>
  </div>
</section>

<section class="sheet cta" id="staff">
  <h2>Run a lending shelf? <span class="accent">Start in minutes.</span></h2>
  <p>Teachers and administrators log in to list items, print labels, and see what is checked out.</p>
  <div class="row"><a class="button primary" href="/admin">Staff login</a></div>
</section>

<p class="mono site-footer">Item Check-out &middot; for school organizations</p>
<script src="/hero.js" defer></script>`,
  });
}

export function messagePage({ title, message, status = 'info' }) {
  return layout({
    title,
    body: `<div class="card center"><h1>${esc(title)}</h1><p class="alert ${esc(status)}">${esc(message)}</p></div>`,
  });
}

export function checkoutFormPage({ item, values = {}, errors = [], today, now, emailDomain }) {
  return layout({
    title: `Check out: ${item.name}`,
    body: `<h1>Check out an item</h1>
${errorList(errors)}
<form method="post" action="/i/${esc(item.code)}/checkout" class="card" novalidate>
  <label>Item
    <input type="text" value="${esc(item.name)}" readonly>
  </label>
  ${item.description ? `<p class="muted small">${esc(item.description)}</p>` : ''}
  <label>Check-out date and time
    <input type="text" value="${esc(formatDateTime(now))}" readonly>
  </label>
  <label>Full name <span class="required">*</span>
    <input type="text" name="student_name" value="${esc(values.student_name)}" autocomplete="name" maxlength="100" required>
  </label>
  <label>Student ID number (lunch number) <span class="required">*</span>
    <input type="text" name="student_id" value="${esc(values.student_id)}" inputmode="numeric" autocomplete="off" maxlength="20" required>
  </label>
  <label>School email <span class="required">*</span>
    <input type="email" name="email" value="${esc(values.email)}" autocomplete="email" maxlength="254" required
      ${emailDomain ? `placeholder="name@${esc(emailDomain)}"` : ''}>
  </label>
  <label>Phone number <span class="muted">(optional)</span>
    <input type="tel" name="phone" value="${esc(values.phone)}" autocomplete="tel" maxlength="30">
  </label>
  <label>Expected return date <span class="required">*</span>
    <input type="date" name="due_date" value="${esc(values.due_date)}" min="${esc(today)}" required>
  </label>
  <label>Purpose or notes <span class="muted">(optional)</span>
    <textarea name="purpose" rows="3" maxlength="500">${esc(values.purpose)}</textarea>
  </label>
  <button class="primary">Check out</button>
</form>`,
  });
}

// Shown to the student who holds the item (recognised by this phone's cookie).
export function ownCheckoutPage({ item, checkout, justCheckedOut }) {
  const heading = justCheckedOut
    ? `<div class="alert success" role="status"><strong>You're all set!</strong> Your check-out is recorded.</div>`
    : `<div class="alert info">You have this item checked out.</div>`;
  return layout({
    title: justCheckedOut ? 'Check-out confirmed' : `Return: ${item.name}`,
    body: `<div class="card center">
<h1>${esc(item.name)}</h1>
${heading}
<dl class="summary">
  <dt>Checked out</dt><dd>${esc(formatDateTime(checkout.checked_out_at))}</dd>
  <dt>Return by</dt><dd>${esc(formatDate(checkout.due_date))}</dd>
</dl>
<p class="muted">${justCheckedOut ? 'When you bring it back, scan the same code again to return it.' : 'Bringing it back now?'}</p>
<form method="post" action="/i/${esc(item.code)}/return">
  <button class="${justCheckedOut ? 'secondary' : 'primary'}">Return this item</button>
</form>
</div>`,
  });
}

// Shown to everyone else. Shows nothing about who has the item.
export function unavailablePage({ item, errors = [] }) {
  return layout({
    title: `Unavailable: ${item.name}`,
    body: `<div class="card center">
<h1>${esc(item.name)}</h1>
<div class="alert warning" role="status"><strong>Unavailable.</strong> This item is already checked out.</div>
</div>
<details class="card" ${errors.length ? 'open' : ''}>
  <summary>I checked this out. Return this item</summary>
  <p class="muted small">Enter the same student ID (lunch number) and email you used at check-out.</p>
  ${errorList(errors)}
  <form method="post" action="/i/${esc(item.code)}/return" novalidate>
    <label>Student ID number (lunch number)
      <input type="text" name="student_id" inputmode="numeric" autocomplete="off" maxlength="20" required>
    </label>
    <label>School email
      <input type="email" name="email" autocomplete="email" maxlength="254" required>
    </label>
    <button class="primary">Return this item</button>
  </form>
</details>`,
  });
}

export function returnedPage({ item }) {
  return layout({
    title: 'Item returned',
    body: `<div class="card center">
<h1>${esc(item.name)}</h1>
<div class="alert success" role="status"><strong>Returned.</strong> Thank you!</div>
</div>`,
  });
}

// ---------- Admin pages ----------

export function loginPage({ error, email = '', signupOpen = true } = {}) {
  return layout({
    title: 'Staff login',
    staffLink: false,
    body: `<h1>Staff login</h1>
${error ? `<div class="alert error" role="alert">${esc(error)}</div>` : ''}
<form method="post" action="/admin/login" class="card">
  <label>Email
    <input type="email" name="email" value="${esc(email)}" autocomplete="username" maxlength="254" required autofocus>
  </label>
  <label>Password
    <input type="password" name="password" autocomplete="current-password" required>
  </label>
  <button class="primary">Log in</button>
</form>
${signupOpen ? '<p class="center"><a href="/admin/signup">Create an admin or teacher account</a></p>' : ''}`,
  });
}

export function signupPage({ errors = [], values = {} } = {}) {
  return layout({
    title: 'Create a staff account',
    staffLink: false,
    body: `<h1>Create a staff account</h1>
<p class="muted">For administrators and teachers. You need the sign-up code from your organization.</p>
${errorList(errors)}
<form method="post" action="/admin/signup" class="card" novalidate>
  <label>Full name
    <input type="text" name="name" value="${esc(values.name)}" autocomplete="name" maxlength="100" required>
  </label>
  <label>Email
    <input type="email" name="email" value="${esc(values.email)}" autocomplete="username" maxlength="254" required>
  </label>
  <label>Password <span class="muted">(10 characters or more)</span>
    <input type="password" name="password" autocomplete="new-password" minlength="10" maxlength="200" required>
  </label>
  <label>Sign-up code
    <input type="password" name="signup_code" autocomplete="off" maxlength="200" required>
  </label>
  <p class="muted small">The admin code creates an administrator account. The teacher code creates a teacher account.</p>
  <button class="primary">Create account</button>
</form>
<p class="center"><a href="/admin/login">Back to login</a></p>`,
  });
}

export function peoplePage({ user, people, signup }) {
  return layout({
    title: 'People',
    user,
    active: 'people',
    wide: true,
    body: `<h1>People</h1>
<p class="muted">Staff accounts. Admin sign-up is <strong>${signup.admin ? 'open' : 'closed'}</strong>, teacher sign-up is <strong>${signup.teacher ? 'open' : 'closed'}</strong>.
New staff sign up at <code>/admin/signup</code> with the code you give them.</p>
<div class="table-wrap"><table>
<thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Joined</th><th>Status</th><th></th></tr></thead>
<tbody>
${people
  .map(
    (person) => `<tr class="${person.active ? '' : 'row-retired'}">
  <td>${esc(person.name)}</td>
  <td>${esc(person.email)}</td>
  <td>${esc(person.role)}</td>
  <td>${esc(formatDateTime(person.created_at))}</td>
  <td>${person.active ? '<span class="badge ontime">Active</span>' : '<span class="badge returned">Deactivated</span>'}</td>
  <td>${
    person.id === user.id
      ? '<a class="small" href="/admin/settings">Your settings</a>'
      : `<div class="row-actions"><form method="post" action="/admin/people/${person.id}/active">
          <input type="hidden" name="active" value="${person.active ? '0' : '1'}">
          <button class="secondary small">${person.active ? 'Deactivate' : 'Reactivate'}</button>
        </form>
        <a class="danger-link small" href="/admin/people/${person.id}/delete">Delete</a></div>`
  }</td>
</tr>`
  )
  .join('')}
</tbody></table></div>`,
  });
}

function statusBadge(row, today) {
  if (row.returned_at) return '<span class="badge returned">Returned</span>';
  if (row.due_date < today) return '<span class="badge overdue">Overdue</span>';
  return '<span class="badge ontime">On time</span>';
}

function filterForm({ action, q, status, statuses }) {
  return `<form method="get" action="${action}" class="filters no-print">
  <input type="search" name="q" value="${esc(q)}" placeholder="Search student, ID, email or item" aria-label="Search">
  <select name="status" aria-label="Status">
    ${statuses
      .map(([value, label]) => `<option value="${value}" ${status === value ? 'selected' : ''}>${label}</option>`)
      .join('')}
  </select>
  <button class="secondary">Filter</button>
  ${q || status ? `<a href="${action}">Clear</a>` : ''}
</form>`;
}

export function dashboardPage({ user, rows, q, status, today, counts }) {
  const body = rows.length
    ? `<div class="table-wrap"><table>
<thead><tr><th>Item</th><th>Student</th><th>Student ID</th><th>Email</th><th>Checked out</th><th>Due</th><th>Status</th><th class="no-print"></th></tr></thead>
<tbody>
${rows
  .map(
    (row) => `<tr class="${row.due_date < today ? 'row-overdue' : ''}">
  <td>${esc(row.item_name)}</td>
  <td>${esc(row.student_name)}${row.phone ? `<div class="muted small">${esc(row.phone)}</div>` : ''}${row.purpose ? `<div class="muted small">${esc(row.purpose)}</div>` : ''}</td>
  <td>${esc(row.student_id)}</td>
  <td><a href="mailto:${esc(row.email)}">${esc(row.email)}</a></td>
  <td>${esc(formatDateTime(row.checked_out_at))}</td>
  <td>${esc(formatDate(row.due_date))}</td>
  <td>${statusBadge(row, today)}</td>
  <td class="no-print"><form method="post" action="/admin/checkouts/${row.id}/return"><button class="secondary small">Mark returned</button></form></td>
</tr>`
  )
  .join('')}
</tbody></table></div>`
    : `<p class="card empty">${q || status ? 'No check-outs match this search.' : 'Nothing is checked out right now.'}</p>`;

  return layout({
    title: 'Checked-out items',
    user,
    active: 'dashboard',
    wide: true,
    body: `<div class="page-head">
  <h1>Checked-out items</h1>
  <a class="button secondary no-print" href="/admin/export.csv?scope=current">Export CSV</a>
</div>
<div class="stats">
  <div class="stat"><div class="value">${counts.out}</div><div class="label">Checked out</div></div>
  <div class="stat ${counts.overdue ? 'alert-stat' : ''}"><div class="value">${counts.overdue}</div><div class="label">Overdue</div></div>
</div>
${filterForm({
  action: '/admin',
  q,
  status,
  statuses: [['', 'All statuses'], ['ontime', 'On time'], ['overdue', 'Overdue']],
})}
${body}`,
  });
}

export function historyPage({ user, rows, q, status, today }) {
  const body = rows.length
    ? `<div class="table-wrap"><table>
<thead><tr><th>Item</th><th>Student</th><th>Student ID</th><th>Email</th><th>Checked out</th><th>Due</th><th>Returned</th><th>Status</th></tr></thead>
<tbody>
${rows
  .map(
    (row) => `<tr class="${!row.returned_at && row.due_date < today ? 'row-overdue' : ''}">
  <td>${esc(row.item_name)}</td>
  <td>${esc(row.student_name)}</td>
  <td>${esc(row.student_id)}</td>
  <td>${esc(row.email)}</td>
  <td>${esc(formatDateTime(row.checked_out_at))}</td>
  <td>${esc(formatDate(row.due_date))}</td>
  <td>${row.returned_at ? `${esc(formatDateTime(row.returned_at))}<div class="muted small">by ${esc(row.returned_by)}</div>` : ''}</td>
  <td>${statusBadge(row, today)}</td>
</tr>`
  )
  .join('')}
</tbody></table></div>`
    : '<p class="card empty">No check-outs found.</p>';

  return layout({
    title: 'Check-out history',
    user,
    active: 'history',
    wide: true,
    body: `<div class="page-head">
  <h1>Check-out history</h1>
  <a class="button secondary no-print" href="/admin/export.csv?scope=all">Export CSV</a>
</div>
${filterForm({
  action: '/admin/history',
  q,
  status,
  statuses: [['', 'All statuses'], ['ontime', 'On time'], ['overdue', 'Overdue'], ['returned', 'Returned']],
})}
${body}`,
  });
}

function itemFields(values = {}) {
  return `<label>Item name <span class="required">*</span>
    <input type="text" name="name" value="${esc(values.name)}" maxlength="100" required>
  </label>
  <label>Description <span class="muted">(optional)</span>
    <input type="text" name="description" value="${esc(values.description)}" maxlength="200">
  </label>`;
}

export function itemsPage({ user, items, errors = [], values = {} }) {
  return layout({
    title: 'Items',
    user,
    active: 'items',
    wide: true,
    body: `<div class="page-head">
  <h1>Items</h1>
  <a class="button secondary" href="/admin/qr">Print all codes</a>
</div>
<form method="post" action="/admin/items" class="card inline-form">
  <h2>List an item</h2>
  <p class="muted small">A QR code and barcode are made for the item as soon as you add it.</p>
  ${errorList(errors)}
  ${itemFields(values)}
  <button class="primary">Add item and get code</button>
</form>
${
  items.length
    ? `<div class="table-wrap"><table>
<thead><tr><th>Name</th><th>Description</th>${user.role === 'admin' ? '<th>Listed by</th>' : ''}<th>Status</th><th></th></tr></thead>
<tbody>
${items
  .map(
    (item) => `<tr class="${item.active ? '' : 'row-retired'}">
  <td>${esc(item.name)}</td>
  <td>${esc(item.description)}</td>
  ${user.role === 'admin' ? `<td>${esc(item.owner_name ?? 'Organization')}</td>` : ''}
  <td>${
    !item.active
      ? '<span class="badge returned">Retired</span>'
      : item.is_out
        ? '<span class="badge overdue-soft">Checked out</span>'
        : '<span class="badge ontime">Available</span>'
  }</td>
  <td class="actions"><a href="/admin/items/${item.id}/edit">Edit</a> <a href="/admin/qr?item=${item.id}">Code label</a> <a href="/i/${esc(item.code)}">Open form</a> <a class="danger-link" href="/admin/items/${item.id}/delete">Delete</a></td>
</tr>`
  )
  .join('')}
</tbody></table></div>`
    : '<p class="card empty">No items yet. List the first one above.</p>'
}`,
  });
}

export function editItemPage({ user, item, errors = [] }) {
  return layout({
    title: `Edit ${item.name}`,
    user,
    active: 'items',
    body: `<h1>Edit item</h1>
${errorList(errors)}
<form method="post" action="/admin/items/${item.id}" class="card">
  ${itemFields(item)}
  <label class="checkbox">
    <input type="checkbox" name="active" value="1" ${item.active ? 'checked' : ''}>
    Active (uncheck to retire the item; its QR code stops working, its history is kept)
  </label>
  <button class="primary">Save</button>
  <a href="/admin/items">Cancel</a>
</form>`,
  });
}

export function deleteItemPage({ user, item, historyCount }) {
  const records = `${historyCount} check-out record${historyCount === 1 ? '' : 's'}`;
  return layout({
    title: `Delete ${item.name}`,
    user,
    active: 'items',
    body: `<h1>Delete item</h1>
<div class="card">
  <p><strong>${esc(item.name)}</strong>${item.description ? `<br><span class="muted">${esc(item.description)}</span>` : ''}</p>
  ${
    item.is_out
      ? `<div class="alert warning" role="alert"><strong>This item is checked out.</strong> Mark it returned on the dashboard before deleting it.</div>
  <a class="button secondary" href="/admin">Go to dashboard</a>`
      : `<div class="alert error" role="alert"><strong>This cannot be undone.</strong> The item, its QR code and barcode, and its ${records} are deleted for good.</div>
  <p class="muted small">To keep the history, cancel and retire the item instead: <a href="/admin/items/${item.id}/edit">Edit</a>, then uncheck Active. To keep a copy of the records, export the CSV from History first.</p>
  <form method="post" action="/admin/items/${item.id}/delete">
    <button class="danger">Delete item for good</button>
  </form>`
  }
  <p><a href="/admin/items">Cancel</a></p>
</div>`,
  });
}

export function qrSheetPage({ user, labels, baseUrl, single, justListed }) {
  const localWarning = /\/\/(localhost|127\.0\.0\.1)/.test(baseUrl)
    ? `<div class="alert warning no-print">These codes point to <strong>${esc(baseUrl)}</strong>, which only works on this computer. Set <code>BASE_URL</code> in <code>.env</code> to an address phones can reach before printing.</div>`
    : '';
  return layout({
    title: 'Item codes',
    user,
    active: 'codes',
    wide: true,
    body: `<div class="page-head no-print">
  <h1>${single ? 'Item code' : 'Item codes'}</h1>
  <div>
    ${single ? '<a class="button secondary" href="/admin/qr">All items</a>' : ''}
    <button class="primary" id="print-button">Print</button>
  </div>
</div>
${justListed ? '<div class="alert success no-print" role="status"><strong>Item listed.</strong> Print this label and attach it to the item.</div>' : ''}
${localWarning}
<p class="muted small no-print">Phones scan the QR code. Handheld barcode scanners read the barcode; type or scan it into the box on the home page.</p>
${
  labels.length
    ? `<div class="qr-sheet">
${labels
  .map(
    (label) => `<div class="qr-label">
  ${label.svg}
  <div class="qr-name">${esc(label.name)}</div>
  <div class="qr-hint">Scan to check out or return</div>
  <div class="barcode">${label.barcode}</div>
</div>`
  )
  .join('')}
</div>
<script src="/print.js"></script>`
    : '<p class="card empty">No active items. List an item first.</p>'
}`,
  });
}

// ---------- Account pages ----------

export function settingsPage({ user, notice = '', errors = {}, values = {} }) {
  const notices = { name: 'Your name was updated.', password: 'Your password was changed.' };
  return layout({
    title: 'Settings',
    user,
    active: 'settings',
    body: `<div class="page-head"><div><h1>Settings</h1><p class="page-sub">Manage your own account.</p></div></div>
${notices[notice] ? `<div class="alert success" role="status">${notices[notice]}</div>` : ''}
<section class="card inline-form">
  <h2>Profile</h2>
  ${errorList(errors.name)}
  <form method="post" action="/admin/settings/name">
    <label>Full name
      <input type="text" name="name" value="${esc(values.name ?? user.name)}" autocomplete="name" maxlength="100" required>
    </label>
    <label>Email
      <input type="email" value="${esc(user.email)}" readonly>
    </label>
    <label>Role
      <input type="text" value="${esc(user.role)}" readonly>
    </label>
    <button class="primary">Save name</button>
  </form>
</section>
<section class="card inline-form">
  <h2>Change password</h2>
  ${errorList(errors.password)}
  <form method="post" action="/admin/settings/password">
    <label>Current password
      <input type="password" name="current_password" autocomplete="current-password" required>
    </label>
    <label>New password <span class="muted">(10 characters or more)</span>
      <input type="password" name="new_password" autocomplete="new-password" minlength="10" maxlength="200" required>
    </label>
    <label>Confirm new password
      <input type="password" name="confirm_password" autocomplete="new-password" minlength="10" maxlength="200" required>
    </label>
    <button class="primary">Change password</button>
  </form>
</section>
<section class="card inline-form danger-zone">
  <h2>Delete my account</h2>
  <p class="muted">Your login is removed for good. Items you listed stay and become organization items, and all check-out history is kept.</p>
  <a class="button secondary" href="/admin/settings/delete">Delete my account&hellip;</a>
</section>`,
  });
}

export function deleteAccountPage({ user, errors = [], lastAdmin = false }) {
  return layout({
    title: 'Delete my account',
    user,
    active: 'settings',
    body: `<h1>Delete my account</h1>
<div class="card">
  ${
    lastAdmin
      ? `<div class="alert warning" role="alert"><strong>You are the only admin.</strong> Make someone else an admin first: they sign up with the admin code, then you can delete your account.</div>`
      : `<div class="alert error" role="alert"><strong>This cannot be undone.</strong> Your account (${esc(user.email)}) is deleted and you are logged out. Items you listed stay and become organization items. Check-out history is kept.</div>
  ${errorList(errors)}
  <form method="post" action="/admin/settings/delete">
    <label>Enter your password to confirm
      <input type="password" name="password" autocomplete="current-password" required>
    </label>
    <button class="danger block">Delete my account for good</button>
  </form>`
  }
  <p><a href="/admin/settings">Cancel</a></p>
</div>`,
  });
}

export function deletePersonPage({ user, person, itemCount }) {
  return layout({
    title: `Delete ${person.name}`,
    user,
    active: 'people',
    body: `<h1>Delete account</h1>
<div class="card">
  <p><strong>${esc(person.name)}</strong><br><span class="muted">${esc(person.email)} &middot; ${esc(person.role)}</span></p>
  <div class="alert error" role="alert"><strong>This cannot be undone.</strong> The account is deleted and can no longer log in. Their ${itemCount} item${itemCount === 1 ? '' : 's'} stay and become organization items. Check-out history is kept.</div>
  <p class="muted small">To block a login but keep the account, cancel and use <strong>Deactivate</strong> instead.</p>
  <form method="post" action="/admin/people/${person.id}/delete">
    <button class="danger block">Delete account for good</button>
  </form>
  <p><a href="/admin/people">Cancel</a></p>
</div>`,
  });
}
