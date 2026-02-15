# Learned Patterns

[LEARN] Architecture: DB schema uses raw SQL in init.ts with ensureColumn migrations, NOT drizzle-kit migrations
[LEARN] Architecture: All new tables must be added to BOTH schema.ts (Drizzle ORM) AND init.ts (raw SQL CREATE TABLE)
[LEARN] Architecture: DB path resolves from X_MANAGER_DB_PATH env or defaults to var/x-manager.sqlite.db
[LEARN] Style: Use drizzle-orm for queries, raw sqlite for schema init and locks
[LEARN] Build: Use npm (not pnpm/yarn) - package-lock.json present
[LEARN] Architecture: Scheduler uses DB lease locking pattern (scheduler_locks table)
[LEARN] Security: Secrets encrypted via AES-256-GCM in crypto-store.ts
