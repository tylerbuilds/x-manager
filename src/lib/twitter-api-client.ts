import OAuth from 'oauth-1.0a';
import CryptoJS from 'crypto-js';
import { getResolvedXConfig, type ResolvedXConfig } from './x-config';

interface TwitterApiError {
  message: string;
  type?: string;
}

interface TwitterApiResponse {
  data?: {
    id: string;
    text: string;
  };
  errors?: TwitterApiError[];
}

interface PostTweetRequest {
  text: string;
  media?: {
    media_ids: string[];
  };
  community_id?: string;
  reply?: {
    in_reply_to_tweet_id: string;
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function uniqueMessages(messages: string[]): string[] {
  return [...new Set(messages.map((message) => message.trim()).filter(Boolean))];
}

function normalizeErrorResponse(response: Response, payload: unknown): TwitterApiResponse {
  const record = asRecord(payload);
  const messages: string[] = [];

  const nestedErrors = Array.isArray(record?.errors) ? record.errors : [];
  for (const nestedError of nestedErrors) {
    const errorRecord = asRecord(nestedError);
    const message = asString(errorRecord?.message);
    if (message) {
      messages.push(message);
    }
  }

  const detail = asString(record?.detail);
  if (detail) {
    messages.push(detail);
  }

  const title = asString(record?.title);
  if (title) {
    messages.push(title);
  }

  const problemType = asString(record?.type);
  const accessLevel = response.headers.get('x-access-level');
  const isPermissionScopeError =
    accessLevel === 'read' ||
    (problemType ? problemType.includes('oauth1-permissions') : false);

  if (isPermissionScopeError) {
    messages.push(
      'X app permissions are read-only. In X Developer Portal set User authentication permissions to "Read and write", then disconnect and reconnect this slot.',
    );
  }

  const normalizedMessages = uniqueMessages(messages);
  if (normalizedMessages.length === 0) {
    normalizedMessages.push(`X API request failed with status ${response.status}.`);
  }

  return {
    errors: [
      {
        message: normalizedMessages.join(' '),
        type: problemType || `http_${response.status}`,
      },
    ],
  };
}

async function resolveConfig(config?: ResolvedXConfig): Promise<ResolvedXConfig> {
  if (config) {
    return config;
  }
  return getResolvedXConfig();
}

function createOAuthClient(xApiKey: string, xApiSecret: string): OAuth {
  if (!xApiKey || !xApiSecret) {
    throw new Error('Missing X API credentials. Configure X API key/secret in app settings or environment.');
  }

  return new OAuth({
    consumer: {
      key: xApiKey,
      secret: xApiSecret,
    },
    signature_method: 'HMAC-SHA1',
    hash_function(base_string: string, key: string) {
      return CryptoJS.HmacSHA1(base_string, key).toString(CryptoJS.enc.Base64);
    },
  });
}

function generateOAuthHeaders(
  oauth: OAuth,
  method: string, 
  url: string, 
  accessToken: string, 
  accessTokenSecret: string
): Record<string, string> {
  const token = {
    key: accessToken,
    secret: accessTokenSecret,
  };

  const requestData: OAuth.RequestOptions = {
    url: url,
    method: method,
  };

  // IMPORTANT: For Twitter API v2, do NOT include the request body in the OAuth signature
  // The body should only be included for v1.1 endpoints with form-encoded data
  
  const authHeader = oauth.toHeader(oauth.authorize(requestData, token));

  return {
    'Authorization': authHeader.Authorization,
    'Content-Type': 'application/json',
  };
}

export async function postTweet(
  text: string, 
  accessToken: string, 
  accessTokenSecret: string,
  mediaIds: string[] = [],
  communityId?: string,
  replyToTweetId?: string,
  config?: ResolvedXConfig,
): Promise<TwitterApiResponse> {
  const runtimeConfig = await resolveConfig(config);
  const oauth = createOAuthClient(runtimeConfig.xApiKey, runtimeConfig.xApiSecret);

  const url = `${runtimeConfig.xApiBaseUrl}/2/tweets`;
  const payload: PostTweetRequest = { text };

  if (mediaIds.length > 0) {
    payload.media = {
      media_ids: mediaIds
    };
  }

  if (communityId) {
    payload.community_id = communityId;
  }

  if (replyToTweetId) {
    payload.reply = {
      in_reply_to_tweet_id: replyToTweetId,
    };
  }

  try {
    const headers = generateOAuthHeaders(oauth, 'POST', url, accessToken, accessTokenSecret);
    
    const response = await fetch(url, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(payload)
    });

    const rawBody = await response.text();
    let parsedBody: unknown = null;
    if (rawBody.trim().length > 0) {
      try {
        parsedBody = JSON.parse(rawBody);
      } catch {
        parsedBody = { detail: rawBody };
      }
    }
    
    if (!response.ok) {
      console.error(`Failed to post on X. Status: ${response.status}`);
      console.error(`Response headers:`, Object.fromEntries(response.headers.entries()));
      if (parsedBody) {
        console.error(`Response body:`, JSON.stringify(parsedBody, null, 2));
      } else {
        console.error('Response body: <empty>');
      }
      
      // Add specific error information for common 401 scenarios
      if (response.status === 401) {
        console.error('🔐 401 Unauthorized - Possible causes:');
        console.error('1. Invalid or expired access tokens');
        console.error('2. App permissions not set to "Read and Write"');
        console.error('3. OAuth signature generation error');
          console.error('4. X API credentials mismatch');
      }
      
      return normalizeErrorResponse(response, parsedBody);
    }

    const result = asRecord(parsedBody) as TwitterApiResponse | null;
    if (!result) {
      return {
        errors: [
          {
            message: 'X API returned an empty or invalid response body.',
            type: 'invalid_response',
          },
        ],
      };
    }

    return result;
  } catch (error) {
    console.error('Error posting tweet:', error);
    return { 
      errors: [{ 
        message: error instanceof Error ? error.message : 'Unknown error', 
        type: 'network_error' 
      }] 
    };
  }
}

// NOTE: Media upload for v2 API requires chunked upload and is more complex.
// This is a simplified version for v1.1 endpoint, which is still widely used for media.
// For a full v2 implementation, refer to Twitter's official documentation.
export async function uploadMedia(
  media: Buffer,
  accessToken: string,
  accessTokenSecret: string,
  config?: ResolvedXConfig,
): Promise<{ media_id_string: string } | null> {
  const runtimeConfig = await resolveConfig(config);
  const url = `${runtimeConfig.xUploadApiBaseUrl}/1.1/media/upload.json`;
  
  const token = {
    key: accessToken,
    secret: accessTokenSecret,
  };
  
  // For multipart/form-data, the body is not included in the signature.
  const oauth = createOAuthClient(runtimeConfig.xApiKey, runtimeConfig.xApiSecret);
  const authHeader = oauth.toHeader(oauth.authorize({ url, method: 'POST' }, token));

  const formData = new FormData();
  formData.append('media', new Blob([media as any]));
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': authHeader.Authorization,
        // Content-Type is set automatically by the browser/fetch with FormData
      },
      body: formData,
    });

    const result = await response.json();

    if (!response.ok) {
      console.error(`Failed to upload media. Status: ${response.status}`, result);
      return null;
    }

    return result;

  } catch (error) {
    console.error('Error uploading media:', error);
    return null;
  }
}

