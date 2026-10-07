# Checkout Request for Organization

A scan-to-check-out system for a school organization.

- **Students** scan the QR code on an item with their phone camera, fill out a short form, and the item is logged as checked out. No app and no login.
- **Administrators** log in to a separate page to see everything that is checked out, mark items returned, manage the inventory, export to CSV, and print QR codes.

## What it is built with

- [Node.js](https://nodejs.org) 22.13 or newer (uses the SQLite support built into Node, so there is no database to install)
- [Express](https://expressjs.com) for the web server
- SQLite for storage: one file, `data/checkout.db`
- [qrcode](https://www.npmjs.com/package/qrcode) to draw the QR codes

```
src/server.js   starts the server, reads settings
src/app.js      all routes (student form, admin pages)
src/views.js    the HTML pages
src/db.js       database tables
src/auth.js     admin login cookie, rate limiting
src/seed.js     adds sample items
public/         stylesheet
test/           automated tests
```

## Setup

1. Install [Node.js](https://nodejs.org) 22.13 or newer.
2. In this folder, install the dependencies:
   ```bash
   npm install
   ```
3. Create your settings file:
   ```bash
   cp .env.example .env
   ```
4. Open `.env` and set at least:
   - `ADMIN_PASSWORD`: the password for the admin page (8 characters or more).
   - `SESSION_SECRET`: a long random string. Make one with
     `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
   - `BASE_URL`: the address phones use to reach the site (see [Testing with a real phone](#testing-with-a-real-phone)).

`.env` is ignored by git. Never commit it.

## Run it locally

```bash
npm run seed    # once: adds 5 fake sample items
npm start
```

Then open:

- Admin page: <http://localhost:3000/admin>
- A student form: log in as admin, go to **Items**, and click **Open form** next to an item.

`npm run dev` restarts the server automatically when you edit a file.

### Testing with a real phone

A phone cannot open `localhost`. To scan real QR codes while the system runs on your computer:

1. Connect the phone and the computer to the same Wi-Fi.
2. Find the computer's IP address (Mac: `ipconfig getifaddr en0`).
3. Set `BASE_URL=http://THAT-IP:3000` in `.env` and restart the server.
4. Open **QR codes** in the admin page and scan a code from the screen.

Some school Wi-Fi networks block devices from talking to each other. If the phone cannot connect, deploy the system (below) or use a phone hotspot.

## Log in as an admin

Go to `/admin` and enter the `ADMIN_PASSWORD` from `.env` (or from your hosting provider's settings). There is one shared admin password. The login lasts 8 hours. After 8 wrong passwords, logins from that address are blocked for 15 minutes.

To change the password, change `ADMIN_PASSWORD` and restart the server.

## Add items and print QR codes

1. Log in and open **Items**.
2. Type a name (and an optional description) under **Add an item** and click **Add item**. Each item gets its own random code.
3. Click **Print all QR codes** for a sheet with every item, or **QR code** next to one item for a single label. Click **Print**.
4. Cut the labels out and stick them on the items.

Important: the QR codes contain `BASE_URL`. **Set `BASE_URL` to the final address before you print.** If the address changes later, print the codes again.

To change an item, click **Edit**. Unchecking **Active** retires the item: its QR code stops working and its history is kept. Items are never deleted, so history stays complete.

## How it works for students

1. Scan the code. The form opens with the item and the current date and time already filled in.
2. Enter full name, student ID, school email, expected return date (required), and phone and purpose (optional).
3. A confirmation screen appears.
4. To return the item, scan the same code again and tap **Return this item**.

If someone else scans an item that is checked out, they see **Unavailable** and nothing about who has it.

## Deploy

The system needs a host that keeps one file (the database) on a disk that survives restarts. Many "free" hosts wipe the disk on every restart, which would erase your check-outs, so they are not suitable.

### Recommended: Fly.io (about $2 to $4 per month)

This repo includes a `Dockerfile` and `fly.toml` for it. Fly.io requires a credit card. There is no reliable free tier for new accounts.

1. Install the `fly` command and sign up: <https://fly.io/docs/flyctl/install/>
2. In this folder:
   ```bash
   fly launch --no-deploy        # pick an app name; keep the existing fly.toml settings
   fly volumes create checkout_data --size 1
   fly secrets set ADMIN_PASSWORD="your-password" SESSION_SECRET="long-random-string" BASE_URL="https://YOUR-APP-NAME.fly.dev"
   fly deploy
   ```
3. Open `https://YOUR-APP-NAME.fly.dev/admin`, add items, and print the QR codes.

Optional secrets: `SCHOOL_EMAIL_DOMAIN` and `TZ` (example: `America/Chicago`). Set `TZ` on a host, or due dates use UTC.

### Alternatives

- **Render** (about $7 per month): create a Web Service from this repo, add a persistent disk mounted at `/data`, and set the same variables plus `DATABASE_PATH=/data/checkout.db` and `TRUST_PROXY=1`. The free plan has no persistent disk, so do not use it.
- **A computer at school that stays on** (free): run `npm start` on it and set `BASE_URL` to its address on the school network. Works only while students are on that network.

### Backups

All data is in the file at `DATABASE_PATH`. Copy that file to back it up. Also use **Export CSV** on the History page from time to time.

## Privacy and security

- Student data is shown only on admin pages. Every admin page and action requires the admin login.
- The student pages never show who has an item. Returning an item needs either the phone that checked it out or the matching student ID **and** email; wrong guesses are limited to 5 per 10 minutes.
- No credentials are in the code. All settings come from environment variables.
- The database refuses a second open check-out for the same item, even if two students submit at the same moment.
- Use HTTPS when deployed (Fly.io and Render do this for you) and set `TRUST_PROXY=1` so cookies are marked secure.

## Choices made where the request was open

- **The repo was empty** (README only), so there was no existing form or framework to build on. Node + Express + SQLite was chosen because it needs no separate database and few dependencies.
- **"Same student" without a login:** at check-out, the phone saves a private cookie for that item. Scanning again from that phone shows **Return this item**. From another phone, the student enters their student ID and email to return.
- **One shared admin password** instead of separate admin accounts.
- **Items are retired, not deleted**, so history is never lost.
- **Overdue** means the expected return date is before today. An item due today is on time.
- **Email domain is not enforced** unless you set `SCHOOL_EMAIL_DOMAIN`.
- **Student ID** accepts letters, numbers and dashes, up to 20 characters.
- **No email reminders.** Overdue items are highlighted on the dashboard; emails open in your mail app when clicked.

## Tests

```bash
npm test
```

The automated tests cover the checklist below.

### Test checklist

Run these by hand after setup or after any change:

- [ ] `npm run seed`, `npm start`, log in at `/admin` with the password from `.env`.
- [ ] `/admin` without logging in redirects to the login page. A wrong password is rejected.
- [ ] **Items** shows the sample items. Add an item. Edit its name.
- [ ] **QR codes** shows one code per item. **Print** opens the print dialog.
- [ ] Scan a code (or click **Open form**). The item name and check-out time are filled in and read-only.
- [ ] Submit the form empty. Errors appear and nothing is saved.
- [ ] Submit the form with valid details. The confirmation screen appears.
- [ ] The check-out appears on the admin dashboard with item, name, student ID, email, dates and **On time**.
- [ ] Open the same item link in a private window (a "different student"). It shows **Unavailable** and no student details. A duplicate check-out is not possible.
- [ ] In the private window, try to return with a wrong student ID and email. It is refused.
- [ ] Scan again on the original phone. **Return this item** is offered and works. The item is available again.
- [ ] Check out an item, then click **Mark returned** on the dashboard. It leaves the dashboard and appears in **History** as returned by admin.
- [ ] Check out an item with today as the return date, wait until tomorrow (or edit the date in the database). The row is highlighted **Overdue**.
- [ ] Search by student name and by item name. Filter by **Overdue**.
- [ ] **Export CSV** downloads a file that opens in a spreadsheet.
