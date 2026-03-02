import { NextRequest, NextResponse } from 'next/server';
import { searchDiscoveryTopics, sanitizeDiscoveryKeywords } from '@/lib/discovery-search';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const rawKeywords = request.nextUrl.searchParams.get('keywords') || '';
  const keywords = sanitizeDiscoveryKeywords(rawKeywords);
  const language = request.nextUrl.searchParams.get('lang') || 'en';
  const requestedLimit = Number(request.nextUrl.searchParams.get('limit') || 10);

  if (keywords.length === 0) {
    return NextResponse.json(
      { error: 'Missing keywords. Pass comma-separated values in the keywords query param.' },
      { status: 400 },
    );
  }

  try {
    const result = await searchDiscoveryTopics({
      keywords,
      language,
      limit: requestedLimit,
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error('Error running topic discovery:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to discover topics.' },
      { status: 500 },
    );
  }
}
