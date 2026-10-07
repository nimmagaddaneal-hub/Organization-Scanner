import { existsSync } from 'node:fs';

// Read .env when it exists. On a hosting provider the variables come from its settings instead.
if (existsSync('.env')) process.loadEnvFile('.env');



// An empty TZ= line would switch the clock to UTC. Empty means "use this computer's time zone".
if (!process.env.TZ) delete process.env.TZ;

export const databasePath = process.env.DATABASE_PATH || './data/checkout.db';
