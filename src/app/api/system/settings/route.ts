import { NextResponse } from 'next/server';
import { getAppSettings, summarizeSettingsForClient, upsertAppSettings } from '@/lib/app-settings';
import { getResolvedXConfig } from '@/lib/x-config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface UpdateSettingsBody {
  xApiKey?: string;
  xApiSecret?: string;
  xBearerToken?: string;
  appBaseUrl?: string;
  xApiBaseUrl?: string;
  xUploadApiBaseUrl?: string;
}

function normalizeUrlOrEmpty(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('Invalid protocol');
    }
    return parsed.toString().replace(/\/$/, '');
  } catch {
    throw new Error(`Invalid URL: ${trimmed}`);
  }
}

function hasEnvValue(value?: string): boolean {
  return Boolean(value && value.trim().length > 0);
}

export async function GET() {
  try {
    const [stored, resolved] = await Promise.all([
      getAppSettings(),
      getResolvedXConfig(),
    ]);

    const summary = summarizeSettingsForClient(stored);

    return NextResponse.json({
      settings: {
        ...summary,
        appBaseUrl: summary.appBaseUrl || resolved.appBaseUrl,
        xApiBaseUrl: summary.xApiBaseUrl || resolved.xApiBaseUrl,
        xUploadApiBaseUrl: summary.xUploadApiBaseUrl || resolved.xUploadApiBaseUrl,
      },
      envOverrides: {
        xApiKey: hasEnvValue(process.env.X_API_KEY) || hasEnvValue(process.env.TWITTER_API_KEY),
        xApiSecret: hasEnvValue(process.env.X_API_SECRET) || hasEnvValue(process.env.TWITTER_API_SECRET),
        xBearerToken: hasEnvValue(process.env.X_BEARER_TOKEN) || hasEnvValue(process.env.TWITTER_BEARER_TOKEN),
        appBaseUrl: hasEnvValue(process.env.NEXT_PUBLIC_APP_URL),
        xApiBaseUrl: hasEnvValue(process.env.X_API_BASE_URL),
        xUploadApiBaseUrl: hasEnvValue(process.env.X_UPLOAD_API_BASE_URL),
      },
    });
  } catch (error) {
    console.error('Error fetching system settings:', error);
    return NextResponse.json({ error: 'Failed to fetch settings.' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const body = (await req.json()) as UpdateSettingsBody;

    const appBaseUrl = normalizeUrlOrEmpty(body.appBaseUrl);
    const xApiBaseUrl = normalizeUrlOrEmpty(body.xApiBaseUrl);
    const xUploadApiBaseUrl = normalizeUrlOrEmpty(body.xUploadApiBaseUrl);

    await upsertAppSettings({
      x_api_key: body.xApiKey,
      x_api_secret: body.xApiSecret,
      x_bearer_token: body.xBearerToken,
      app_base_url: appBaseUrl,
      x_api_base_url: xApiBaseUrl,
      x_upload_api_base_url: xUploadApiBaseUrl,
    });

    const [stored, resolved] = await Promise.all([
      getAppSettings(),
      getResolvedXConfig(),
    ]);

    const summary = summarizeSettingsForClient(stored);

    return NextResponse.json({
      message: 'Settings saved.',
      settings: {
        ...summary,
        appBaseUrl: summary.appBaseUrl || resolved.appBaseUrl,
        xApiBaseUrl: summary.xApiBaseUrl || resolved.xApiBaseUrl,
        xUploadApiBaseUrl: summary.xUploadApiBaseUrl || resolved.xUploadApiBaseUrl,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update settings.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
