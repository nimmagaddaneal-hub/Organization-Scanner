# Checkout Request for Organization

A scan-to-check-out system for a school organization.

- **Students** scan the QR code on an item with their phone camera, fill out a short form (name, ID or lunch number, school email, return date), and the item is logged as checked out. No app and no login or account.
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

## Schools

The site serves several schools. **Each school is separate**: its own administrators, teachers, items, check-outs and sign-up codes. An administrator is the administrator **of their school only**. They never see another school's staff, items, students or demo requests.

- **The first school** is called **Rowland Hall organization drawer**. It is created automatically. Its sign-up codes come from `ADMIN_SIGNUP_CODE` and `TEACHER_SIGNUP_CODE` in your settings, and its student email domain (optional) from `SCHOOL_EMAIL_DOMAIN`. Everything made before schools existed belongs to it.
- **Other schools are set up by you, personally**, after they ask for a demo (see below). From this folder:
  ```bash
  npm run schools -- add "Other Academy" --domain other.edu
  ```
  It prints that school's admin code and teacher code. Send the admin code to the school's administrator. They sign up at `/admin/signup` and become that school's administrator. The page **People** shows them both codes, so they can give the teacher code to their teachers.
- Other commands: `npm run schools -- list [--codes]`, `npm run schools -- codes <id>` (new codes; the old ones stop working), `npm run schools -- rename <id> "New name"`.
- This tool uses the database in your `.env`. To add a school to the **live** site, put `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` (from your Render settings) in your local `.env` first, run the command, then remove them again.

## The owner page

For the person who runs the site, not for any school. Set `OWNER_PASSWORD` (12 characters or more) in your settings, then open `/owner`. If it is not set, the page does not exist.

- **Schools:** add a school, see its admin and teacher sign-up codes, make new codes, rename it, set its student email domain. Send the admin code to a school after its demo. (The first school's codes come from your settings.) The command `npm run schools` does the same from a terminal.
- **Demo requests:** every request from the home page, with Mark contacted and Delete. School administrators never see these.
- **Find account:** search staff by name or email, reset a lost password, or delete a staff account. **Erase a student's records:** enter a student's email or student ID. Every check-out with it loses the name, ID, email, phone and notes (it stays as anonymous history), and any old student account is deleted.
- The owner login is separate from every staff login, and lasts 8 hours.

## Staff accounts

There are two kinds of staff account. Both sign up at `/admin/signup` with a name, email, password (10 characters or more) and a sign-up code. **The code decides the school and the role.**

| Role | Sign-up code | Can do |
| --- | --- | --- |
| Admin | the school's admin code | See everything in circulation at their school: all items, check-outs, history, CSV, code labels, students, **People** |
| Teacher | the school's teacher code | List items, print their codes, see and return check-outs of **their own items only** |

- Hand the admin code only to people who may see all student data at that school.
- To close sign-up for the first school, empty its code in your settings and restart. Existing accounts keep working.
- Admins open **People** to see their school's accounts and to **Deactivate** or **Delete** one (after a confirmation page). A deactivated account is logged out at once.
- Log in at `/admin` with email and password. The login lasts 8 hours. After 8 wrong passwords, logins from that address are blocked for 15 minutes.
- Click your name in the top bar to open **Settings**: change your name, change your password (asks for the current one), or delete your own account (asks for your password). Deleting an account keeps its items, which become organization items, and keeps all check-out history. The only remaining admin of a school cannot delete their own account.
- **Lost password (no email needed):** an administrator opens **People** and presses **Reset password** next to the person. A temporary password is shown once. Hand it over in person. The person is logged out everywhere, and must choose their own password at the next login. Administrators cannot reset their own password this way (use Settings) or another school's. If an administrator forgets theirs, the owner page can reset it.
- Changing or resetting a password logs that account out on every other device.
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

## Students

- There are **no student accounts**. A student types their details into the form at each check-out.
- Returning: the phone that checked the item out sees **Return this item** when it scans the code again. From another phone, the student enters the same student ID and email, which is checked against the check-out (5 wrong tries per 10 minutes).
- A student who scans their own late item sees a **This is late** warning on that item's page.
- A school can require its own email domain (`SCHOOL_EMAIL_DOMAIN` for the first school, `--domain` when adding another). A student whose email does not match cannot borrow that school's items.
- Student details are shown only to staff of the school that owns the item.
- To erase one student's details from the records, use **Erase a student's records** on the owner page.
- Earlier versions had student accounts. Any old accounts are still in the database but are no longer used. The owner page erase tool removes them along with the details.

## Demo requests from other schools

The home page has a **Request a demo** button (top) and a form (bottom). Each request is **emailed to you**, and also saved in the database so nothing is lost if the email fails. You read them on the owner page (`/owner/demos`). **School administrators never see demo requests.**

To get the emails, set these in your settings (all three are in `.env.example`):

1. Sign up at <https://resend.com> with **your own email address**, and create an API key.
2. `RESEND_API_KEY`: that key.
3. `DEMO_NOTIFY_EMAIL`: your email address, the one you signed up to Resend with. Resend's free test sender delivers only to that address, which is what you need here. (Check Resend's current rules on their site.)
4. Optional `MAIL_FROM`: leave empty to use `Item Check-out <onboarding@resend.dev>`.

