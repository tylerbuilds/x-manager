import { NextRequest, NextResponse } from 'next/server';
import { getResolvedXConfig } from '@/lib/x-config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const config = await getResolvedXConfig();
  const bearerToken = config.xBearerToken;
  if (!bearerToken) {
    return NextResponse.json(
      { error: 'Missing X bearer token. Configure it in app settings or environment.' },
      { status: 500 },
    );
  }

  const daysParam = request.nextUrl.searchParams.get('days');
  const days = Number(daysParam || '0');
  const hasDays = Number.isFinite(days) && days > 0;
  const normalizedDays = hasDays ? Math.min(Math.max(Math.floor(days), 1), 90) : null;

  const endpoint = normalizedDays
    ? `/2/usage/tweets?days=${normalizedDays}`
    : '/2/usage/tweets';
  const url = `${config.xApiBaseUrl}${endpoint}`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${bearerToken}`,
      },
      cache: 'no-store',
    });

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        {
          error: data?.detail || 'Failed to fetch X usage.',
          status: response.status,
          details: data,
        },
        { status: response.status },
      );
    }

    return NextResponse.json({
      fetchedAt: new Date().toISOString(),
      endpoint,
      usage: data,
    });
  } catch (error) {
    console.error('Error fetching X usage:', error);
    return NextResponse.json(
      { error: 'Failed to fetch usage data from X API.' },
      { status: 500 },
    );
  }
}
