import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { assertPublicUrl } from '@/lib/network-safety';

const MAX_HTML_BYTES = 2_000_000;
const MAX_IMAGE_BYTES = 8_000_000;

export interface ExtractedArticle {
  url: string;
  canonicalUrl: string;
  title: string;
  description: string;
  imageUrls: string[];
  quoteCandidates: string[];
  excerpt: string;
}

export interface DraftTweet {
  text: string;
  media_urls?: string[];
}

export interface DraftThread {
  source_url: string;
  tweets: DraftTweet[];
}

const ENTITY_MAP: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function decodeHtmlEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (_, raw: string) => {
    if (raw.startsWith('#x') || raw.startsWith('#X')) {
      const code = Number.parseInt(raw.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _;
    }
    if (raw.startsWith('#')) {
      const code = Number.parseInt(raw.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _;
    }
    return ENTITY_MAP[raw] ?? _;
  });
}

function normalizeWhitespace(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

function stripTags(input: string): string {
  const withoutScripts = input
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ');
  return withoutScripts.replace(/<[^>]+>/g, ' ');
}

function cleanHtmlText(input: string): string {
  return normalizeWhitespace(decodeHtmlEntities(stripTags(input)));
}

function parseAttributes(tagHtml: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const regex = /([^\s"'=<>`]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  let match: RegExpExecArray | null = null;
  while ((match = regex.exec(tagHtml)) !== null) {
    const key = match[1].toLowerCase();
    const value = match[3] ?? match[4] ?? match[5] ?? '';
    attrs[key] = value;
  }
  return attrs;
}

function toAbsoluteUrl(baseUrl: string, value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('javascript:')) return null;
  try {
    const resolved = new URL(trimmed, baseUrl);
    if (!['http:', 'https:'].includes(resolved.protocol)) {
      return null;
    }
    return resolved.toString();
  } catch {
    return null;
  }
}

function truncate(input: string, maxChars: number): string {
  if (input.length <= maxChars) return input;
  if (maxChars <= 3) return input.slice(0, maxChars);
  return `${input.slice(0, maxChars - 3).trimEnd()}...`;
}

function splitSentences(input: string): string[] {
  const normalized = normalizeWhitespace(input);
  if (!normalized) return [];
  const sentences = normalized.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [];
  return sentences.map((sentence) => normalizeWhitespace(sentence)).filter(Boolean);
}

function collectMetaContent(html: string): Record<string, string> {
  const result: Record<string, string> = {};
  const metaTags = html.match(/<meta\b[^>]*>/gi) ?? [];

  for (const tag of metaTags) {
    const attrs = parseAttributes(tag);
    const keyRaw = attrs.property || attrs.name;
    const content = attrs.content;
    if (!keyRaw || !content) continue;
    result[keyRaw.toLowerCase()] = content;
  }

  return result;
}

function extractCanonicalUrl(html: string, pageUrl: string, meta: Record<string, string>): string {
  const fromOgUrl = toAbsoluteUrl(pageUrl, meta['og:url']);
  if (fromOgUrl) return fromOgUrl;

  const linkTags = html.match(/<link\b[^>]*>/gi) ?? [];
  for (const tag of linkTags) {
    const attrs = parseAttributes(tag);
    if (attrs.rel?.toLowerCase() !== 'canonical') continue;
    const href = toAbsoluteUrl(pageUrl, attrs.href);
    if (href) return href;
  }

  return pageUrl;
}

function extractImageUrls(html: string, baseUrl: string, maxImages: number): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();

  const articleMatch = html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i);
  const htmlForImages = articleMatch?.[1] ?? html;

  const imgTags = htmlForImages.match(/<img\b[^>]*>/gi) ?? [];
  for (const tag of imgTags) {
    const attrs = parseAttributes(tag);
    const resolved = toAbsoluteUrl(baseUrl, attrs.src || attrs['data-src'] || attrs['data-original']);
    if (!resolved) continue;
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    urls.push(resolved);
    if (urls.length >= maxImages) return urls;
  }

  const meta = collectMetaContent(html);
  const ogImage = toAbsoluteUrl(baseUrl, meta['og:image']);
  if (ogImage && !seen.has(ogImage) && urls.length < maxImages) {
    urls.unshift(ogImage);
  }

  return urls.slice(0, maxImages);
}

