import { NextResponse } from 'next/server';
import { parseAccountSlot, type AccountSlot } from '@/lib/account-slots';
import { processQueue } from '@/lib/auto-scheduler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const slotRaw = body.accountSlot ?? body.account_slot;

    let accountSlot: AccountSlot = 1;
    if (slotRaw !== undefined) {
      const parsed = parseAccountSlot(slotRaw);
      if (!parsed) {
        return NextResponse.json({ error: 'Invalid account_slot. Use 1 or 2.' }, { status: 400 });
      }
      accountSlot = parsed;
    }

    const result = await processQueue(accountSlot);
    return NextResponse.json(result);
  } catch (error) {
    console.error('Failed to process queue:', error);
    return NextResponse.json({ error: 'Failed to process queue.' }, { status: 500 });
  }
}
