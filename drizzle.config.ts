import type { Config } from 'drizzle-kit';

const dbUrl = (process.env.X_MANAGER_DB_PATH || '').trim() || './var/x-manager.sqlite.db';

export default {
  schema: './src/lib/db/schema.ts',
  out: './drizzle',
  driver: 'better-sqlite',
  dbCredentials: {
    url: dbUrl,
  },
} satisfies Config;
