import { db } from '@/lib/db';
import { xAccounts } from '@/lib/db/schema';
import { ACCOUNT_SLOTS, isAccountSlot } from '@/lib/account-slots';
import { asc, eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const rows = await db.select().from(xAccounts).orderBy(asc(xAccounts.slot));

    const bySlot = new Map(rows.map((row) => [row.slot, row]));
    const accounts = ACCOUNT_SLOTS.map((slot) => {
      const account = bySlot.get(slot);
      const connected = Boolean(account?.twitterAccessToken && account?.twitterAccessTokenSecret);
      return {
        id: account?.id ?? null,
        slot,
        connected,
        twitterUserId: account?.twitterUserId ?? null,
        twitterUsername: account?.twitterUsername ?? null,
        twitterDisplayName: account?.twitterDisplayName ?? null,
      };
    });

    return NextResponse.json({
      accounts,
      connectedSlots: accounts.filter((account) => account.connected).map((account) => account.slot),
    });
  } catch (error) {
    console.error('Error fetching user:', error);
    return NextResponse.json({ error: 'Failed to fetch user data' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const slotParam = req.nextUrl.searchParams.get('slot');
    if (!slotParam) {
      await db.delete(xAccounts);
      return NextResponse.json({ message: 'All X accounts disconnected successfully.' });
    }

    const slot = Number(slotParam);
    if (!Number.isFinite(slot) || !isAccountSlot(slot)) {
      return NextResponse.json({ error: 'Invalid slot. Use slot=1 or slot=2.' }, { status: 400 });
    }
    await db.delete(xAccounts).where(eq(xAccounts.slot, slot));
    return NextResponse.json({ message: `X account slot ${slot} disconnected successfully.` });
  } catch (error) {
    console.error('Error disconnecting user:', error);
    return NextResponse.json({ error: 'Failed to disconnect user' }, { status: 500 });
  }
}
