import { getAppSettings } from './app-settings';

const DEFAULT_X_API_BASE_URL = 'https://api.x.com';
const DEFAULT_X_UPLOAD_API_BASE_URL = 'https://upload.twitter.com';

function trimTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function normalizeApiBaseUrl(value: string): string {
  const trimmed = trimTrailingSlash(value);
  return trimmed.replace(/\/(1\.1|2)$/i, '');
}

function firstNonEmpty(...values: Array<string | undefined>): string {
  for (const value of values) {
    if (value && value.trim().length > 0) {
      return value.trim();
    }
  }
  return '';
}

export function getXApiBaseUrl(): string {
  return normalizeApiBaseUrl(firstNonEmpty(process.env.X_API_BASE_URL, DEFAULT_X_API_BASE_URL));
}

export function getXUploadApiBaseUrl(): string {
  return trimTrailingSlash(firstNonEmpty(process.env.X_UPLOAD_API_BASE_URL, DEFAULT_X_UPLOAD_API_BASE_URL));
}

export function getXApiKey(): string {
  return firstNonEmpty(process.env.X_API_KEY, process.env.TWITTER_API_KEY);
}

export function getXApiSecret(): string {
  return firstNonEmpty(process.env.X_API_SECRET, process.env.TWITTER_API_SECRET);
}

export function getXBearerToken(): string {
  return firstNonEmpty(process.env.X_BEARER_TOKEN, process.env.TWITTER_BEARER_TOKEN);
}

export function getAppBaseUrl(): string {
  const fallback = `http://localhost:${process.env.PORT || 3000}`;
  return trimTrailingSlash(firstNonEmpty(process.env.NEXT_PUBLIC_APP_URL, fallback));
}

export interface ResolvedXConfig {
  xApiKey: string;
  xApiSecret: string;
  xBearerToken: string;
  xApiBaseUrl: string;
  xUploadApiBaseUrl: string;
  appBaseUrl: string;
}

export async function getResolvedXConfig(): Promise<ResolvedXConfig> {
  const settings = await getAppSettings([
    'x_api_key',
    'x_api_secret',
    'x_bearer_token',
    'x_api_base_url',
    'x_upload_api_base_url',
    'app_base_url',
  ]);

  const fallbackAppUrl = `http://localhost:${process.env.PORT || 3000}`;

  return {
    xApiKey: firstNonEmpty(process.env.X_API_KEY, process.env.TWITTER_API_KEY, settings.x_api_key),
    xApiSecret: firstNonEmpty(process.env.X_API_SECRET, process.env.TWITTER_API_SECRET, settings.x_api_secret),
    xBearerToken: firstNonEmpty(process.env.X_BEARER_TOKEN, process.env.TWITTER_BEARER_TOKEN, settings.x_bearer_token),
    xApiBaseUrl: normalizeApiBaseUrl(firstNonEmpty(process.env.X_API_BASE_URL, settings.x_api_base_url, DEFAULT_X_API_BASE_URL)),
    xUploadApiBaseUrl: trimTrailingSlash(
      firstNonEmpty(process.env.X_UPLOAD_API_BASE_URL, settings.x_upload_api_base_url, DEFAULT_X_UPLOAD_API_BASE_URL),
    ),
    appBaseUrl: trimTrailingSlash(firstNonEmpty(process.env.NEXT_PUBLIC_APP_URL, settings.app_base_url, fallbackAppUrl)),
  };
}
