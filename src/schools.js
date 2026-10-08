// Owner tool. Creates a school after a demo and prints its sign-up codes.
//   npm run schools -- add "School name" [--domain school.edu]
//   npm run schools -- list [--codes]
//   npm run schools -- codes <id>       makes new codes (the old ones stop working)
//   npm run schools -- rename <id> "New name"
// It uses the database in .env: the local file, or Turso when TURSO_DATABASE_URL is set.
import { database } from './config.js';
import { openDb, createSchool, newSignupCode } from './db.js';

const [command, ...args] = process.argv.slice(2);
const flag = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? null : args[index + 1] ?? true;
};
const positional = args.filter((arg, index) => !arg.startsWith('--') && !args[index - 1]?.startsWith('--'));

const db = await openDb(database);

if (command === 'add' && positional[0]) {
  const domain = flag('--domain');
  const id = await createSchool(db, {
    name: positional[0],
    emailDomain: typeof domain === 'string' ? domain.toLowerCase().replace(/^@/, '') : null,
  });
  const school = await db.prepare('SELECT * FROM schools WHERE id = ?').get(id);
  console.log(`Created school ${school.id}: ${school.name}`);
  console.log(`  Admin sign-up code:   ${school.admin_code}   (give to the school's administrator)`);
  console.log(`  Teacher sign-up code: ${school.teacher_code}   (the administrator can hand this to teachers)`);
  console.log('  They sign up at /admin/signup on your site.');
} else if (command === 'list') {
  const rows = await db
    .prepare(
      `SELECT s.*, (SELECT COUNT(*) FROM users u WHERE u.school_id = s.id) AS staff,
              (SELECT COUNT(*) FROM items i WHERE i.school_id = s.id) AS items
         FROM schools s ORDER BY s.id`
    )
    .all();
  for (const row of rows) {
    console.log(`${row.id}: ${row.name}  (${row.staff} staff, ${row.items} items${row.email_domain ? `, @${row.email_domain}` : ''})`);
    if (flag('--codes')) console.log(`     admin: ${row.admin_code ?? '(closed)'}  teacher: ${row.teacher_code ?? '(closed)'}`);
  }
} else if (command === 'codes' && positional[0]) {
  const id = Number(positional[0]);
  if (id === 1) {
    console.error('School 1 takes its codes from ADMIN_SIGNUP_CODE and TEACHER_SIGNUP_CODE in your settings. Change them there.');
    process.exit(1);
  }
  const school = await db.prepare('SELECT id, name FROM schools WHERE id = ?').get(id);
  if (!school) {
    console.error(`No school with id ${id}.`);
    process.exit(1);
  }
  const [adminCode, teacherCode] = [newSignupCode(), newSignupCode()];
  await db.prepare('UPDATE schools SET admin_code = ?, teacher_code = ? WHERE id = ?').run(adminCode, teacherCode, id);
  console.log(`New codes for ${school.name}. The old codes no longer work.`);
  console.log(`  Admin:   ${adminCode}`);
  console.log(`  Teacher: ${teacherCode}`);
} else if (command === 'rename' && positional[0] && positional[1]) {
  await db.prepare('UPDATE schools SET name = ? WHERE id = ?').run(positional[1], Number(positional[0]));
  console.log('Renamed.');
} else {
  console.error('Usage: npm run schools -- add "School name" [--domain school.edu] | list [--codes] | codes <id> | rename <id> "New name"');
  process.exit(1);
}
db.close();