function extractParagraphText(html: string): string[] {
  const articleMatch = html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i);
  const source = articleMatch?.[1] ?? html;
  const paragraphs = [...source.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((match) => cleanHtmlText(match[1]))
    .filter((value) => value.length > 40);
  return paragraphs;
}

function extractQuoteCandidates(html: string, paragraphs: string[], maxQuotes: number): string[] {
  const articleMatch = html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i);
  const source = articleMatch?.[1] ?? html;
  const quotes = [...source.matchAll(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi)]
    .map((match) => cleanHtmlText(match[1]))
    .filter((value) => value.length >= 60 && value.length <= 240);

  const sentenceCandidates: string[] = [];
  for (const paragraph of paragraphs) {
    for (const sentence of splitSentences(paragraph)) {
      if (sentence.length < 60 || sentence.length > 240) continue;
      const lowered = sentence.toLowerCase();
      if (lowered.includes('cookie') || lowered.includes('subscribe') || lowered.includes('newsletter')) continue;
      if (lowered.includes('http://') || lowered.includes('https://')) continue;
      sentenceCandidates.push(sentence);
    }
  }

  const merged = [...quotes, ...sentenceCandidates];
  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const candidate of merged) {
    const normalized = candidate.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    deduped.push(candidate.replace(/^["'`]+|["'`]+$/g, ''));
    if (deduped.length >= maxQuotes) break;
  }

  return deduped;
}

export async function fetchAndExtractArticle(articleUrl: string): Promise<ExtractedArticle> {
  assertPublicUrl(articleUrl);

  const response = await fetch(articleUrl, {
    redirect: 'manual',
    headers: {
      'User-Agent': 'x-manager/0.1 (+thread-builder)',
      Accept: 'text/html,application/xhtml+xml',
    },
  });

  // Follow redirects manually so we can validate each hop against SSRF.
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    const location = response.headers.get('location');
    if (!location) throw new Error('Redirect with no Location header.');
    const resolved = new URL(location, articleUrl).href;
    assertPublicUrl(resolved);
    return fetchAndExtractArticle(resolved);
  }

  if (!response.ok) {
    throw new Error(`Failed to fetch article (${response.status}).`);
  }

  const html = await response.text();
  if (!html || html.length > MAX_HTML_BYTES) {
    throw new Error('Article HTML is empty or too large.');
  }

  const meta = collectMetaContent(html);
  const titleFromMeta = meta['og:title'] || meta['twitter:title'] || '';
  const titleFromTag = cleanHtmlText((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? ''));
  const title = normalizeWhitespace(decodeHtmlEntities(titleFromMeta || titleFromTag || 'Untitled article'));
  const description = normalizeWhitespace(
    decodeHtmlEntities(meta['og:description'] || meta['description'] || meta['twitter:description'] || ''),
  );

  const canonicalUrl = extractCanonicalUrl(html, articleUrl, meta);
  const imageUrls = extractImageUrls(html, articleUrl, 12);
  const paragraphs = extractParagraphText(html);
  const quoteCandidates = extractQuoteCandidates(html, paragraphs, 12);
  const excerpt = truncate(paragraphs.join(' '), 12_000);

  return {
    url: articleUrl,
    canonicalUrl,
    title,
    description,
    imageUrls,
    quoteCandidates,
    excerpt,
  };
}

function extensionFromContentType(contentType: string | null): string {
  const value = (contentType || '').toLowerCase();
  if (value.includes('image/jpeg')) return 'jpg';
  if (value.includes('image/png')) return 'png';
  if (value.includes('image/webp')) return 'webp';
  if (value.includes('image/gif')) return 'gif';
  if (value.includes('image/avif')) return 'avif';
  if (value.includes('image/svg')) return 'svg';
  return '';
}

function extensionFromUrl(imageUrl: string): string {
  try {
    const pathname = new URL(imageUrl).pathname.toLowerCase();
    const ext = pathname.split('.').pop() || '';
    if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif'].includes(ext)) {
      return ext === 'jpeg' ? 'jpg' : ext;
    }
  } catch {
    // ignore
  }
  return 'jpg';
}

