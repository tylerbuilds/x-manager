import { eq } from 'drizzle-orm';
import { db } from './db';
import { engagementActions, xAccounts } from './db/schema';
import { decryptAccountTokens } from './x-account-crypto';
import { isAccountSlot, normalizeAccountSlot } from './account-slots';

export function parseAccountSlot(value: unknown, fallback = 1): 1 | 2 {
  const slot = normalizeAccountSlot(value, fallback as 1 | 2);
  if (!isAccountSlot(slot)) {
    throw new Error('Invalid account slot. Use 1 or 2.');
  }
  return slot;
}

export type ConnectedAccount = {
  id: number | null;
  slot: 1 | 2;
  twitterUserId: string | null;
  twitterUsername: string | null;
  twitterDisplayName: string | null;
  twitterAccessToken: string;
  twitterAccessTokenSecret: string;
  createdAt: Date | null;
  updatedAt: Date | null;
};

export async function requireConnectedAccount(slot: 1 | 2): Promise<ConnectedAccount> {
  const rows = await db.select().from(xAccounts).where(eq(xAccounts.slot, slot)).limit(1);
  const account = rows[0] ? decryptAccountTokens(rows[0]) : null;
  if (!account?.twitterAccessToken || !account?.twitterAccessTokenSecret) {
    throw new Error(`Account slot ${slot} is not connected.`);
  }
  return {
    ...account,
    slot,
    twitterAccessToken: account.twitterAccessToken,
    twitterAccessTokenSecret: account.twitterAccessTokenSecret,
  };
}

export async function recordEngagementAction(params: {
  inboxId?: number | null;
  accountSlot: 1 | 2;
  actionType: 'reply' | 'dm_send' | 'like' | 'repost' | 'dismiss';
  targetId?: string | null;
  payload: unknown;
  result?: unknown;
  status: 'success' | 'failed';
  errorMessage?: string | null;
}): Promise<void> {
  await db.insert(engagementActions).values({
    inboxId: params.inboxId ?? null,
    accountSlot: params.accountSlot,
    actionType: params.actionType,
    targetId: params.targetId ?? null,
    payload: JSON.stringify(params.payload ?? null),
    result: params.result === undefined ? null : JSON.stringify(params.result),
    status: params.status,
    errorMessage: params.errorMessage ?? null,
    updatedAt: new Date(),
  });
}