type MentionsTimelineItem = {
  id_str?: string;
  full_text?: string;
  text?: string;
  created_at?: string;
  in_reply_to_status_id_str?: string | null;
  user?: {
    id_str?: string;
    screen_name?: string;
    name?: string;
  };
};

type DirectMessageEvent = {
  id?: string;
  created_timestamp?: string;
  message_create?: {
    target?: { recipient_id?: string };
    sender_id?: string;
    message_data?: {
      text?: string;
    };
  };
};

function parseJsonSafe(raw: string): unknown {
  if (!raw.trim()) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return { detail: raw };
  }
}

async function signedJsonRequest<T>(params: {
  method: 'GET' | 'POST';
  url: string;
  accessToken: string;
  accessTokenSecret: string;
  config: ResolvedXConfig;
  body?: unknown;
}): Promise<{ ok: boolean; status: number; data?: T; error?: TwitterApiResponse }> {
  const oauth = createOAuthClient(params.config.xApiKey, params.config.xApiSecret);
  const headers = generateOAuthHeaders(
    oauth,
    params.method,
    params.url,
    params.accessToken,
    params.accessTokenSecret,
  );
  const response = await fetch(params.url, {
    method: params.method,
    headers,
    body: params.body === undefined ? undefined : JSON.stringify(params.body),
  });

  const parsedBody = parseJsonSafe(await response.text());
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: normalizeErrorResponse(response, parsedBody),
    };
  }

  return {
    ok: true,
    status: response.status,
    data: parsedBody as T,
  };
}

async function signedGetWithBaseFallback<T>(params: {
  pathFactory: (baseUrl: string) => string;
  accessToken: string;
  accessTokenSecret: string;
  config: ResolvedXConfig;
}): Promise<T> {
  const baseUrls = [params.config.xApiBaseUrl];
  if (params.config.xApiBaseUrl !== 'https://api.twitter.com') {
    baseUrls.push('https://api.twitter.com');
  }

  let lastError: string | null = null;
  for (const baseUrl of baseUrls) {
    const result = await signedJsonRequest<T>({
      method: 'GET',
      url: params.pathFactory(baseUrl),
      accessToken: params.accessToken,
      accessTokenSecret: params.accessTokenSecret,
      config: params.config,
    });

    if (result.ok && result.data !== undefined) {
      return result.data;
    }

    lastError = result.error?.errors?.[0]?.message || `X request failed (${result.status}).`;
    if (result.status !== 400 && result.status !== 404) {
      break;
    }
  }

  throw new Error(lastError || 'X request failed.');
}

