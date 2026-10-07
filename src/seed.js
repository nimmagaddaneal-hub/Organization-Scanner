// Adds a few fake items so the system can be tried right away: npm run seed
import { databasePath } from './config.js';
import { openDb, createItem } from './db.js';

const SAMPLE_ITEMS = [
  { name: 'Canon DSLR Camera #1', description: 'Camera body, 18-55mm lens, battery, strap' },
  { name: 'Tripod #1', description: 'Full-size aluminum tripod with bag' },
  { name: 'Portable Speaker', description: 'Bluetooth speaker with charging cable' },
  { name: 'Folding Table #1', description: '6 ft folding table' },
  { name: 'Projector', description: 'HDMI projector with remote and power cable' },
];

const db = openDb(databasePath);
const { count } = db.prepare('SELECT COUNT(*) AS count FROM items').get();

if (count > 0) {
  console.log(`The inventory already has ${count} item(s). Nothing added.`);
} else {
  for (const item of SAMPLE_ITEMS) createItem(db, item);
  console.log(`Added ${SAMPLE_ITEMS.length} sample items.`);
}

for (const item of db.prepare('SELECT name, code FROM items WHERE active = 1 ORDER BY name').all()) {
  console.log(`  ${item.name}: /i/${item.code}`);
}
