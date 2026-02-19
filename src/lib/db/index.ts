import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import * as schema from './schema';
import { ensureSchema } from './init';

function resolveDbPath(): string {
  const raw = (process.env.X_MANAGER_DB_PATH || '').trim() || 'var/x-manager.sqlite.db';
  const resolved = path.isAbsolute(raw) ? raw : path.join(process.cwd(), raw);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  return resolved;
}

export const dbPath = resolveDbPath();
export const sqlite = new Database(dbPath, { timeout: 5000 });

// Apply critical PRAGMAs unconditionally — including during production builds —
// so every connection uses WAL mode and a sane busy timeout.
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('busy_timeout = 5000');
sqlite.pragma('synchronous = NORMAL');

const isNextProductionBuild = process.env.NEXT_PHASE === 'phase-production-build';
if (!isNextProductionBuild) {
  ensureSchema(sqlite);
}

export const db = drizzle(sqlite, { schema });
