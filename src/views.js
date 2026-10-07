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

function layout({ title, body, admin = false, wide = false }) {
  const nav = admin
    ? `<nav class="admin-nav no-print">
        <a href="/admin">Checked out</a>
        <a href="/admin/history">History</a>
        <a href="/admin/items">Items</a>
        <a href="/admin/qr">QR codes</a>
        <form method="post" action="/admin/logout"><button class="link-button">Log out</button></form>
      </nav>`
    : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)}</title>
<link rel="stylesheet" href="/style.css">
</head>
<body>
${nav}
<main class="${wide ? 'wide' : 'narrow'}">
${body}
</main>
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
    body: `<h1>Item check-out</h1>
<p>Scan the QR code on an item to check it out or return it.</p>
<p class="muted small"><a href="/admin">Administrator login</a></p>`,
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
  <label>Student ID number <span class="required">*</span>
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
  <p class="muted small">Enter the same student ID and email you used at check-out.</p>
  ${errorList(errors)}
  <form method="post" action="/i/${esc(item.code)}/return" novalidate>
    <label>Student ID number
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

export function loginPage({ error } = {}) {
  return layout({
    title: 'Administrator login',
    body: `<h1>Administrator login</h1>
${error ? `<div class="alert error" role="alert">${esc(error)}</div>` : ''}
<form method="post" action="/admin/login" class="card">
  <label>Password
    <input type="password" name="password" autocomplete="current-password" required autofocus>
  </label>
  <button class="primary">Log in</button>
</form>`,
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

export function dashboardPage({ rows, q, status, today, counts }) {
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
    : `<p class="card muted">${q || status ? 'No check-outs match this search.' : 'Nothing is checked out right now.'}</p>`;

  return layout({
    title: 'Checked-out items',
    admin: true,
    wide: true,
    body: `<div class="page-head">
  <h1>Checked-out items</h1>
  <a class="button secondary no-print" href="/admin/export.csv?scope=current">Export CSV</a>
</div>
<p class="muted">${counts.out} checked out, <span class="${counts.overdue ? 'text-overdue' : ''}">${counts.overdue} overdue</span></p>
${filterForm({
  action: '/admin',
  q,
  status,
  statuses: [['', 'All statuses'], ['ontime', 'On time'], ['overdue', 'Overdue']],
})}
${body}`,
  });
}

export function historyPage({ rows, q, status, today }) {
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
    : '<p class="card muted">No check-outs found.</p>';

  return layout({
    title: 'Check-out history',
    admin: true,
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

export function itemsPage({ items, errors = [], values = {} }) {
  return layout({
    title: 'Items',
    admin: true,
    wide: true,
    body: `<div class="page-head">
  <h1>Items</h1>
  <a class="button secondary" href="/admin/qr">Print all QR codes</a>
</div>
<form method="post" action="/admin/items" class="card inline-form">
  <h2>Add an item</h2>
  ${errorList(errors)}
  ${itemFields(values)}
  <button class="primary">Add item</button>
</form>
${
  items.length
    ? `<div class="table-wrap"><table>
<thead><tr><th>Name</th><th>Description</th><th>Status</th><th></th></tr></thead>
<tbody>
${items
  .map(
    (item) => `<tr class="${item.active ? '' : 'row-retired'}">
  <td>${esc(item.name)}</td>
  <td>${esc(item.description)}</td>
  <td>${
    !item.active
      ? '<span class="badge returned">Retired</span>'
      : item.is_out
        ? '<span class="badge overdue-soft">Checked out</span>'
        : '<span class="badge ontime">Available</span>'
  }</td>
  <td class="actions"><a href="/admin/items/${item.id}/edit">Edit</a> <a href="/admin/qr?item=${item.id}">QR code</a> <a href="/i/${esc(item.code)}">Open form</a></td>
</tr>`
  )
  .join('')}
</tbody></table></div>`
    : '<p class="card muted">No items yet. Add the first one above.</p>'
}`,
  });
}

export function editItemPage({ item, errors = [] }) {
  return layout({
    title: `Edit ${item.name}`,
    admin: true,
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

export function qrSheetPage({ labels, baseUrl, single }) {
  const localWarning = /\/\/(localhost|127\.0\.0\.1)/.test(baseUrl)
    ? `<div class="alert warning no-print">These codes point to <strong>${esc(baseUrl)}</strong>, which only works on this computer. Set <code>BASE_URL</code> in <code>.env</code> to an address phones can reach before printing.</div>`
    : '';
  return layout({
    title: 'QR codes',
    admin: true,
    wide: true,
    body: `<div class="page-head no-print">
  <h1>${single ? 'QR code' : 'QR codes'}</h1>
  <div>
    ${single ? '<a class="button secondary" href="/admin/qr">All items</a>' : ''}
    <button class="primary" id="print-button">Print</button>
  </div>
</div>
${localWarning}
${
  labels.length
    ? `<div class="qr-sheet">
${labels
  .map(
    (label) => `<div class="qr-label">
  ${label.svg}
  <div class="qr-name">${esc(label.name)}</div>
  <div class="qr-hint">Scan to check out or return</div>
</div>`
  )
  .join('')}
</div>
<script src="/print.js"></script>`
    : '<p class="card muted">No active items. Add items first.</p>'
}`,
  });
}