export async function fetchMentionsTimeline(
  accessToken: string,
  accessTokenSecret: string,
  options: {
    count?: number;
    sinceId?: string;
    config?: ResolvedXConfig;
  } = {},
): Promise<Array<{
  sourceId: string;
  text: string;
  authorUserId: string | null;
  authorUsername: string | null;
  createdAt: string | null;
  inReplyToTweetId: string | null;
  raw: unknown;
}>> {
  const config = await resolveConfig(options.config);
  const count = Math.max(1, Math.min(100, Number(options.count || 25)));
  const since = options.sinceId ? `&since_id=${encodeURIComponent(options.sinceId)}` : '';

  const payload = await signedGetWithBaseFallback<MentionsTimelineItem[]>({
    pathFactory: (baseUrl) =>
      `${baseUrl}/1.1/statuses/mentions_timeline.json?count=${count}&tweet_mode=extended${since}`,
    accessToken,
    accessTokenSecret,
    config,
  });

  return (payload || [])
    .map((item) => ({
      sourceId: item.id_str || '',
      text: item.full_text || item.text || '',
      authorUserId: item.user?.id_str || null,
      authorUsername: item.user?.screen_name || null,
      createdAt: item.created_at || null,
      inReplyToTweetId: item.in_reply_to_status_id_str || null,
      raw: item,
    }))
    .filter((item) => item.sourceId && item.text);
}

export async function listDirectMessages(
  accessToken: string,
  accessTokenSecret: string,
  options: {
    count?: number;
    cursor?: string;
    config?: ResolvedXConfig;
  } = {},
): Promise<Array<{
  sourceId: string;
  text: string;
  senderUserId: string | null;
  recipientUserId: string | null;
  createdAt: string | null;
  raw: unknown;
}>> {
  const config = await resolveConfig(options.config);
  const count = Math.max(1, Math.min(50, Number(options.count || 25)));
  const cursorPart = options.cursor ? `&cursor=${encodeURIComponent(options.cursor)}` : '';

  const payload = await signedGetWithBaseFallback<{ events?: DirectMessageEvent[] }>({
    pathFactory: (baseUrl) =>
      `${baseUrl}/1.1/direct_messages/events/list.json?count=${count}${cursorPart}`,
    accessToken,
    accessTokenSecret,
    config,
  });

  return (payload.events || [])
    .map((event) => ({
      sourceId: event.id || '',
      text: event.message_create?.message_data?.text || '',
      senderUserId: event.message_create?.sender_id || null,
      recipientUserId: event.message_create?.target?.recipient_id || null,
      createdAt: event.created_timestamp ? new Date(Number(event.created_timestamp)).toISOString() : null,
      raw: event,
    }))
    .filter((item) => item.sourceId && item.text);
}

export async function sendDirectMessage(
  accessToken: string,
  accessTokenSecret: string,
  recipientUserId: string,
  text: string,
  configInput?: ResolvedXConfig,
): Promise<{ eventId: string | null }> {
  const config = await resolveConfig(configInput);
  const baseUrls = [config.xApiBaseUrl];
  if (config.xApiBaseUrl !== 'https://api.twitter.com') {
    baseUrls.push('https://api.twitter.com');
  }

  let lastError: string | null = null;

  for (const baseUrl of baseUrls) {
    const result = await signedJsonRequest<{ event?: { id?: string } }>({
      method: 'POST',
      url: `${baseUrl}/1.1/direct_messages/events/new.json`,
      accessToken,
      accessTokenSecret,
      config,
      body: {
        event: {
          type: 'message_create',
          message_create: {
            target: { recipient_id: recipientUserId },
            message_data: { text },
          },
        },
      },
    });

    if (result.ok) {
      return { eventId: result.data?.event?.id || null };
    }

    lastError = result.error?.errors?.[0]?.message || `X request failed (${result.status}).`;
    if (result.status !== 400 && result.status !== 404) {
      break;
    }
  }

  throw new Error(lastError || 'Failed to send direct message.');
}

export async function likeTweet(
  accessToken: string,
  accessTokenSecret: string,
  userId: string,
  tweetId: string,
  configInput?: ResolvedXConfig,
): Promise<void> {
  const config = await resolveConfig(configInput);
  const result = await signedJsonRequest({
    method: 'POST',
    url: `${config.xApiBaseUrl}/2/users/${encodeURIComponent(userId)}/likes`,
    accessToken,
    accessTokenSecret,
    config,
    body: { tweet_id: tweetId },
  });
  if (!result.ok) {
    throw new Error(result.error?.errors?.[0]?.message || 'Failed to like tweet.');
  }
}

export async function repostTweet(
  accessToken: string,
  accessTokenSecret: string,
  userId: string,
  tweetId: string,
  configInput?: ResolvedXConfig,
): Promise<void> {
  const config = await resolveConfig(configInput);
  const result = await signedJsonRequest({
    method: 'POST',
    url: `${config.xApiBaseUrl}/2/users/${encodeURIComponent(userId)}/retweets`,
    accessToken,
    accessTokenSecret,
    config,
    body: { tweet_id: tweetId },
  });
  if (!result.ok) {
    throw new Error(result.error?.errors?.[0]?.message || 'Failed to repost tweet.');
  }
}
