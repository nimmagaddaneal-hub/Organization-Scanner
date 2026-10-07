# Checkout Request for Organization

A scan-to-check-out system for a school organization.

- **Students** create an account once (name, ID or lunch number, school email, password). Then they scan the QR code on an item with their phone camera, pick a return date, and the item is logged under their account. No app to install.
- **Teachers** sign up for an account, list their own items, and get a printable QR code and barcode for each one right away. They see check-outs of their own items only.
- **Administrators** sign up for an account and see everything: all check-outs, all items, history, CSV export, code labels, and the list of staff accounts.

## What it is built with

- [Node.js](https://nodejs.org) 20.12 or newer
- [Express](https://expressjs.com) for the web server
- SQLite for storage. Locally: one file, `data/checkout.db`. Hosted: a free [Turso](https://turso.tech) database, which is SQLite in the cloud. Same code for both, through [@libsql/client](https://www.npmjs.com/package/@libsql/client)
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

1. Install [Node.js](https://nodejs.org) 20.12 or newer.
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
- Click your name in the top bar to open **Settings**: change your name, change your password (asks for the current one), or delete your own account (asks for your password). Deleting an account keeps its items, which become organization items, and keeps all check-out history. The only remaining admin cannot delete their own account.
- Admins can also **Delete** other accounts on the **People** page (after a confirmation page). Use **Deactivate** instead to block a login but keep the account.
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

To change an item, click **Edit**. Unchecking **Active** retires the item: its codes stop working and its history is kept.

To remove an item for good, click **Delete** and confirm. This also deletes the item's check-out records and cannot be undone, so export the CSV from **History** first if you need them. An item that is checked out cannot be deleted until it is marked returned. Prefer retiring when you want to keep the history. Teachers can edit only items they listed. The sample items belong to the organization, so only admins see them.

## Student accounts

- Students sign up at `/student/signup` (the home page has a button). No code is needed: students only ever see their own items.
- At check-out the form is filled in from the account (name, ID, email). The student adds a return date and optional phone and notes.
- Scanning an item while logged out asks the student to log in or sign up, then returns them to that item.
- **My items** (`/account`) lists what a student has out, with a Return button, plus their history.
- Staff see the account on each check-out (an **Account** tag). Admins also get a **Students** page: search accounts, see how many items each has out, and deactivate an account (it is logged out at once; history is kept).
- A student returns an item by being logged in as the person who checked it out. From another phone: log in there, then scan.
- Check-outs made before this feature have no account. Admins can mark those returned on the dashboard.
- Student logins last 30 days. After 8 wrong passwords for one account, that account is blocked for 15 minutes. Other students are not affected, so a whole school sharing one network is fine.
- There is no student "forgot password" email yet. An admin deactivates the account, and the student signs up again with a different email.
- If `SCHOOL_EMAIL_DOMAIN` is set, only emails ending in that domain can sign up. **Set it**, so only your school's addresses get accounts.

## Demo requests from other schools

The home page has a **Request a demo** button (top) and a form (bottom). Each request is saved. Admins read them on the **Demos** page, reply by email, and mark them contacted. Nothing is emailed automatically, so **check the Demos page**. A hidden field and a limit of 5 requests per hour per address keep bots out.

Staff sign-up needs a code, so a new school only gets staff access after you give it a code.

## How it works for students

1. Create a student account once, or log in.
2. Scan the code. The form opens with the item, the current date and time, and your details filled in.
3. Pick an expected return date (required). Phone and purpose are optional.
4. A confirmation screen appears.
5. To return the item, scan the same code again (or open **My items**) and tap **Return this item**.

If someone else scans an item that is checked out, they see **Unavailable** and nothing about who has it.

## Deploy

### Recommended: Render + Turso (free)

- **Render** runs the site. Free plan.
- **Turso** stores the data. Free plan. Needed because Render's free plan erases local files on every restart.

Limits of the free setup:

- The site **sleeps after 15 minutes without visitors**. The next scan takes about 30 to 60 seconds to load. After that it is fast.
- Free plans can change. Check the current limits on [render.com/pricing](https://render.com/pricing) and [turso.tech/pricing](https://turso.tech/pricing).

Steps:

1. **Merge `scanning-system` into `main`** on GitHub (pull request, then merge). Render deploys from `main`.
2. **Create the database.** Sign up at <https://turso.tech>. Create a database (any name, pick the region closest to you). Copy two values:
   - the database URL (starts with `libsql://`);
   - an auth token (**Create Token**, read and write, no expiry).
3. **Create the site.** Sign up at <https://render.com> with your GitHub account. Click **New > Blueprint**, pick this repository. Render reads `render.yaml` and asks for:
   - `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`: the two values from step 2.
   - `ADMIN_SIGNUP_CODE` and `TEACHER_SIGNUP_CODE`: two different secret codes you make up, 8 characters or more.
   - `TZ`: your time zone, for example `America/Chicago`. Without it, due dates use UTC.
4. Click **Apply** and wait for the deploy to finish. Render shows the public address, like `https://organization-scanner.onrender.com`.
5. Open `THAT-ADDRESS/admin/signup` and create your admin account with the admin code.
6. List items and print the codes. The QR codes use the public address automatically.

To change a setting later: Render dashboard > the service > **Environment**. Saving restarts the site.

Tables are created automatically on first start. To add the 5 sample items to the hosted database, put the two `TURSO_` values in your local `.env` and run `npm run seed` (then remove them again to go back to the local file).

### Alternatives (paid, never sleep)

- **Fly.io** (about $2 to $4 per month): this repo includes a `Dockerfile` and `fly.toml`. Install `fly` (<https://fly.io/docs/flyctl/install/>), then:
  ```bash
  fly launch --no-deploy
  fly volumes create checkout_data --size 1
  fly secrets set ADMIN_SIGNUP_CODE="admin-code" TEACHER_SIGNUP_CODE="teacher-code" SESSION_SECRET="long-random-string" BASE_URL="https://YOUR-APP-NAME.fly.dev" TZ="America/Chicago"
  fly deploy
  ```
  Data stays in a SQLite file on the Fly volume. No Turso needed.
- **Render paid plan** (about $7 per month): same steps as above; change `plan: free` to `plan: starter` in `render.yaml`. The site no longer sleeps.

### Backups

Hosted on Turso: the Turso dashboard has backups and a data browser. Local or Fly.io: all data is in the file at `DATABASE_PATH`; copy that file. In both cases, use **Export CSV** on the History page from time to time.

## Privacy and security

- Student data is shown only on staff pages. Every staff page and action requires a login. Teachers see student data only for check-outs of their own items; admins see all of it.
- Nobody can make a staff account without a sign-up code.
- The student pages never show who has an item. Only the student who checked an item out (logged in) can return it, or an admin or the item's teacher.
- Student and staff logins are separate: a student login never opens staff pages.
- No credentials are in the code. All settings come from environment variables.
- The database refuses a second open check-out for the same item, even if two students submit at the same moment.
- Use HTTPS when deployed (Fly.io and Render do this for you) and set `TRUST_PROXY=1` so cookies are marked secure.

## Choices made where the request was open

- **The repo was empty** (README only), so there was no existing form or framework to build on. Node + Express + SQLite was chosen because it needs no separate database and few dependencies.
- **"Same student" without a login:** at check-out, the phone saves a private cookie for that item. Scanning again from that phone shows **Return this item**. From another phone, the student enters their student ID and email to return.
- **Sign-up is protected by codes.** An open sign-up page would let anyone become an admin and read student data, so each role needs its code.
- **Teachers are a separate, limited role.** They see only their own items and those items' check-outs.
- **"Barcode" means both:** every label has a QR code (for phones) and a Code 128 barcode (for handheld scanners).
- **Items can be retired or deleted.** Retiring keeps the history. Deleting removes the item and its check-out records, after a confirmation page.
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
- [ ] Logged out, scan a code: it asks you to log in. Create a student account: you land back on the item.
- [ ] Logged in, scan a code. The item name and check-out time are read-only, and your details show under "Checking out as".
- [ ] On the home page, type the code printed under the barcode. The same form opens.
- [ ] Submit the form with no return date. An error appears and nothing is saved.
- [ ] Submit the form with valid details. The confirmation screen appears.
- [ ] The check-out appears on the teacher's dashboard with item, name, student ID, email, dates and **On time**. The admin sees it too.
- [ ] A check-out of a sample item appears for the admin and not for the teacher.
- [ ] Open the same item link in a private window (a "different student"). It shows **Unavailable** and no student details. A duplicate check-out is not possible.
- [ ] In the private window, log in as a second student and try to return it. It is refused.
- [ ] Scan again as the first student. **Return this item** is offered and works, and **My items** shows it. The item is available again.
- [ ] Check out an item, then click **Mark returned** on the dashboard. It leaves the dashboard and appears in **History** as returned.
- [ ] Check out an item with today as the return date, wait until tomorrow (or edit the date in the database). The row is highlighted **Overdue**.
- [ ] Search by student name and by item name. Filter by **Overdue**.
- [ ] **Export CSV** downloads a file that opens in a spreadsheet.
- [ ] Delete an item: the confirmation page appears; a checked-out item is refused; after deleting, the item and its link are gone.
- [ ] Open **Settings** (click your name): change the name, change the password (wrong current password is refused), log in with the new password.
- [ ] Delete your own teacher account in Settings: you are logged out, your items remain as organization items. The only admin is refused.
- [ ] As admin, open **People**, **Delete** a teacher account after the confirmation page.
- [ ] As admin, open **Students**: the account shows with its check-out counts. Deactivate it: the student is logged out.
- [ ] On the home page, send a demo request. It appears on the admin **Demos** page. Mark it contacted.
- [ ] As admin, open **People** and deactivate the teacher. The teacher is logged out and cannot log in.
