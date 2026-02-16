import { twitterOAuth } from '@/lib/twitter-oauth';
import { getResolvedXConfig } from '@/lib/x-config';
import { normalizeAccountSlot } from '@/lib/account-slots';
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

function encodePendingCookie(payload: unknown): string {
  // Cookie values can't safely contain JSON punctuation, so store as base64url.
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function isOobRequiredError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes('code="417"') ||
    message.includes('code="415"') ||
    message.includes('Callback URL not approved') ||
    message.includes("oauth_callback value 'oob'") ||
    message.includes('Desktop applications only support')
  );
}

export async function POST(req: NextRequest) {
  try {
    let slot = 1;
    try {
      const body = await req.json();
      slot = normalizeAccountSlot(body?.slot, 1);
    } catch {
      slot = 1;
    }

    const config = await getResolvedXConfig();
    const appBaseUrl = config.appBaseUrl;
    // Keep the callback URL stable (no query params) so it works with strict callback URL locking.
    const callbackUrl = `${appBaseUrl}/api/twitter/auth/callback`;

    let mode: 'callback' | 'oob' = 'callback';
    let oauth_token = '';
    let oauth_token_secret = '';
    let oauth_callback_confirmed = '';

    try {
      ({ oauth_token, oauth_token_secret, oauth_callback_confirmed } = await twitterOAuth.getRequestToken(callbackUrl));
    } catch (callbackError) {
      // Fall back to out-of-band ("oob") for desktop-style apps or strict callback locking.
      // We try this for all callback failures so users can proceed without portal callback tuning.
      mode = 'oob';
      try {
        ({ oauth_token, oauth_token_secret, oauth_callback_confirmed } = await twitterOAuth.getRequestToken('oob'));
      } catch (oobError) {
        const callbackMessage = callbackError instanceof Error ? callbackError.message : String(callbackError);
        const oobMessage = oobError instanceof Error ? oobError.message : String(oobError);
        const likelyCallbackIssue = isOobRequiredError(callbackError);
        const helpHint = likelyCallbackIssue
          ? ' (callback URI configuration is likely the issue)'
          : '';
        throw new Error(
          `Failed to get request token via callback${helpHint}: ${callbackMessage}; and via oob: ${oobMessage}`,
        );
      }
    }

    if (!oauth_callback_confirmed) {
      return NextResponse.json({ error: 'OAuth callback not confirmed' }, { status: 400 });
    }

    // Store the request token + secret per-slot so callback can recover slot even if query params are stripped.
    const cookieStore = cookies();
    cookieStore.set(`twitter_oauth_pending_slot_${slot}`, encodePendingCookie({
      oauthToken: oauth_token,
      oauthTokenSecret: oauth_token_secret,
      createdAt: Date.now(),
    }), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 15, // 15 minutes
      path: '/',
    });

    const authUrl = await twitterOAuth.getAuthorizationUrl(oauth_token);
    const result: Record<string, unknown> = { authUrl, slot };
    if (mode === 'oob') {
      result.mode = 'oob';
      result.oauthToken = oauth_token;
    }

    return NextResponse.json(result);

  } catch (error) {
    console.error('Error starting twitter auth:', error);
    const message = error instanceof Error ? error.message : 'Failed to start Twitter authentication';

    let userMessage = 'Something went wrong. Please try again.';
    if (message.includes('Missing X API key')) {
      userMessage = "API credentials aren't configured yet. Go to Settings to add them.";
    } else if (message.includes('Failed to get request token')) {
      userMessage = 'Could not connect to X. Check your API key and secret in Settings.';
    }

    return NextResponse.json({ error: message, userMessage }, { status: 500 });
  }
} 
