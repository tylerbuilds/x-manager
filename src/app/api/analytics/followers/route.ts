import { NextResponse } from 'next/server';
import { isAccountSlot } from '@/lib/account-slots';
import { getFollowerTimeseries } from '@/lib/follower-tracker';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const slotParam = url.searchParams.get('account_slot');
    const days = Math.min(365, Math.max(1, Number(url.searchParams.get('days')) || 90));

    let accountSlot = 1;
    if (slotParam) {
      const parsed = Number(slotParam);
      if (!Number.isFinite(parsed) || !isAccountSlot(parsed)) {
        return NextResponse.json({ error: 'Invalid account_slot. Use 1 or 2.' }, { status: 400 });
      }
      accountSlot = parsed;
    }

    const timeseries = getFollowerTimeseries(accountSlot as 1 | 2, days);

    return NextResponse.json({
      accountSlot,
      days,
      dataPoints: timeseries.length,
      timeseries,
    });
  } catch (error) {
    console.error('Error fetching follower timeseries:', error);
    return NextResponse.json({ error: 'Failed to fetch follower data.' }, { status: 500 });
  }
}
