# Checkout Request for Organization

A scan-to-check-out system for a school organization.

- **Students** scan the QR code on an item with their phone camera, fill out a short form, and the item is logged as checked out. No app and no login.
- **Teachers** sign up for an account, list their own items, and get a printable QR code and barcode for each one right away. They see check-outs of their own items only.
- **Administrators** sign up for an account and see everything: all check-outs, all items, history, CSV export, code labels, and the list of staff accounts.

## What it is built with

- [Node.js](https://nodejs.org) 22.13 or newer (uses the SQLite support built into Node, so there is no database to install)
- [Express](https://expressjs.com) for the web server
- SQLite for storage: one file, `data/checkout.db`
- [qrcode](https://www.npmjs.com/package/qrcode) and [bwip-js](https://www.npmjs.com/package/bwip-js) to draw the QR codes and barcodes

```
src/server.js   starts the server, reads settings
src/app.js      all routes (student form, admin pages)
src/views.js    the HTML pages
src/db.js       database tables
src/auth.js     password hashing, login cookie, rate limiting
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
   - `ADMIN_SIGNUP_CODE` and `TEACHER_SIGNUP_CODE`: two different secret codes, 8 characters or more (see [Staff accounts](#staff-accounts)).
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

- Create the first admin account: <http://localhost:3000/admin/signup> (use the `ADMIN_SIGNUP_CODE` from `.env`)
- Staff login: <http://localhost:3000/admin>
- A student form: log in, go to **Items**, and click **Open form** next to an item.

`npm run dev` restarts the server automatically when you edit a file.

### Testing with a real phone

A phone cannot open `localhost`. To scan real QR codes while the system runs on your computer:

1. Connect the phone and the computer to the same Wi-Fi.
2. Find the computer's IP address (Mac: `ipconfig getifaddr en0`).
3. Set `BASE_URL=http://THAT-IP:3000` in `.env` and restart the server.
4. Open **Codes** in the staff pages and scan a QR code from the screen.

Some school Wi-Fi networks block devices from talking to each other. If the phone cannot connect, deploy the system (below) or use a phone hotspot.

## Staff accounts

There are two kinds of staff account. Both sign up at `/admin/signup` with a name, email, password (10 characters or more) and a sign-up code. **The code decides the role.**

| Role | Sign-up code | Can do |
| --- | --- | --- |
| Admin | `ADMIN_SIGNUP_CODE` | Everything: all items, all check-outs, history, CSV, code labels, **People** page |
| Teacher | `TEACHER_SIGNUP_CODE` | List items, print their codes, see and return check-outs of **their own items only** |

- Hand the admin code only to people who may see all student data. Anyone with that code can make an admin account.
- To close sign-up, empty the code in `.env` (or your host's settings) and restart. Existing accounts keep working.
- Admins open **People** to see all accounts and to **Deactivate** one. A deactivated account is logged out at once.
- Log in at `/admin` with email and password. The login lasts 8 hours. After 8 wrong passwords, logins from that address are blocked for 15 minutes.
- There is no "forgot password" email. If someone forgets their password, an admin deactivates the account and the person signs up again with a different email. (Or delete their row from the `users` table and they can sign up again with the same email.)
- Passwords are stored only as salted scrypt hashes.

## List items and print codes

1. Log in and open **Items**.
2. Under **List an item**, type a name (and an optional description) and click **Add item and get code**.
3. The label for that item opens at once, with:
   - a **QR code**, which students scan with a phone camera to open the form;
   - a **barcode** (Code 128) holding the item's code, for handheld barcode scanners.
4. Click **Print**, cut the label out, and stick it on the item.
5. **Codes** in the menu (or **Print all codes**) gives a sheet with every item you can see.

Phone cameras open QR codes but do not open links from ordinary barcodes. To use the barcode, open the site's home page, click in the code box, and scan the barcode with a handheld scanner (or type the code printed under it). The form for that item opens.

Important: the QR codes contain `BASE_URL`. **Set `BASE_URL` to the final address before you print.** If the address changes later, print the codes again. (Barcodes do not contain the address and stay valid.)

To change an item, click **Edit**. Unchecking **Active** retires the item: its codes stop working and its history is kept. Items are never deleted, so history stays complete. Teachers can edit only items they listed. The sample items belong to the organization, so only admins see them.

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
   fly secrets set ADMIN_SIGNUP_CODE="admin-code" TEACHER_SIGNUP_CODE="teacher-code" SESSION_SECRET="long-random-string" BASE_URL="https://YOUR-APP-NAME.fly.dev"
   fly deploy
   ```
3. Open `https://YOUR-APP-NAME.fly.dev/admin/signup`, create your admin account, list items, and print the codes.

Optional secrets: `SCHOOL_EMAIL_DOMAIN` and `TZ` (example: `America/Chicago`). Set `TZ` on a host, or due dates use UTC.

### Alternatives

- **Render** (about $7 per month): create a Web Service from this repo, add a persistent disk mounted at `/data`, and set the same variables plus `DATABASE_PATH=/data/checkout.db` and `TRUST_PROXY=1`. The free plan has no persistent disk, so do not use it.
- **A computer at school that stays on** (free): run `npm start` on it and set `BASE_URL` to its address on the school network. Works only while students are on that network.

### Backups

All data is in the file at `DATABASE_PATH`. Copy that file to back it up. Also use **Export CSV** on the History page from time to time.

## Privacy and security

- Student data is shown only on staff pages. Every staff page and action requires a login. Teachers see student data only for check-outs of their own items; admins see all of it.
- Nobody can make a staff account without a sign-up code.
- The student pages never show who has an item. Returning an item needs either the phone that checked it out or the matching student ID **and** email; wrong guesses are limited to 5 per 10 minutes.
- No credentials are in the code. All settings come from environment variables.
- The database refuses a second open check-out for the same item, even if two students submit at the same moment.
- Use HTTPS when deployed (Fly.io and Render do this for you) and set `TRUST_PROXY=1` so cookies are marked secure.

## Choices made where the request was open

- **The repo was empty** (README only), so there was no existing form or framework to build on. Node + Express + SQLite was chosen because it needs no separate database and few dependencies.
- **"Same student" without a login:** at check-out, the phone saves a private cookie for that item. Scanning again from that phone shows **Return this item**. From another phone, the student enters their student ID and email to return.
- **Sign-up is protected by codes.** An open sign-up page would let anyone become an admin and read student data, so each role needs its code.
- **Teachers are a separate, limited role.** They see only their own items and those items' check-outs.
- **"Barcode" means both:** every label has a QR code (for phones) and a Code 128 barcode (for handheld scanners).
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

- [ ] `npm run seed`, `npm start`.
- [ ] `/admin` without logging in redirects to the login page. A wrong password is rejected.
- [ ] `/admin/signup` with a wrong code is refused. With the admin code it creates an admin account and logs in.
- [ ] Sign up a second account with the teacher code. It lands on **Items** and sees no sample items and no **People** link.
- [ ] As the teacher, list an item. The label opens with a QR code and a barcode. **Print** opens the print dialog.
- [ ] Scan the QR code (or click **Open form**). The item name and check-out time are filled in and read-only.
- [ ] On the home page, type the code printed under the barcode. The same form opens.
- [ ] Submit the form empty. Errors appear and nothing is saved.
- [ ] Submit the form with valid details. The confirmation screen appears.
- [ ] The check-out appears on the teacher's dashboard with item, name, student ID, email, dates and **On time**. The admin sees it too.
- [ ] A check-out of a sample item appears for the admin and not for the teacher.
- [ ] Open the same item link in a private window (a "different student"). It shows **Unavailable** and no student details. A duplicate check-out is not possible.
- [ ] In the private window, try to return with a wrong student ID and email. It is refused.
- [ ] Scan again on the original phone. **Return this item** is offered and works. The item is available again.
- [ ] Check out an item, then click **Mark returned** on the dashboard. It leaves the dashboard and appears in **History** as returned.
- [ ] Check out an item with today as the return date, wait until tomorrow (or edit the date in the database). The row is highlighted **Overdue**.
- [ ] Search by student name and by item name. Filter by **Overdue**.
- [ ] **Export CSV** downloads a file that opens in a spreadsheet.
- [ ] As admin, open **People** and deactivate the teacher. The teacher is logged out and cannot log in.
