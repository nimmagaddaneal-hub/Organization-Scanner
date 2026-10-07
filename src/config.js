import { existsSync } from 'node:fs';

// Read .env when it exists. On a hosting provider the variables come from its settings instead.
if (existsSync('.env')) process.loadEnvFile('.env');



// An empty TZ= line would switch the clock to UTC. Empty means "use this computer's time zone".
if (!process.env.TZ) delete process.env.TZ;

// A hosted Turso database when TURSO_DATABASE_URL is set, otherwise a local SQLite file.
export const database = process.env.TURSO_DATABASE_URL
  ? { url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN }
  : { url: `file:${process.env.DATABASE_PATH || './data/checkout.db'}` };