export async function downloadRemoteImages(imageUrls: string[], maxCount: number): Promise<string[]> {
  const saved: string[] = [];
  if (maxCount <= 0) return saved;

  const uploadDir = path.join(process.cwd(), 'public', 'uploads');
  await fs.mkdir(uploadDir, { recursive: true });

  for (const imageUrl of imageUrls) {
    if (saved.length >= maxCount) break;

    try {
      assertPublicUrl(imageUrl);

      const response = await fetch(imageUrl, {
        redirect: 'manual',
        headers: {
          'User-Agent': 'x-manager/0.1 (+thread-builder)',
          Accept: 'image/*',
        },
      });

      // Skip redirects that point to private addresses instead of following blindly.
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        if (!location) continue;
        const resolved = new URL(location, imageUrl).href;
        assertPublicUrl(resolved);
        // Re-fetch from the validated redirect target.
        const redirected = await fetch(resolved, {
          redirect: 'manual',
          headers: { 'User-Agent': 'x-manager/0.1 (+thread-builder)', Accept: 'image/*' },
        });
        if (!redirected.ok) continue;
        const ct = redirected.headers.get('content-type');
        if (!ct?.toLowerCase().startsWith('image/')) continue;
        if ((ct || '').toLowerCase().includes('svg')) continue;
        const buf = await redirected.arrayBuffer();
        if (buf.byteLength === 0 || buf.byteLength > MAX_IMAGE_BYTES) continue;
        const ext2 = extensionFromContentType(ct) || extensionFromUrl(resolved);
        const fname = `${Date.now()}-${crypto.randomUUID().slice(0, 10)}.${ext2}`;
        await fs.writeFile(path.join(uploadDir, fname), Buffer.from(buf));
        saved.push(`/uploads/${fname}`);
        continue;
      }

      if (!response.ok) continue;

      const contentType = response.headers.get('content-type');
      if (!contentType?.toLowerCase().startsWith('image/')) continue;
      if ((contentType || '').toLowerCase().includes('svg')) continue;

      const arrayBuffer = await response.arrayBuffer();
      if (arrayBuffer.byteLength === 0 || arrayBuffer.byteLength > MAX_IMAGE_BYTES) continue;

      const ext = extensionFromContentType(contentType) || extensionFromUrl(imageUrl);
      const filename = `${Date.now()}-${crypto.randomUUID().slice(0, 10)}.${ext}`;
      await fs.writeFile(path.join(uploadDir, filename), Buffer.from(arrayBuffer));
      saved.push(`/uploads/${filename}`);
    } catch {
      // Ignore image download failures.
    }
  }

  return saved;
}

export function buildThreadDraft(
  article: ExtractedArticle,
  mediaUrls: string[],
  maxTweetsInput: number,
): DraftThread {
  const maxTweets = Math.max(2, Math.min(12, Math.floor(maxTweetsInput || 6)));
  const sourceUrl = article.canonicalUrl || article.url;
  const tweets: DraftTweet[] = [];

  const firstTweet = truncate(`${article.title}\n\n${sourceUrl}`, 280);
  tweets.push({ text: firstTweet });

  const maxQuoteTweets = Math.max(0, maxTweets - 2);
  let mediaIndex = 0;
  const quoteCandidates = article.quoteCandidates.slice(0, maxQuoteTweets);

  for (const quote of quoteCandidates) {
    const text = truncate(`"${quote}"`, 280);
    const media = mediaUrls[mediaIndex] ? [mediaUrls[mediaIndex]] : undefined;
    if (media) {
      mediaIndex += 1;
    }
    tweets.push(media ? { text, media_urls: media } : { text });
  }

  if (tweets.length < maxTweets) {
    const cta = truncate(`Read the full article: ${sourceUrl}`, 280);
    tweets.push({ text: cta });
  }

  return {
    source_url: sourceUrl,
    tweets: tweets.slice(0, maxTweets),
  };
}
