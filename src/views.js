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

const OWNER_LINKS = [
  ['schools', '/owner', 'Schools'],
  ['demos', '/owner/demos', 'Demo requests'],
  ['accounts', '/owner/accounts', 'Find account'],
];

function layout({ title, body, user = null, owner = false, active = '', wide = false, landing = false }) {
  const current = (key) => (active === key ? ' aria-current="page"' : '');
  const links = STAFF_LINKS.filter(([, , , role]) => !role || role === user?.role)
    .map(([key, href, label]) => `<a href="${href}"${current(key)}>${label}</a>`)
    .join('');
  const themeButton =
    '<button type="button" class="icon-button" data-theme-toggle aria-label="Switch between light and dark theme" title="Light / dark">&#9680;</button>';
  const header = `<header class="site-header no-print">
  <div class="header-inner">
    <a class="brand" href="${owner ? '/owner' : user ? '/admin' : '/'}"><img src="/logo.svg" alt="" width="28" height="28"><span>Item Check-out</span></a>
    ${
      owner
        ? `<nav class="nav-links" aria-label="Owner">${OWNER_LINKS.map(([key, href, label]) => `<a href="${href}"${current(key)}>${label}</a>`).join('')}</nav>
    <div class="nav-user">
      <span class="role-tag">owner</span>
      <form method="post" action="/owner/logout"><button class="link-button">Log out</button></form>
      ${themeButton}
    </div>`
        : user
        ? `<nav class="nav-links" aria-label="Staff">${links}</nav>
    <div class="nav-user">
      <a class="who" href="/admin/settings"${current('settings')}>${esc(user.name)}<span class="role-tag">${esc(user.role)}</span></a>
      <form method="post" action="/admin/logout"><button class="link-button">Log out</button></form>
      ${themeButton}
    </div>`
        : landing
          ? `<nav class="nav-links" aria-label="Page"><a href="#compare">Compare</a><a href="#how">How it works</a><a href="#features">Features</a><a href="#demo">For schools</a></nav>
    <div class="nav-user">${themeButton}<a class="button secondary small" href="/admin">Staff login</a><a class="button primary small" href="#demo">Request a demo</a></div>`
          : `<div class="nav-user">${themeButton}</div>`
    }
  </div>
</header>`;
  const content = landing
    ? `<main class="page landing">\n${body}\n</main>`
    : `<div class="page"><main class="sheet ${wide ? 'wide' : 'narrow'}">\n${user ? `<p class="mono school-line staff-school">${esc(user.school_name)}</p>\n` : ''}${body}\n</main></div>`;
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
${landing ? '' : '<footer class="site-footer no-print"><a href="/privacy">Privacy and terms</a></footer>'}
</body>
</html>`;
}

const schoolTag = (item) => (item.school_name ? `<p class="mono school-line">${esc(item.school_name)}</p>` : '');

function errorList(errors) {
  if (!errors || errors.length === 0) return '';
  return `<div class="alert error" role="alert"><ul>${errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>`;
}

// ---------- Student pages ----------

function demoForm({ values = {}, errors = [] } = {}) {
  return `${errorList(errors)}
<form method="post" action="/demo" class="demo-form" novalidate>
  <div class="hp" aria-hidden="true"><label>Leave this empty <input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>
  <div class="two-col">
    <label>Your name <span class="required">*</span>
      <input type="text" name="name" value="${esc(values.name)}" autocomplete="name" maxlength="100" required>
    </label>
    <label>Work email <span class="required">*</span>
      <input type="email" name="email" value="${esc(values.email)}" autocomplete="email" maxlength="254" required>
    </label>
  </div>
  <div class="two-col">
    <label>School or organization <span class="required">*</span>
      <input type="text" name="school" value="${esc(values.school)}" autocomplete="organization" maxlength="150" required>
    </label>
    <label>Your role <span class="muted">(optional)</span>
      <input type="text" name="role" value="${esc(values.role)}" maxlength="100" placeholder="Teacher, librarian, IT&hellip;">
    </label>
  </div>
  <label>What would you like to lend out? <span class="muted">(optional)</span>
    <textarea name="message" rows="3" maxlength="1000">${esc(values.message)}</textarea>
  </label>
  <button class="primary">Request a demo</button>
</form>`;
}

export function homePage({ demoSent = false, demo = {} } = {}) {
  return layout({
    title: 'Item check-out',
    landing: true,
    body: `<section class="sheet hero-split">
  <div class="hero-copy">
    <div class="hero-band"><h1>Check out anything<br><span class="accent">with a scan.</span></h1></div>
    <p class="lede">Scan the QR code on an item with your phone camera, fill in a short form, and it is logged. No app, no login.</p>
    <div class="hero-actions"><a class="button primary" href="/scan">Scan an item</a></div>
    <form method="get" action="/find" class="find-form">
      <label for="code-input">Or type the code printed under the barcode.</label>
      <div class="row">
        <input id="code-input" type="text" name="code" autocomplete="off" autocapitalize="none" maxlength="40" placeholder="e.g. 0b6539c17b7d" required>
        <button class="secondary">Find item</button>
      </div>
    </form>
  </div>
  <div class="hero-art">
    <canvas id="ink-canvas" aria-label="Your organization, shown as a 3D sculpture. Drag to rotate, click to make a new one." role="img"></canvas>
    <span class="corner tl">N 00&deg;</span>
    <span class="corner tr">SCAN &middot; 3D</span>
    <span class="corner bl">Drag your organization &middot; Click to reforge</span>
    <span class="corner br" id="ink-seed">seed 04211</span>
  </div>
</section>

<section class="story" id="compare">
  <div class="sheet section">
    <div class="section-head">
      <span class="pill">Side by side</span>
      <h2>That is theirs. <span class="accent">Ours is here, here and here.</span></h2>
    </div>
    <div class="theirs-row">
      <div class="theirs-card">
        <span class="mono">THIS IS THEIRS</span>
        <h3>The paper sign-out sheet</h3>
        <ul class="cross">
          <li>Nobody knows who has it until someone checks the clipboard.</li>
          <li>Handwriting you cannot read. Rows nobody filled in.</li>
          <li>Late items are found by accident.</li>
        </ul>
      </div>
      <div class="theirs-card">
        <span class="mono">AND THAT IS THEIRS</span>
        <h3>The shared spreadsheet</h3>
        <ul class="cross">
          <li>Someone has to type every row, every time.</li>
          <li>Two people can take the same item at once.</li>
          <li>Everyone who can open it sees every student.</li>
        </ul>
      </div>
    </div>
  </div>
  <div class="story-track">
    <div class="story-stage">
      <div class="dg-wrap frame">
        <span class="mono">OURS &middot; scroll to watch it land</span>
        <div class="dg" id="diagram">
          <canvas id="dg-canvas" role="img" aria-label="A three-dimensional diagram: items, a record of who has each one and a dashboard, all connected to your organization"></canvas>
          <span class="dg-tag dg-title" data-after="orb" data-x="3.5" data-y="3.5" data-z="178">Your organization</span>
          <span class="dg-tag" data-after="left" data-x="0.3" data-y="6.3" data-z="0">Items</span>
          <span class="dg-tag" data-after="right" data-x="6.3" data-y="0.3" data-z="0">Items</span>
          <span class="dg-tag" data-after="front" data-x="3.4" data-y="6.9" data-z="0">Items</span>
          <span class="dg-tag" data-after="slab" data-x="6.9" data-y="4.6" data-z="0">Dashboard</span>
          <span class="dg-pin" data-after="right" data-x="5.3" data-y="1.3" data-z="78">1</span>
          <span class="dg-pin" data-after="pad" data-x="2.2" data-y="4.0" data-z="38">2</span>
          <span class="dg-pin" data-after="slab" data-x="5.9" data-y="4.35" data-z="40">3</span>
        </div>
      </div>
      <div class="story-copy">
        <div class="story-bar" aria-hidden="true"><span></span></div>
        <ol class="callouts">
          <li><strong>Here:</strong> a QR label on the item. Scan it and the form opens, with no app.</li>
          <li><strong>And here:</strong> every check-out records the student's name, ID and email, so you always know who has what.</li>
          <li><strong>And here:</strong> one dashboard shows what is out and what is late. Each school sees only its own.</li>
        </ol>
      </div>
    </div>
  </div>
</section>

<section class="sheet section" id="how">
  <div class="section-head">
    <span class="pill">How it works</span>
    <h2>Three steps, <span class="accent">no paperwork.</span></h2>
  </div>
  <div class="steps frame">
    <div class="step"><span class="num">01</span><h3>Scan</h3><p>Point your phone camera at the QR code on the item. The form opens with the item already filled in.</p></div>
    <div class="step"><span class="num">02</span><h3>Fill in</h3><p>Your name, ID number, school email and a return date. You get a confirmation right away.</p></div>
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
        <svg viewBox="0 0 260 130" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
          <rect x="62" y="26" width="136" height="78" rx="10"/>
          <circle cx="102" cy="58" r="12"/>
          <path d="M82 90c2-14 12-20 20-20s18 6 20 20" stroke-linecap="round"/>
          <path d="M138 52h42M138 64h42M138 76h26" stroke-linecap="round" opacity=".6"/>
        </svg>
      </div>
      <h3>Every check-out has a name</h3>
      <p>Each check-out records the student's name, ID and email, so staff always see who has what.</p>
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
      <p>Staff see everything that is out, highlighted when late, with search, CSV export and printable QR labels.</p>
    </div>
  </div>
</section>

<section class="sheet section" id="demo">
  <div class="section-head">
    <span class="pill">For schools</span>
    <h2>Want this at your school? <span class="accent">Ask for a demo.</span></h2>
    <p class="muted demo-note">Each school is set up by us personally. Send a request and we will email you to arrange a walkthrough. Staff accounts are created after that.</p>
  </div>
  <div class="demo-card frame">
    ${
      demoSent
        ? '<div class="alert success" role="status"><strong>Request received.</strong> Thank you. We will email you personally soon.</div>'
        : demoForm(demo)
    }
  </div>
</section>

<section class="sheet cta" id="staff">
  <h2>Already set up? <span class="accent">Staff, log in.</span></h2>
  <p>Teachers list their items and print labels. Administrators see everything in circulation at their school.</p>
  <div class="row"><a class="button primary" href="/admin">Staff login</a></div>
</section>

<p class="mono site-footer">Item Check-out &middot; for school organizations &middot; <a href="/privacy">Privacy and terms</a></p>
<script src="/hero.js" defer></script>
<script src="/diagram.js" defer></script>`,
  });
}

export function messagePage({ title, message, status = 'info' }) {
  return layout({
    title,
    body: `<div class="card center"><h1>${esc(title)}</h1><p class="alert ${esc(status)}">${esc(message)}</p></div>`,
  });
}

export function checkoutFormPage({ item, values = {}, errors = [], today, now }) {
  const emailDomain = item.school_email_domain;
  return layout({
    title: `Check out: ${item.name}`,
    body: `<h1>Check out an item</h1>
${errorList(errors)}
<form method="post" action="/i/${esc(item.code)}/checkout" class="card" novalidate>
  ${schoolTag(item)}
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
  <p class="muted small">By checking out you agree to the <a href="/privacy">privacy and terms</a>.</p>
  <button class="primary">Check out</button>
</form>`,
  });
}

// Shown to the student who holds the item (recognised by this phone's cookie).
export function ownCheckoutPage({ item, checkout, justCheckedOut, today, extended = false, maxExtension = '', extensionError = '' }) {
  const late = !justCheckedOut && today && checkout.due_date < today;
  const heading = late
    ? `<div class="alert error" role="alert"><strong>This is late.</strong> It was due ${esc(formatDate(checkout.due_date))}. Please return it as soon as you can.</div>`
    : justCheckedOut
      ? `<div class="alert success" role="status"><strong>You're all set!</strong> Your check-out is recorded.</div>`
      : `<div class="alert info">You have this item checked out.</div>`;
  return layout({
    title: justCheckedOut ? 'Check-out confirmed' : `Return: ${item.name}`,
    body: `<div class="card center">
<h1>${esc(item.name)}</h1>
${schoolTag(item)}
${heading}
<dl class="summary">
  <dt>Checked out</dt><dd>${esc(formatDateTime(checkout.checked_out_at))}</dd>
  <dt>Return by</dt><dd>${esc(formatDate(checkout.due_date))}</dd>
</dl>
${extended ? '<div class="alert success" role="status"><strong>Return date extended.</strong> Thank you for letting us know.</div>' : ''}
<p class="muted">${justCheckedOut ? 'When you bring it back, scan the same code again to return it.' : 'Bringing it back now?'}</p>
<form method="post" action="/i/${esc(item.code)}/return" class="left">
  <label>Anything we should know? <span class="muted">(optional: damage, missing parts)</span>
    <textarea name="return_notes" rows="2" maxlength="300"></textarea>
  </label>
  <button class="${justCheckedOut || late ? 'secondary' : 'primary'}">Return this item</button>
</form>
</div>
${
  checkout.extended
    ? ''
    : `<details class="card" ${extensionError ? 'open' : ''}>
  <summary>I need more time</summary>
  <p class="muted small">You can move the return date once, by up to 7 days.</p>
  ${extensionError ? `<div class="alert error" role="alert">${esc(extensionError)}</div>` : ''}
  <form method="post" action="/i/${esc(item.code)}/extend">
    <label>New return date
      <input type="date" name="due_date" min="${esc(checkout.due_date)}" max="${esc(maxExtension)}" required>
    </label>
    <button class="secondary">Extend</button>
  </form>
</details>`
}`,
  });
}

// Shown to everyone else. Shows nothing about who has the item.
export function unavailablePage({ item, errors = [] }) {
  return layout({
    title: `Unavailable: ${item.name}`,
    body: `<div class="card center">
<h1>${esc(item.name)}</h1>
${schoolTag(item)}
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
    <label>Anything we should know? <span class="muted">(optional: damage, missing parts)</span>
      <textarea name="return_notes" rows="2" maxlength="300"></textarea>
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
    body: `<h1>Create a staff account</h1>
<p class="muted">For administrators and teachers. You need the sign-up code from your school. It decides which school you join.</p>
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
  <p class="muted small">Your school's admin code makes an administrator account. Its teacher code makes a teacher account. By creating an account you agree to the <a href="/privacy">privacy and terms</a>.</p>
  <button class="primary">Create account</button>
</form>
<p class="center"><a href="/admin/login">Back to login</a></p>`,
  });
}

export function peoplePage({ user, people, school }) {
  return layout({
    title: 'People',
    user,
    active: 'people',
    wide: true,
    body: `<h1>People</h1>
<p class="page-sub">Staff accounts at ${esc(school.name)}. Only your school's staff are listed.</p>
<section class="card">
  <h2>Sign-up codes</h2>
  <p class="muted small">Staff join your school at <code>/admin/signup</code> with one of these codes. Give the teacher code to teachers. Keep the admin code to yourself: an administrator sees every item and student record in the school.</p>
  <dl class="codes">
    <dt>Admin code</dt><dd>${school.admin_code ? `<code>${esc(school.admin_code)}</code>` : '<span class="muted">closed</span>'}</dd>
    <dt>Teacher code</dt><dd>${school.teacher_code ? `<code>${esc(school.teacher_code)}</code>` : '<span class="muted">closed</span>'}</dd>
  </dl>
</section>
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
        <form method="post" action="/admin/people/${person.id}/reset-password"><button class="link-button small">Reset password</button></form>
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

// A ready-written email that opens in the staff member's own mail app. No email service is involved.
function reminderLink(row, user) {
  const first = String(row.student_name).trim().split(/\s+/)[0] || 'there';
  const subject = `Reminder: ${row.item_name} was due ${formatDate(row.due_date)}`;
  const body = [
    `Hi ${first},`,
    '',
    `This is a reminder that "${row.item_name}" was due back on ${formatDate(row.due_date)}. Please return it as soon as you can. You can scan its code again, or open My items on the site.`,
    '',
    'Thank you,',
    user.name,
    user.school_name,
  ].join('\n');
  return `mailto:${encodeURIComponent(row.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

// One email to everyone who is late, with the addresses hidden from each other (Bcc).
function reminderAllLink(rows, user, today) {
  const late = rows.filter((row) => row.due_date < today);
  const emails = [...new Set(late.map((row) => row.email))];
  if (emails.length === 0) return null;
  const subject = 'Reminder: items past their return date';
  const body = [
    'Hi,',
    '',
    'This is a reminder that an item you checked out is past its return date. Please return it as soon as you can. Open My items on the site to see what you have out.',
    '',
    'Thank you,',
    user.name,
    user.school_name,
  ].join('\n');
  return `mailto:?bcc=${emails.map(encodeURIComponent).join(',')}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function dashboardPage({ user, rows, q, status, today, counts }) {
  const allLink = reminderAllLink(rows, user, today);
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
  <td>${esc(formatDate(row.due_date))}${row.original_due_date ? `<div class="muted small">was ${esc(formatDate(row.original_due_date))}</div>` : ''}</td>
  <td>${statusBadge(row, today)}</td>
  <td class="no-print"><div class="row-actions"><form method="post" action="/admin/checkouts/${row.id}/return" class="inline-return"><input type="text" name="return_notes" maxlength="300" placeholder="Note (optional)" aria-label="Return note"><button class="secondary small">Mark returned</button></form>
    <details class="due-edit"><summary class="small">Change date</summary>
      <form method="post" action="/admin/checkouts/${row.id}/due"><input type="date" name="due_date" value="${esc(row.due_date)}" required><button class="secondary small">Save</button></form>
    </details>${
      row.due_date < today
        ? `<a class="button secondary small" href="${esc(reminderLink(row, user))}" title="Opens your email app with a message ready to send">Email reminder</a>`
        : ''
    }</div></td>
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
  <div class="actions-row no-print">
    ${
      allLink && allLink.length < 1900
        ? `<a class="button secondary" href="${esc(allLink)}" title="Opens your email app with one message to everyone who is late">Email everyone late</a>`
        : ''
    }
    <a class="button secondary" href="/admin/export.csv?scope=current">Export CSV</a>
  </div>
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
<thead><tr><th>Item</th><th>Student</th><th>Student ID</th><th>Email</th><th>Checked out</th><th>Due</th><th>Returned</th><th>Return notes</th><th>Status</th></tr></thead>
<tbody>
${rows
  .map(
    (row) => `<tr class="${!row.returned_at && row.due_date < today ? 'row-overdue' : ''}">
  <td>${esc(row.item_name)}</td>
  <td>${esc(row.student_name)}</td>
  <td>${esc(row.student_id)}</td>
  <td>${esc(row.email)}</td>
  <td>${esc(formatDateTime(row.checked_out_at))}</td>
  <td>${esc(formatDate(row.due_date))}${row.original_due_date ? `<div class="muted small">was ${esc(formatDate(row.original_due_date))}</div>` : ''}</td>
  <td>${row.returned_at ? `${esc(formatDateTime(row.returned_at))}<div class="muted small">by ${esc(row.returned_by)}</div>` : ''}</td>
  <td>${row.return_notes ? `<span class="badge overdue-soft">Note</span> ${esc(row.return_notes)}` : ''}</td>
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

// ---------- Password reset (no email) ----------

export function tempPasswordPage({ user = null, owner = false, person, temporary, back, backLabel }) {
  return layout({
    title: 'Temporary password',
    user,
    owner,
    wide: false,
    body: `<h1>Temporary password</h1>
<div class="card">
  <p>New password for <strong>${esc(person.name)}</strong> (${esc(person.email)}):</p>
  <p class="temp-password"><code>${esc(temporary)}</code></p>
  <div class="alert warning" role="alert"><strong>This is shown only once.</strong> Give it to ${esc(person.name)} in person or by a message only they can read. Every device they were logged in on is logged out, and they must choose their own password at the next login.</div>
  <a class="button secondary" href="${esc(back)}">Back to ${esc(backLabel)}</a>
</div>`,
  });
}

export function newPasswordPage({ user, action, minLength, errors = [] }) {
  return layout({
    title: 'Choose a new password',
    user,
    body: `<h1>Choose a new password</h1>
<p class="page-sub">You signed in with a temporary password. Choose your own to continue.</p>
${errorList(errors)}
<form method="post" action="${esc(action)}" class="card">
  <label>New password <span class="muted">(${minLength} characters or more)</span>
    <input type="password" name="password" autocomplete="new-password" minlength="${minLength}" maxlength="200" required autofocus>
  </label>
  <label>Confirm new password
    <input type="password" name="confirm_password" autocomplete="new-password" minlength="${minLength}" maxlength="200" required>
  </label>
  <button class="primary">Save password</button>
</form>`,
  });
}

// ---------- Privacy and terms ----------

export function privacyPage({ user = null } = {}) {
  return layout({
    title: 'Privacy and terms',
    user,
    body: `<h1>Privacy and terms</h1>
<p class="page-sub">Last updated October 8, 2026. Plain language, no tricks.</p>

<section class="card prose">
  <h2>What this is</h2>
  <p>Item Check-out is a tool that school organizations use to lend out items: cameras, tables, speakers, anything with a QR code on it. Each school decides who may use it and is responsible for its own students' records.</p>
</section>

<section class="card prose">
  <h2>What we collect</h2>
  <h3>Students</h3>
  <ul>
    <li>When you check something out: your name, student ID or lunch number, and school email.</li>
    <li>A phone number, only if you choose to give one.</li>
    <li>What you check out and return, when, the return date you chose, and any notes you wrote.</li>
    <li>You do not make an account and you do not have a password.</li>
  </ul>
  <h3>Teachers and administrators</h3>
  <ul>
    <li>Your name, email, role, school, and a scrambled version of your password.</li>
    <li>The items you list.</li>
  </ul>
  <h3>Schools that ask for a demo</h3>
  <ul>
    <li>The name, email, school, role and message you type into the demo form. They are emailed to the person who runs the site and saved so the request is not lost.</li>
  </ul>
  <p>We do not collect payment details, your location, or anything from your device beyond what a website normally receives. There are no ads, no analytics, no tracking, and no third-party scripts on these pages.</p>
</section>

<section class="card prose">
  <h2>Who can see it</h2>
  <ul>
    <li><strong>Only staff at the school that owns the item.</strong> An administrator of that school sees every check-out of that school's items. A teacher sees only the check-outs of the items they listed.</li>
    <li><strong>Other schools never see it.</strong> Staff at one school cannot see another school's items, staff, check-outs or students.</li>
    <li>Other students never see who has an item. They only see that it is unavailable. To return something you need the phone you checked it out on, or the same student ID and email.</li>
    <li>The person who runs the site can access the database in order to run the service, for example to create schools or help with a lost password.</li>
    <li>The service runs on hosting and database providers, who store the data for us. We do not sell your data and we do not share it for advertising.</li>
  </ul>
</section>

<section class="card prose">
  <h2>Cookies and storage</h2>
  <p>Teachers and administrators get a login cookie that lasts 8 hours and ends when they log out or change their password. When a student checks something out, a small cookie is saved on that phone for up to 180 days so it can offer "Return this item" for that one item. Your light or dark choice is saved in your browser. Nothing else is stored.</p>
</section>

<section class="card prose">
  <h2>Keeping and deleting records</h2>
  <ul>
    <li>Records are kept while your school uses the service, so that staff can see what is out and what was returned.</li>
    <li>Teachers and administrators can delete their own account in Settings. Check-out history is kept by the school.</li>
    <li>To have your details erased from past check-outs, ask your school's administrator, who can ask the person who runs the site. Your check-outs then stay as anonymous history, with no name, ID, email or phone.</li>
  </ul>
</section>

<section class="card prose">
  <h2>Students under 13</h2>
  <p>Schools that use this service are responsible for getting any permission the law requires, such as parent or school consent for students under 13, before students use the service. We collect only what is listed above, and only to run the lending service.</p>
</section>

<section class="card prose">
  <h2>Terms of use</h2>
  <ul>
    <li>Use the service to borrow and return items that belong to your school or organization.</li>
    <li>Give true details, and do not use anyone else's account. Keep your password to yourself.</li>
    <li>Items stay the property of the school. Return them by the date you chose, and tell a teacher about any damage.</li>
    <li>Staff must use student information only to run lending, and must not share it.</li>
    <li>The service is provided as it is, and may change or have downtime. It is not a substitute for a school's own safety or insurance rules.</li>
    <li>Misuse can lead to an account being deactivated.</li>
  </ul>
</section>

<section class="card prose">
  <h2>Questions</h2>
  <p>Ask your school's administrator. Schools that want to use the service can <a href="/#demo">request a demo</a>.</p>
</section>`,
  });
}

// ---------- Owner ----------

export function ownerLoginPage({ error } = {}) {
  return layout({
    title: 'Owner login',
    body: `<h1>Owner login</h1>
<p class="page-sub">For the person who runs the site.</p>
${error ? `<div class="alert error" role="alert">${esc(error)}</div>` : ''}
<form method="post" action="/owner/login" class="card">
  <label>Password
    <input type="password" name="password" autocomplete="current-password" required autofocus>
  </label>
  <button class="primary">Log in</button>
</form>`,
  });
}

export function ownerSchoolsPage({ schools, newDemos, defaultId, notice = '' }) {
  const notices = { added: 'School added. Its sign-up codes are in the table.', updated: 'Saved.', codes: 'New sign-up codes made. The old ones no longer work.' };
  return layout({
    title: 'Schools',
    owner: true,
    active: 'schools',
    wide: true,
    body: `<div class="page-head"><div><h1>Schools</h1><p class="page-sub">Each school has its own administrators, teachers, items and students. Send a school its admin code after a demo.</p></div></div>
${newDemos ? `<div class="alert info"><strong>${newDemos} new demo request${newDemos === 1 ? '' : 's'}.</strong> <a href="/owner/demos">Read them</a>.</div>` : ''}
${notices[notice] ? `<div class="alert success" role="status">${notices[notice]}</div>` : ''}
<form method="post" action="/owner/schools" class="card inline-form">
  <h2>Add a school</h2>
  <label>School name <span class="required">*</span>
    <input type="text" name="name" maxlength="120" required>
  </label>
  <label>Student email domain <span class="muted">(optional, example: myschool.edu)</span>
    <input type="text" name="email_domain" maxlength="100">
  </label>
  <button class="primary">Add school</button>
</form>
<div class="table-wrap"><table>
<thead><tr><th>School</th><th>Staff</th><th>Items</th><th>Out now</th><th>Admin code</th><th>Teacher code</th><th></th></tr></thead>
<tbody>
${schools
  .map(
    (school) => `<tr>
  <td>
    <form method="post" action="/owner/schools/${school.id}" class="stack-form">
      <input type="text" name="name" value="${esc(school.name)}" maxlength="120" aria-label="School name" required>
      ${
        school.id === defaultId
          ? `<span class="muted small">Email domain: ${school.email_domain ? '@' + esc(school.email_domain) : 'any'} (set in your settings)</span>`
          : `<input type="text" name="email_domain" value="${esc(school.email_domain)}" maxlength="100" placeholder="email domain" aria-label="Student email domain">`
      }
      <button class="secondary small">Save</button>
    </form>
  </td>
  <td>${school.staff}</td>
  <td>${school.items}</td>
  <td>${school.open}</td>
  <td>${school.admin_code ? `<code>${esc(school.admin_code)}</code>` : '<span class="muted">closed</span>'}</td>
  <td>${school.teacher_code ? `<code>${esc(school.teacher_code)}</code>` : '<span class="muted">closed</span>'}</td>
  <td>${
    school.id === defaultId
      ? '<span class="muted small">Codes come from your settings</span>'
      : `<form method="post" action="/owner/schools/${school.id}/codes"><button class="secondary small">New codes</button></form>`
  }</td>
</tr>`
  )
  .join('')}
</tbody></table></div>`,
  });
}

export function ownerDemosPage({ requests }) {
  return layout({
    title: 'Demo requests',
    owner: true,
    active: 'demos',
    wide: true,
    body: `<div class="page-head"><div><h1>Demo requests</h1><p class="page-sub">Schools that asked for a demo. They are also emailed to you when email is set up.</p></div></div>
${
  requests.length
    ? `<div class="table-wrap"><table>
<thead><tr><th>Received</th><th>School</th><th>Contact</th><th>Role</th><th>Message</th><th>Status</th><th></th></tr></thead>
<tbody>
${requests
  .map(
    (row) => `<tr>
  <td>${esc(formatDateTime(row.created_at))}</td>
  <td>${esc(row.school)}</td>
  <td>${esc(row.name)}<div class="small"><a href="mailto:${esc(row.email)}">${esc(row.email)}</a></div></td>
  <td>${esc(row.role)}</td>
  <td>${esc(row.message)}</td>
  <td>${row.status === 'new' ? '<span class="badge overdue-soft">New</span>' : '<span class="badge returned">Contacted</span>'}</td>
  <td><div class="row-actions">
    <form method="post" action="/owner/demos/${row.id}/status">
      <input type="hidden" name="status" value="${row.status === 'new' ? 'contacted' : 'new'}">
      <button class="secondary small">${row.status === 'new' ? 'Mark contacted' : 'Mark new'}</button>
    </form>
    <form method="post" action="/owner/demos/${row.id}/delete"><button class="link-button danger-link">Delete</button></form>
  </div></td>
</tr>`
  )
  .join('')}
</tbody></table></div>`
    : '<p class="card empty">No demo requests yet.</p>'
}`,
  });
}

export function ownerAccountsPage({ q, staff, notice = '' }) {
  const notices = { erased: 'Student records erased.', deleted: 'Account deleted.' };
  return layout({
    title: 'Find account',
    owner: true,
    active: 'accounts',
    wide: true,
    body: `<div class="page-head"><div><h1>Find account</h1><p class="page-sub">Help a teacher or administrator with a lost password, or erase a student's details from the records.</p></div></div>
${notices[notice] ? `<div class="alert success" role="status">${notices[notice]}</div>` : ''}
<section class="card inline-form">
  <h2>Erase a student's records</h2>
  <p class="muted small">Enter the student's school email or student ID. Every check-out with that email or ID loses the name, ID, email, phone and notes. The check-outs stay as anonymous history.</p>
  <form method="get" action="/owner/students/erase">
    <label>Email or student ID
      <input type="text" name="who" maxlength="254" required>
    </label>
    <button class="secondary">Review what will be erased</button>
  </form>
</section>
<h2>Staff</h2>
<form method="get" action="/owner/accounts" class="filters">
  <input type="search" name="q" value="${esc(q)}" placeholder="Staff name or email" aria-label="Search staff">
  <button class="secondary">Search</button>
</form>
${q && !staff.length ? '<p class="card empty">No staff account matches.</p>' : ''}
${
  staff.length
    ? `<div class="table-wrap"><table>
<thead><tr><th>Name</th><th>Email</th><th>School</th><th>Role</th><th></th></tr></thead>
<tbody>
${staff
  .map(
    (row) => `<tr class="${row.active ? '' : 'row-retired'}">
  <td>${esc(row.name)}</td><td>${esc(row.email)}</td><td>${esc(row.school_name)}</td><td>${esc(row.role)}</td>
  <td><div class="row-actions">
    <form method="post" action="/owner/accounts/staff/${row.id}/reset-password"><button class="secondary small">Reset password</button></form>
    <a class="danger-link small" href="/owner/accounts/staff/${row.id}/delete">Delete</a>
  </div></td>
</tr>`
  )
  .join('')}
</tbody></table></div>`
    : ''
}`,
  });
}

export function ownerConfirmPage({ title, message, action, button }) {
  return layout({
    title,
    owner: true,
    body: `<h1>${esc(title)}</h1>
<div class="card">
  <div class="alert error" role="alert"><strong>This cannot be undone.</strong> ${esc(message)}</div>
  <form method="post" action="${esc(action)}"><button class="danger block">${esc(button)}</button></form>
  <p><a href="/owner/accounts">Cancel</a></p>
</div>`,
  });
}

export function ownerEraseStudentPage({ who, checkouts, accounts }) {
  return layout({
    title: 'Erase student records',
    owner: true,
    body: `<h1>Erase student records</h1>
<div class="card">
  <p>Matching <strong>${esc(who)}</strong> (email or student ID): <strong>${checkouts}</strong> check-out${checkouts === 1 ? '' : 's'}${accounts ? ` and ${accounts} old student account${accounts === 1 ? '' : 's'}` : ''}.</p>
  ${
    checkouts || accounts
      ? `<div class="alert error" role="alert"><strong>This cannot be undone.</strong> The name, ID, email, phone and notes are removed from those check-outs. They stay as anonymous history.</div>
  <form method="post" action="/owner/students/erase"><input type="hidden" name="who" value="${esc(who)}"><button class="danger block">Erase for good</button></form>`
      : '<p class="muted">Nothing matches.</p>'
  }
  <p><a href="/owner/accounts">Cancel</a></p>
</div>`,
  });
}

// ---------- Scan page ----------

export function scanPage() {
  return layout({
    title: 'Scan an item',
    body: `<h1>Scan an item</h1>
<p class="page-sub">Point your camera at the QR code on the item. It opens the check-out form.</p>
<div class="card">
  <div class="scan-box" id="scan-box">
    <video id="scan-video" playsinline muted></video>
    <div class="scan-frame" aria-hidden="true"></div>
  </div>
  <p id="scan-status" class="muted center" role="status" aria-live="polite">The camera needs your permission.</p>
  <button class="primary" id="scan-start" type="button">Start the camera</button>
</div>
<form method="get" action="/find" class="card">
  <label for="scan-code">Or type the code printed under the barcode
    <input id="scan-code" type="text" name="code" autocomplete="off" autocapitalize="none" maxlength="40" required>
  </label>
  <button class="secondary">Find item</button>
</form>
<script src="/scan.js" defer></script>`,
  });
}
