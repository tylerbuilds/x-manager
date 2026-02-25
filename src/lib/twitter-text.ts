/**
 * Twitter character counting utilities.
 *
 * Twitter wraps every URL (http/https) in a t.co shortener that always counts
 * as exactly 23 characters, regardless of the original URL length.
 * See: https://developer.x.com/en/docs/counting-characters
 */

const TWITTER_URL_WEIGHT = 23;

// Matches http:// and https:// URLs in tweet text.
// Simplified but sufficient for our use case (we always have well-formed URLs).
const URL_RE = /https?:\/\/[^\s)}\]]+/g;

/**
 * Calculate the Twitter-weighted length of a tweet.
 * URLs (http/https) count as 23 characters each.
 */
export function twitterWeightedLength(text: string): number {
  let length = text.length;
  for (const match of text.matchAll(URL_RE)) {
    // Subtract the raw URL length, add the fixed Twitter weight.
    length += TWITTER_URL_WEIGHT - match[0].length;
  }
  return length;
}

/**
 * Truncate text for Twitter, never breaking URLs.
 *
 * Strategy: if the weighted length is within the limit, return as-is.
 * Otherwise, find all URLs in the text and shorten the non-URL portions.
 * URLs are kept intact since Twitter counts them as 23 chars regardless.
 */
export function truncateForTwitter(text: string, maxWeighted = 280): string {
  if (twitterWeightedLength(text) <= maxWeighted) return text;

  // Split the text into segments: alternating non-URL and URL parts.
  const urls: { start: number; end: number; text: string }[] = [];
  for (const match of text.matchAll(URL_RE)) {
    urls.push({ start: match.index!, end: match.index! + match[0].length, text: match[0] });
  }

  if (urls.length === 0) {
    // No URLs - simple truncation with ellipsis.
    if (maxWeighted <= 3) return text.slice(0, maxWeighted);
    return `${text.slice(0, maxWeighted - 3).trimEnd()}...`;
  }

  // Build segments: [nonUrl, url, nonUrl, url, ..., nonUrl]
  const segments: { text: string; isUrl: boolean }[] = [];
  let cursor = 0;
  for (const url of urls) {
    if (url.start > cursor) {
      segments.push({ text: text.slice(cursor, url.start), isUrl: false });
    }
    segments.push({ text: url.text, isUrl: true });
    cursor = url.end;
  }
  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), isUrl: false });
  }

  // Calculate how much weighted space the URLs consume.
  const urlWeightedTotal = urls.length * TWITTER_URL_WEIGHT;
  // Budget for non-URL text (minus 3 for ellipsis).
  const nonUrlBudget = maxWeighted - urlWeightedTotal - 3;

  if (nonUrlBudget <= 0) {
    // Extreme edge case: URLs alone exceed the limit. Keep only the first URL.
    return urls[0].text;
  }

  // Distribute the non-URL budget across non-URL segments proportionally.
  const nonUrlSegments = segments.filter((s) => !s.isUrl);
  const totalNonUrlChars = nonUrlSegments.reduce((sum, s) => sum + s.text.length, 0);

  let remaining = nonUrlBudget;
  const allocations = new Map<number, number>();

  for (let i = 0; i < segments.length; i++) {
    if (!segments[i].isUrl) {
      const proportion = segments[i].text.length / totalNonUrlChars;
      const alloc = Math.floor(proportion * nonUrlBudget);
      allocations.set(i, alloc);
      remaining -= alloc;
    }
  }

  // Distribute any remaining chars to the first non-URL segment.
  for (let i = 0; i < segments.length; i++) {
    if (!segments[i].isUrl && remaining > 0) {
      allocations.set(i, (allocations.get(i) || 0) + remaining);
      remaining = 0;
      break;
    }
  }

  // Build the result, truncating non-URL segments to their allocation.
  let result = '';
  let addedEllipsis = false;
  for (let i = 0; i < segments.length; i++) {
    if (segments[i].isUrl) {
      result += segments[i].text;
    } else {
      const budget = allocations.get(i) || 0;
      if (segments[i].text.length <= budget) {
        result += segments[i].text;
      } else {
        result += segments[i].text.slice(0, budget).trimEnd();
        if (!addedEllipsis) {
          result += '...';
          addedEllipsis = true;
        }
        // Skip remaining non-URL segments after truncation point.
        // But still include any remaining URLs.
        for (let j = i + 1; j < segments.length; j++) {
          if (segments[j].isUrl) {
            result += segments[j].text;
          }
        }
        break;
      }
    }
  }

  if (!addedEllipsis && twitterWeightedLength(result) > maxWeighted) {
    // Safety: shouldn't happen, but trim if it does.
    result = result.slice(0, maxWeighted - 3).trimEnd() + '...';
  }

  return result;
}
