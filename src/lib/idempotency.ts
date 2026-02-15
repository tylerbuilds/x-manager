import { NextResponse } from 'next/server';
import { sqlite } from './db';
import { debugLog } from './debug';

const DEFAULT_TTL_SECONDS = 86400; // 24 hours

let callCount = 0;

type IdempotencyRow = {
  id: number;
  scope: string;
  idempotency_key: string;
  status_code: number;
  response_json: string;
  expires_at: number;
  created_at: number;
};

type CheckHit = { hit: true; statusCode: number; response: unknown };
type CheckMiss = { hit: false };
type CheckResult = CheckHit | CheckMiss;

function cleanupExpired(): void {
  try {
    const nowEpoch = Math.floor(Date.now() / 1000);
    sqlite.prepare('DELETE FROM api_idempotency WHERE expires_at <= ?').run(nowEpoch);
  } catch (err) {
    debugLog.warn('[idempotency] cleanup failed:', err);
  }
}

function maybeCleanup(): void {
  callCount += 1;
  if (callCount % 100 === 0) {
    cleanupExpired();
  }
}

export function checkIdempotency(scope: string, key: string): CheckResult {
  maybeCleanup();

  const row = sqlite
    .prepare('SELECT * FROM api_idempotency WHERE scope = ? AND idempotency_key = ?')
    .get(scope, key) as IdempotencyRow | undefined;

  if (!row) {
    return { hit: false };
  }

  const nowEpoch = Math.floor(Date.now() / 1000);
  if (row.expires_at <= nowEpoch) {
    // Expired entry -- treat as miss and remove it.
    sqlite
      .prepare('DELETE FROM api_idempotency WHERE id = ?')
      .run(row.id);
    return { hit: false };
  }

  let response: unknown;
  try {
    response = JSON.parse(row.response_json);
  } catch {
    response = null;
  }

  return { hit: true, statusCode: row.status_code, response };
}

export function saveIdempotency(
  scope: string,
  key: string,
  statusCode: number,
  response: unknown,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): void {
  const nowEpoch = Math.floor(Date.now() / 1000);
  const expiresAt = nowEpoch + ttlSeconds;
  const responseJson = JSON.stringify(response);

  sqlite
    .prepare(
      `INSERT OR REPLACE INTO api_idempotency (scope, idempotency_key, status_code, response_json, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(scope, key, statusCode, responseJson, expiresAt, nowEpoch);
}

export async function withIdempotency(
  scope: string,
  req: Request,
  handler: () => Promise<NextResponse>,
): Promise<NextResponse> {
  const idempotencyKey = req.headers.get('Idempotency-Key');

  if (!idempotencyKey) {
    return handler();
  }

  const cached = checkIdempotency(scope, idempotencyKey);

  if (cached.hit) {
    const res = NextResponse.json(cached.response, { status: cached.statusCode });
    res.headers.set('X-Idempotent', 'true');
    return res;
  }

  const res = await handler();

  // Clone the response to read the body without consuming it.
  const cloned = res.clone();
  let body: unknown;
  try {
    body = await cloned.json();
  } catch {
    body = null;
  }

  saveIdempotency(scope, idempotencyKey, res.status, body);

  return res;
}
