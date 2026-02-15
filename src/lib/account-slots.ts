export const ACCOUNT_SLOTS = [1, 2] as const;
export type AccountSlot = (typeof ACCOUNT_SLOTS)[number];

export function isAccountSlot(value: number): value is AccountSlot {
  return ACCOUNT_SLOTS.includes(value as AccountSlot);
}

export function parseAccountSlot(value: unknown): AccountSlot | null {
  const parsed = typeof value === 'string' ? Number(value) : Number(value);
  if (Number.isFinite(parsed) && isAccountSlot(parsed)) {
    return parsed;
  }
  return null;
}

export function normalizeAccountSlot(value: unknown, fallback: AccountSlot = 1): AccountSlot {
  const parsed = typeof value === 'string' ? Number(value) : Number(value);
  if (Number.isFinite(parsed) && isAccountSlot(parsed)) {
    return parsed;
  }
  return fallback;
}

export function requireAccountSlot(value: unknown, fallback?: AccountSlot): AccountSlot {
  const parsed = parseAccountSlot(value);
  if (parsed) return parsed;
  if (fallback !== undefined) return fallback;
  throw new Error('Invalid account slot. Use 1 or 2.');
}