Replying to the email answers the person who asked. Then you set their school up with `npm run schools -- add`.

Without these settings, requests are still saved, but you are not told. The server log says so at start. A hidden field and a limit of 5 requests per hour per address keep bots out.

## Home page animation

The "ours" diagram in the Side by side section is drawn in 3D (isometric) on a canvas, and the section **locks in place** while you scroll through it. Scrolling drops three item boxes, a dashboard and a platform onto the ground, and finally the orb, your organization. Each landing sends a ripple across the ground mesh and a pulse ring; boxes hop and ride the waves. Labels and numbered pins appear as things land, and the matching line beside the diagram lights up. Falling follows the scroll position, so scrolling back up lifts everything again. If the visitor's device asks for reduced motion, the finished diagram is shown without animation or locking. The code is in `public/diagram.js`; the orb in the first section is `public/hero.js` and can be dragged.

## Scan button

The home page has a **Scan an item** button (`/scan`). It opens the phone camera inside the site and reads the QR code on an item, then opens that item's form. It uses the phone's built-in reader when there is one (which also reads the barcode), and a small open-source QR reader ([jsQR](https://github.com/cozmo/jsQR), Apache-2.0) otherwise. Typing the code under the barcode always works. The camera needs a secure address (`https://`, or `localhost`) and the visitor's permission.

## Return notes and extensions

- **Return notes:** when returning, a student can write what the teacher should know (damage, missing parts), and staff can add a note when they mark an item returned. Notes show in **History**, with a "Note" tag, and in the CSV.
- **More time:** on the phone that checked an item out, **I need more time** moves the return date once, by up to 7 days (from the current date, or from today if it is already late). Staff can change a return date any time with **Change date** on the dashboard. The original date is kept and shown as "was ...", and is in the CSV.

## Many items at once, categories, labels

- **Spreadsheet import:** on **Items**, open "Add many items from a spreadsheet", then paste rows (name, description, category) or choose a CSV file. A header row is fine. Up to 100 items per import. Teachers import into their own items.
- **Categories:** an optional category on each item. The Items list is sorted by category.
- **Label sizes:** on **Codes**, choose Large (2 across), Medium (3), Small (4) or Sticker (6 across, QR and name only). Pick the size that matches your sticker paper, then print. Check one test page before printing a whole sheet.

## What's available link

An administrator can create a link on **Items** to a public page showing which of the school's items are available right now, grouped by category. It shows items only, with a "due back" date for items that are out, and **never any names**. It is off until an administrator creates it. "Make a new link" kills the old one, and "Turn off" removes it. Anyone with the link can open it, so only share it with your school.

## Waiting lists

When an item is checked out, a student can open **Tell me when it is back** and leave a name and school email. Nothing is sent automatically. Staff see it as an "N waiting" tag on the dashboard and on the **Waitlist** page, where **Email them** opens your own mail app with a message ready. Someone comes off the list when they check the item out, when staff remove them, or when they are erased. Up to 20 people per item.

Not built: item photos. They would need image storage, and the free database is small.

## Reminders for late items

On the dashboard, every late row has an **Email reminder** button, and the top has **Email everyone late** (everyone is on Bcc, so addresses stay private). They open your own email app with the message already written. Nothing is sent by the site, so no email service is needed.

## Privacy and terms

`/privacy` holds a plain-language privacy and terms page, linked from every page footer and both sign-up forms. It describes what this site actually does. **Have your school or a lawyer read it before you rely on it**, especially the section on students under 13, and change the wording if your own rules differ.

## How it works for students

1. Scan the code. The form opens with the item and the current date and time already filled in.
2. Enter full name, student ID (lunch number), school email, expected return date (required), and phone and purpose (optional).
3. A confirmation screen appears.
4. To return the item, scan the same code again and tap **Return this item**.

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
   - `DEMO_NOTIFY_EMAIL` and `RESEND_API_KEY`: where demo requests are emailed (see [Demo requests](#demo-requests-from-other-schools)).
   - `TZ`: your time zone, for example `America/Chicago`. Without it, due dates use UTC.
4. Click **Apply** and wait for the deploy to finish. Render shows the public address, like `https://organization-scanner.onrender.com`.
5. Open `THAT-ADDRESS/admin/signup` and create your admin account with the admin code. You become the administrator of **Rowland Hall organization drawer**.
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
- Student details are shown only to staff of the school that owns the item.
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
- **Email domain is not enforced** for a school unless you set one.
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
- [ ] Scan a code (or click **Open form**). The item name and check-out time are filled in and read-only.
- [ ] On the home page, press **Scan an item**, allow the camera, and point it at a QR code: the form opens. Typing the code under the barcode also works.
- [ ] Submit the form with no return date. An error appears and nothing is saved.
- [ ] Submit the form with valid details. The confirmation screen appears.
- [ ] The check-out appears on the teacher's dashboard with item, name, student ID, email, dates and **On time**. The admin sees it too.
- [ ] A check-out of a sample item appears for the admin and not for the teacher.
- [ ] Open the same item link in a private window (a "different student"). It shows **Unavailable** and no student details. A duplicate check-out is not possible.
- [ ] In the private window, log in as a second student and try to return it. It is refused.
- [ ] Scan again on the original phone. **Return this item** is offered and works. The item is available again.
- [ ] Check out an item, then click **Mark returned** on the dashboard. It leaves the dashboard and appears in **History** as returned.
- [ ] Check out an item with today as the return date, wait until tomorrow (or edit the date in the database). The row is highlighted **Overdue**.
- [ ] Search by student name and by item name. Filter by **Overdue**.
- [ ] **Export CSV** downloads a file that opens in a spreadsheet.
- [ ] Delete an item: the confirmation page appears; a checked-out item is refused; after deleting, the item and its link are gone.
- [ ] Open **Settings** (click your name): change the name, change the password (wrong current password is refused), log in with the new password.
- [ ] Delete your own teacher account in Settings: you are logged out, your items remain as organization items. The only admin is refused.
- [ ] As admin, open **People**, **Delete** a teacher account after the confirmation page.
- [ ] On the dashboard, make an item late (set an old return date). **Email reminder** opens your mail app with the message written. The student sees **This is late** on that item's page.
- [ ] Return an item with a note, then find the note in **History**. Use **I need more time** once on the phone that checked it out, and **Change date** on the dashboard.
- [ ] Import a few items from a pasted spreadsheet. Print **Codes** at a different label size.
- [ ] Create the **What's available** link on **Items**, open it in a private window: no names are shown.
- [ ] On a checked-out item, join the waiting list from another phone. It shows on **Waitlist**; **Email them** opens your mail app; checking the item out removes the person.
- [ ] Open `/privacy` from the footer and from both sign-up forms.
- [ ] With `OWNER_PASSWORD` set, log in at `/owner`: add a school, read the demo request, find a student, reset their password, and erase them.
- [ ] On the home page, send a demo request. It arrives in your own inbox. It is not visible anywhere in the admin pages.
- [ ] Add a second school (`npm run schools -- add`), sign up as its admin: you see none of the first school's items, people or students.
- [ ] As admin, open **People** and deactivate the teacher. The teacher is logged out and cannot log in.
