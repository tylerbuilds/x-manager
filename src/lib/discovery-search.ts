import { and, eq, gt } from 'drizzle-orm';
import { db } from './db';
import { topicSearchCache } from './db/schema';
import { getResolvedXConfig } from './x-config';

const DEFAULT_RESULT_LIMIT = 10;
const MAX_RESULT_LIMIT = 25;
const MIN_X_RECENT_SEARCH_RESULTS = 10;
const MAX_KEYWORDS = 8;
const CACHE_TTL_MINUTES = 15;

type XPublicMetrics = {
  like_count?: number;
  reply_count?: number;
  repost_count?: number;
  retweet_count?: number;
  quote_count?: number;
};

type XPost = {
  id: string;
  text: string;
  author_id?: string;
  created_at?: string;
  lang?: string;
  public_metrics?: XPublicMetrics;
};

type XUser = {
  id: string;
  username?: string;
  name?: string;
  verified?: boolean;
};

type XSearchResponse = {
  data?: XPost[];
  includes?: {
    users?: XUser[];
  };
  title?: string;
  detail?: string;
};

export type DiscoveryTopic = {
  id: string;
  text: string;
  url: string;
  author: {
    id: string;
    username: string | null;
    name: string | null;
    verified: boolean;
  };
  createdAt: string | null;
  language: string | null;
  metrics: {
    likes: number;
    replies: number;
    reposts: number;
    quotes: number;
  };
  relevanceScore: number;
  suggestedReplyStarter: string;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function sanitizeDiscoveryKeywords(input: string[] | string): string[] {
  const list = Array.isArray(input) ? input : input.split(',');
  return list
    .map((part) => part.trim())
    .filter(Boolean)
    .map((keyword) => keyword.replace(/"/g, ''))
    .slice(0, MAX_KEYWORDS);
}

function quoteKeyword(keyword: string): string {
  return `"${keyword}"`;
}

function buildQuery(keywords: string[], language: string | null): string {
  const keywordQuery =
    keywords.length === 1
      ? quoteKeyword(keywords[0])
      : `(${keywords.map(quoteKeyword).join(' OR ')})`;

  const languageFilter = language ? ` lang:${language}` : '';
  return `${keywordQuery}${languageFilter} -is:retweet`;
}

function createReplyStarter(text: string, keywords: string[]): string {
  const opener = keywords[0] || 'this topic';
  const snippet = text.replace(/\s+/g, ' ').trim().slice(0, 90);
  return `Interesting take on ${opener}. I agree with parts of "${snippet}" and would add: `;
}

function scorePost(post: XPost): number {
  const metrics = post.public_metrics ?? {};
  const likes = metrics.like_count ?? 0;
  const replies = metrics.reply_count ?? 0;
  const reposts = metrics.repost_count ?? metrics.retweet_count ?? 0;
  const quotes = metrics.quote_count ?? 0;
  const engagement = likes * 3 + replies * 5 + reposts * 2 + quotes * 2;
  const createdAt = post.created_at ? new Date(post.created_at).getTime() : Date.now();
  const ageHours = Math.max(1, (Date.now() - createdAt) / (1000 * 60 * 60));
  return Number((engagement / Math.pow(ageHours, 0.65)).toFixed(2));
}

function buildTopic(post: XPost, userById: Map<string, XUser>, keywords: string[]): DiscoveryTopic {
  const user = post.author_id ? userById.get(post.author_id) : undefined;
  const username = user?.username || null;
  const likes = post.public_metrics?.like_count ?? 0;
  const replies = post.public_metrics?.reply_count ?? 0;
  const reposts = post.public_metrics?.repost_count ?? post.public_metrics?.retweet_count ?? 0;
  const quotes = post.public_metrics?.quote_count ?? 0;

  return {
    id: post.id,
    text: post.text,
    url: username ? `https://x.com/${username}/status/${post.id}` : `https://x.com/i/web/status/${post.id}`,
    author: {
      id: post.author_id || 'unknown',
      username,
      name: user?.name || null,
      verified: Boolean(user?.verified),
    },
    createdAt: post.created_at || null,
    language: post.lang || null,
    metrics: { likes, replies, reposts, quotes },
    relevanceScore: scorePost(post),
    suggestedReplyStarter: createReplyStarter(post.text, keywords),
  };
}

function buildSearchUrls(baseUrl: string, query: string, limit: number): string[] {
  const encodedQuery = encodeURIComponent(query);
  const expansions = 'author_id';
  const userFields = 'id,name,username,verified';
  const common =
    `?query=${encodedQuery}` +
    `&max_results=${limit}` +
    `&expansions=${expansions}` +
    `&user.fields=${userFields}`;

  return [
    `${baseUrl}/2/tweets/search/recent${common}&tweet.fields=id,text,author_id,created_at,lang,public_metrics`,
    `${baseUrl}/2/posts/search/recent${common}&post.fields=id,text,author_id,created_at,lang,public_metrics`,
  ];
}

async function fetchSearchResults(urls: string[], bearerToken: string): Promise<Response> {
  let lastResponse: Response | null = null;

  for (const url of urls) {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${bearerToken}` },
      cache: 'no-store',
    });

    if (response.ok) {
      return response;
    }

    lastResponse = response;
    if (response.status !== 400 && response.status !== 404) {
      return response;
    }
  }

  if (!lastResponse) {
    throw new Error('No response from X search endpoint.');
  }

  return lastResponse;
}

export async function searchDiscoveryTopics(options: {
  keywords: string[] | string;
  language?: string | null;
  limit?: number;
}): Promise<{
  query: string;
  topics: DiscoveryTopic[];
  count: number;
  source: 'cache' | 'live';
}> {
  const config = await getResolvedXConfig();
  const keywords = sanitizeDiscoveryKeywords(options.keywords);
  const language = options.language ?? 'en';
  const requestedLimit = Number(options.limit ?? DEFAULT_RESULT_LIMIT);
  const limit = clamp(Number.isFinite(requestedLimit) ? requestedLimit : DEFAULT_RESULT_LIMIT, 1, MAX_RESULT_LIMIT);

  if (keywords.length === 0) {
    throw new Error('Missing keywords.');
  }

  if (!config.xBearerToken) {
    throw new Error('Missing X bearer token. Configure it in app settings or environment.');
  }

  const query = buildQuery(keywords, language);
  const cacheKey = JSON.stringify({ query, limit });
  const now = new Date();

  const cached = await db
    .select()
    .from(topicSearchCache)
    .where(and(eq(topicSearchCache.cacheKey, cacheKey), gt(topicSearchCache.expiresAt, now)))
    .limit(1);

  if (cached[0]) {
    const parsed = JSON.parse(cached[0].payload) as { query: string; topics: DiscoveryTopic[]; count: number };
    return { ...parsed, source: 'cache' };
  }

  const xMaxResults = clamp(limit, MIN_X_RECENT_SEARCH_RESULTS, 100);
  const response = await fetchSearchResults(buildSearchUrls(config.xApiBaseUrl, query, xMaxResults), config.xBearerToken);
  const payload = await response.json() as XSearchResponse;

  if (!response.ok) {
    throw new Error(payload.detail || payload.title || 'X topic discovery request failed.');
  }

  const posts = Array.isArray(payload.data) ? payload.data : [];
  const users = Array.isArray(payload.includes?.users) ? payload.includes.users : [];
  const userById = new Map(users.map((user) => [user.id, user]));
  const topics = posts
    .map((post) => buildTopic(post, userById, keywords))
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, limit);

  const result = { query, topics, count: topics.length };
  await db.insert(topicSearchCache).values({
    cacheKey,
    query,
    payload: JSON.stringify(result),
    expiresAt: new Date(Date.now() + CACHE_TTL_MINUTES * 60 * 1000),
  }).onConflictDoUpdate({
    target: topicSearchCache.cacheKey,
    set: {
      payload: JSON.stringify(result),
      expiresAt: new Date(Date.now() + CACHE_TTL_MINUTES * 60 * 1000),
      updatedAt: new Date(),
    },
  });

  return { ...result, source: 'live' };
}
