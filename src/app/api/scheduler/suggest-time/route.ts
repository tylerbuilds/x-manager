import { NextResponse } from 'next/server';
import { suggestOptimalTime, suggestMultipleOptimalTimes } from '@/lib/optimal-time';
import { isAccountSlot } from '@/lib/account-slots';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const slotParam = url.searchParams.get('account_slot');
    const countParam = url.searchParams.get('count');
    const daysParam = url.searchParams.get('days');

    let accountSlot = 1;
    if (slotParam !== null) {
      const parsed = Number(slotParam);
      if (!Number.isFinite(parsed) || !isAccountSlot(parsed)) {
        return NextResponse.json({ error: 'Invalid account_slot. Use 1 or 2.' }, { status: 400 });
      }
      accountSlot = parsed;
    }

    const days = Math.min(365, Math.max(7, Number(daysParam) || 90));
    const count = Math.min(10, Math.max(1, Number(countParam) || 5));

    const suggestions = suggestMultipleOptimalTimes(accountSlot, count, days);

    return NextResponse.json({
      suggestions: suggestions.map((s) => ({
        time: s.time.toISOString(),
        dayOfWeek: s.dayOfWeek,
        hour: s.hour,
        avgEngagement: s.avgEngagement,
      })),
      recommended: suggestions.length > 0 ? suggestions[0].time.toISOString() : null,
    });
  } catch (error) {
    console.error('Error suggesting optimal time:', error);
    return NextResponse.json({ error: 'Failed to suggest optimal time.' }, { status: 500 });
  }
}
