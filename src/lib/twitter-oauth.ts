import OAuth from 'oauth-1.0a';
import CryptoJS from 'crypto-js';
import { getResolvedXConfig } from './x-config';

const OAUTH1_FALLBACK_BASE_URL = 'https://api.twitter.com';

interface TwitterRequestTokenResponse {
  oauth_token: string;
  oauth_token_secret: string;
  oauth_callback_confirmed: string;
}

interface TwitterAccessTokenResponse {
  oauth_token: string;
  oauth_token_secret: string;
  user_id: string;
  screen_name: string;
}

interface TwitterUserResponse {
  id: number;
  id_str: string;
  name: string;
  screen_name: string;
  location: string;
  description: string;
  followers_count: number;
  friends_count: number;
  profile_image_url_https: string;
  verified: boolean;
}

interface OAuthContext {
  oauth: OAuth;
  xApiBaseUrl: string;
}

async function createOAuthContext(): Promise<OAuthContext> {
  const config = await getResolvedXConfig();

  if (!config.xApiKey || !config.xApiSecret) {
    throw new Error('Missing X API key/secret. Configure credentials in app settings or environment.');
  }

  const oauth = new OAuth({
    consumer: {
      key: config.xApiKey,
      secret: config.xApiSecret,
    },
    signature_method: 'HMAC-SHA1',
    hash_function(base_string: string, key: string) {
      return CryptoJS.HmacSHA1(base_string, key).toString(CryptoJS.enc.Base64);
    },
  });

  return {
    oauth,
    xApiBaseUrl: config.xApiBaseUrl,
  };
}

class TwitterOAuthService {
  async getRequestToken(callbackUrl: string): Promise<TwitterRequestTokenResponse> {
    const { oauth, xApiBaseUrl } = await createOAuthContext();
    const baseUrls = [xApiBaseUrl];
    if (xApiBaseUrl !== OAUTH1_FALLBACK_BASE_URL) {
      baseUrls.push(OAUTH1_FALLBACK_BASE_URL);
    }

    let lastError: Error | null = null;

    for (const baseUrl of baseUrls) {
      const requestData = {
        url: `${baseUrl}/oauth/request_token`,
        method: 'POST' as const,
        data: { oauth_callback: callbackUrl },
      };

      const authorizationData = oauth.authorize(requestData);
      const headers = oauth.toHeader(authorizationData);

      const response = await fetch(requestData.url, {
        method: 'POST',
        headers: {
          Authorization: headers.Authorization,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ oauth_callback: callbackUrl }).toString(),
      });

      const responseText = await response.text();

      if (!response.ok) {
        lastError = new Error(`Failed to get request token (${response.status}) via ${baseUrl}: ${responseText}`);
        continue;
      }

      const params = new URLSearchParams(responseText);
      const oauthToken = params.get('oauth_token') || '';
      const oauthTokenSecret = params.get('oauth_token_secret') || '';
      const oauthCallbackConfirmed = params.get('oauth_callback_confirmed') || 'false';

      if (!oauthToken || !oauthTokenSecret) {
        lastError = new Error(`Request token response missing oauth token values via ${baseUrl}: ${responseText}`);
        continue;
      }

      return {
        oauth_token: oauthToken,
        oauth_token_secret: oauthTokenSecret,
        oauth_callback_confirmed: oauthCallbackConfirmed,
      };
    }

    throw lastError || new Error('Failed to get request token.');
  }

  async getAuthorizationUrl(oauthToken: string): Promise<string> {
    const { xApiBaseUrl } = await createOAuthContext();
    return `${xApiBaseUrl}/oauth/authorize?oauth_token=${oauthToken}`;
  }

  async getAccessToken(
    oauthToken: string,
    oauthTokenSecret: string,
    oauthVerifier: string,
  ): Promise<TwitterAccessTokenResponse> {
    const { oauth, xApiBaseUrl } = await createOAuthContext();
    const baseUrls = [xApiBaseUrl];
    if (xApiBaseUrl !== OAUTH1_FALLBACK_BASE_URL) {
      baseUrls.push(OAUTH1_FALLBACK_BASE_URL);
    }

    let lastError: Error | null = null;
    const token = {
      key: oauthToken,
      secret: oauthTokenSecret,
    };

    for (const baseUrl of baseUrls) {
      const requestData = {
        url: `${baseUrl}/oauth/access_token`,
        method: 'POST' as const,
      };

      const headers = oauth.toHeader(oauth.authorize(requestData, token));
      const response = await fetch(requestData.url, {
        method: 'POST',
        headers: {
          Authorization: headers.Authorization,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ oauth_verifier: oauthVerifier }).toString(),
      });

      const responseText = await response.text();
      if (!response.ok) {
        lastError = new Error(`Failed to get access token (${response.status}) via ${baseUrl}: ${responseText}`);
        continue;
      }

      const params = new URLSearchParams(responseText);
      const resolvedOauthToken = params.get('oauth_token') || '';
      const resolvedOauthTokenSecret = params.get('oauth_token_secret') || '';
      const userId = params.get('user_id') || '';
      const screenName = params.get('screen_name') || '';

      if (!resolvedOauthToken || !resolvedOauthTokenSecret) {
        lastError = new Error(`Access token response missing oauth token values via ${baseUrl}: ${responseText}`);
        continue;
      }

      return {
        oauth_token: resolvedOauthToken,
        oauth_token_secret: resolvedOauthTokenSecret,
        user_id: userId,
        screen_name: screenName,
      };
    }

    throw lastError || new Error('Failed to get access token.');
  }

  async getUserProfile(accessToken: string, accessTokenSecret: string): Promise<TwitterUserResponse> {
    const { oauth, xApiBaseUrl } = await createOAuthContext();
    const baseUrls = [xApiBaseUrl];
    if (xApiBaseUrl !== OAUTH1_FALLBACK_BASE_URL) {
      baseUrls.push(OAUTH1_FALLBACK_BASE_URL);
    }

    const token = {
      key: accessToken,
      secret: accessTokenSecret,
    };

    let lastError: Error | null = null;

    for (const baseUrl of baseUrls) {
      const requestData = {
        url: `${baseUrl}/1.1/account/verify_credentials.json`,
        method: 'GET' as const,
      };

      const headers = oauth.toHeader(oauth.authorize(requestData, token));

      const response = await fetch(requestData.url, {
        method: 'GET',
        headers: {
          Authorization: headers.Authorization,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        lastError = new Error(`Failed to get user profile (${response.status}) via ${baseUrl}: ${errorText}`);
        continue;
      }

      return (await response.json()) as TwitterUserResponse;
    }

    throw lastError || new Error('Failed to get user profile.');
  }
}

export const twitterOAuth = new TwitterOAuthService();
export type { TwitterRequestTokenResponse, TwitterAccessTokenResponse, TwitterUserResponse };
