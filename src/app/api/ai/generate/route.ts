import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Mode = 'generate' | 'rewrite' | 'expand' | 'hook';
type Tone = 'professional' | 'casual' | 'provocative' | 'educational' | 'witty';

interface GenerateRequest {
  prompt?: unknown;
  mode?: unknown;
  tone?: unknown;
  count?: unknown;
  existingText?: unknown;
}

// ---------------------------------------------------------------------------
// In-memory rate limiter (per-worker, resets on restart)
// ---------------------------------------------------------------------------

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

const rateLimitMap = new Map<string, RateLimitEntry>();
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;

function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(key);

  if (!entry || now - entry.windowStart >= RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(key, { count: 1, windowStart: now });
    return true;
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    return false;
  }

  entry.count += 1;
  return true;
}

// Prune stale entries to avoid memory growth in long-running processes.
// We do this lazily on each request rather than with a setInterval.
function pruneRateLimitMap(): void {
  const now = Date.now();
  for (const [key, entry] of rateLimitMap) {
    if (now - entry.windowStart >= RATE_LIMIT_WINDOW_MS * 2) {
      rateLimitMap.delete(key);
    }
  }
}

// ---------------------------------------------------------------------------
// Input validation helpers
// ---------------------------------------------------------------------------

const VALID_MODES: Mode[] = ['generate', 'rewrite', 'expand', 'hook'];
const VALID_TONES: Tone[] = ['professional', 'casual', 'provocative', 'educational', 'witty'];

function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asInt(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(min, Math.min(max, Math.floor(value)));
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) return Math.max(min, Math.min(max, parsed));
  }
  return fallback;
}

// ---------------------------------------------------------------------------
// Template-based generation (fallback when AI_API_URL is not configured)
// ---------------------------------------------------------------------------

const MAX_TWEET_LENGTH = 280;

function truncateToTweet(text: string): string {
  if (text.length <= MAX_TWEET_LENGTH) return text;
  return text.slice(0, MAX_TWEET_LENGTH - 1).trimEnd() + '…';
}

const TONE_PREFIXES: Record<Tone, string[]> = {
  professional: ['Here is why', 'The key insight:', 'Worth noting:', 'A critical point:'],
  casual: ['Honestly,', 'Hot take:', 'Real talk —', 'Just thinking about'],
  provocative: ['Controversial opinion:', 'Nobody talks about this, but', 'Change my mind:', 'Unpopular take:'],
  educational: ['Did you know?', 'Quick lesson:', 'TIL:', 'Here is how it works:'],
  witty: ['Plot twist:', 'Fun fact nobody asked for:', 'Big brain moment:', 'Surprise, surprise:'],
};

function getTonePrefix(tone: Tone): string {
  const options = TONE_PREFIXES[tone];
  return options[Math.floor(Math.random() * options.length)];
}

function generateVariations(prompt: string, tone: Tone, count: number): string[] {
  const prefix = getTonePrefix(tone);
  const cleanPrompt = prompt.replace(/[?.!]+$/, '').trim();

  const templates = [
    // Question format
    () => truncateToTweet(`${getTonePrefix(tone)} What if ${cleanPrompt.toLowerCase()}? Here is what most people miss.`),
    // Bold statement
    () => truncateToTweet(`${prefix} ${cleanPrompt}.`),
    // List teaser
    () => truncateToTweet(`${cleanPrompt} — three things worth knowing:\n\n→ The conventional wisdom is wrong\n→ The real answer is simpler\n→ Most people never figure this out`),
    // Hook + payoff
    () => truncateToTweet(`${getTonePrefix(tone)} ${cleanPrompt} changed how I think about everything.\n\nHere is the short version:`),
    // Narrative open
    () => truncateToTweet(`Everyone assumes ${cleanPrompt.toLowerCase()} is complicated.\n\nIt is not. ${getTonePrefix(tone)} here is the one thing that actually matters.`),
    // Provocative angle
    () => truncateToTweet(`${getTonePrefix(tone)} ${cleanPrompt} is not what you think.\n\nThe people who understand this have a serious edge.`),
  ];

  const results: string[] = [];
  const used = new Set<number>();

  while (results.length < count && used.size < templates.length) {
    const idx = Math.floor(Math.random() * templates.length);
    if (used.has(idx)) continue;
    used.add(idx);
    const text = templates[idx]();
    if (text.length > 0 && text.length <= MAX_TWEET_LENGTH) {
      results.push(text);
    }
  }

  // Pad with sequentially numbered variants if we still need more.
  let extra = 0;
  while (results.length < count) {
    extra += 1;
    results.push(truncateToTweet(`${prefix} ${cleanPrompt}. (Variation ${extra})`));
  }

  return results.slice(0, count);
}

function rewriteVariations(existingText: string, tone: Tone, count: number): string[] {
  const prefix = getTonePrefix(tone);
  const stripped = existingText.replace(/[?.!]+$/, '').trim();

  const templates = [
    () => truncateToTweet(`${prefix} ${stripped}.`),
    () => truncateToTweet(`${getTonePrefix(tone)} ${stripped} — and that changes everything.`),
    () => truncateToTweet(`${stripped}\n\n${getTonePrefix(tone)} this is the part most people skip over.`),
    () => truncateToTweet(`Think about it: ${stripped.toLowerCase()}. ${getTonePrefix(tone)} the implications are huge.`),
    () => truncateToTweet(`${getTonePrefix(tone)} here is a fresh take: ${stripped.toLowerCase()}.`),
    () => truncateToTweet(`Reframing: ${stripped}.\n\n${getTonePrefix(tone)} see it differently and the whole picture shifts.`),
  ];

  const results: string[] = [];
  const used = new Set<number>();

  while (results.length < count && used.size < templates.length) {
    const idx = Math.floor(Math.random() * templates.length);
    if (used.has(idx)) continue;
    used.add(idx);
    const text = templates[idx]();
    if (text.length > 0 && text.length <= MAX_TWEET_LENGTH) {
      results.push(text);
    }
  }

  let extra = 0;
  while (results.length < count) {
    extra += 1;
    results.push(truncateToTweet(`${prefix} ${stripped}. (Version ${extra})`));
  }

  return results.slice(0, count);
}

function expandToThread(text: string, _tone: Tone, count: number): string[] {
  const stripped = text.replace(/[?.!]+$/, '').trim();
  const threadTweets = [
    truncateToTweet(`${stripped}.\n\nA thread on why this matters more than most people realize: 🧵`),
    truncateToTweet(`1/ Let's start with the basics.\n\n${stripped} — here is the foundation you need to understand the rest.`),
    truncateToTweet(`2/ Most people get stuck here: they assume the hardest part is at the start.\n\nIt is not. The real challenge comes after you understand the core idea.`),
    truncateToTweet(`3/ Here is where it gets interesting.\n\nOnce you see this clearly, you start noticing it everywhere. Small details that seemed random suddenly make sense.`),
    truncateToTweet(`4/ The counterintuitive part:\n\nSimplifying is harder than complicating. The experts who truly understand ${stripped.toLowerCase()} can explain it in one sentence.`),
    truncateToTweet(`5/ Practical takeaway:\n\nStart small. Pick the one element that matters most right now. Master that before moving on.`),
    truncateToTweet(`6/ If you got value from this thread — share it with one person who needs to see it.\n\nAnd follow for more threads like this.`),
  ];

  return threadTweets.slice(0, Math.min(count, threadTweets.length));
}

function generateHooks(prompt: string, _tone: Tone, count: number): string[] {
  const cleanPrompt = prompt.replace(/[?.!]+$/, '').trim().toLowerCase();

  const hooks = [
    truncateToTweet(`Nobody told me ${cleanPrompt} could be this simple.`),
    truncateToTweet(`I spent years getting ${cleanPrompt} wrong. Here is what I finally figured out:`),
    truncateToTweet(`The one thing about ${cleanPrompt} that most people never talk about:`),
    truncateToTweet(`If you are serious about ${cleanPrompt}, stop doing what everyone else is doing.`),
    truncateToTweet(`${cleanPrompt.charAt(0).toUpperCase() + cleanPrompt.slice(1)} is either the easiest or the hardest thing, depending on this one factor:`),
    truncateToTweet(`Hot take: the conventional approach to ${cleanPrompt} is almost completely backwards.`),
    truncateToTweet(`Three words that changed how I think about ${cleanPrompt}: it is compounding.`),
    truncateToTweet(`You can figure out ${cleanPrompt} on your own in 10 years, or read this thread in 2 minutes.`),
  ];

  // Shuffle and return requested count.
  const shuffled = [...hooks].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

// ---------------------------------------------------------------------------
// LLM generation via AI_API_URL (e.g. Ollama)
// ---------------------------------------------------------------------------

async function generateWithLlm(
  prompt: string,
  mode: Mode,
  tone: Tone,
  count: number,
  existingText: string | null,
  aiApiUrl: string,
): Promise<string[]> {
  const toneDesc: Record<Tone, string> = {
    professional: 'authoritative, polished, and business-appropriate',
    casual: 'conversational, warm, and approachable',
    provocative: 'bold, challenging, and opinion-forward',
    educational: 'clear, informative, and structured to teach',
    witty: 'clever, playful, and lightly humorous',
  };

  const modeInstructions: Record<Mode, string> = {
    generate: `Generate ${count} distinct tweet variations about: "${prompt}". Each tweet must be a standalone post.`,
    rewrite: `Rewrite the following tweet ${count} different ways: "${existingText ?? prompt}". Each version should feel meaningfully different.`,
    expand: `Turn this tweet into ${count} individual tweets for a thread: "${existingText ?? prompt}". Number each tweet (1/, 2/, ...). The last tweet should be a call to action.`,
    hook: `Write ${count} attention-grabbing opening lines (hooks) for a tweet about: "${prompt}". Each hook should make someone stop scrolling.`,
  };

  const systemPrompt = `You are an expert social media copywriter who specialises in high-performing tweets. Write in a ${toneDesc[tone]} tone. Return ONLY the tweet texts, one per line, with no numbering, labels, or explanation. Each tweet must be 280 characters or fewer. Do not include quotation marks around the tweets.`;

  const userPrompt = modeInstructions[mode];

  // Support both Ollama (/api/generate) and OpenAI-compatible (/v1/chat/completions) APIs.
  const isOllama = aiApiUrl.includes('/api/generate');

  let responseText: string;

  if (isOllama) {
    const res = await fetch(aiApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.AI_MODEL ?? 'llama3',
        prompt: `${systemPrompt}\n\n${userPrompt}`,
        stream: false,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) throw new Error(`LLM API returned ${res.status}`);
    const json = await res.json() as { response?: string };
    responseText = json.response ?? '';
  } else {
    // OpenAI-compatible endpoint
    const res = await fetch(aiApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.AI_API_KEY ? { Authorization: `Bearer ${process.env.AI_API_KEY}` } : {}),
      },
      body: JSON.stringify({
        model: process.env.AI_MODEL ?? 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) throw new Error(`LLM API returned ${res.status}`);
    const json = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    responseText = json.choices?.[0]?.message?.content ?? '';
  }

  // Parse line-separated tweets, strip blank lines and over-length entries.
  const lines = responseText
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && l.length <= MAX_TWEET_LENGTH);

  return lines.slice(0, count);
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(req: Request) {
  pruneRateLimitMap();

  // Use a fixed rate-limit key since this is a single-user self-hosted app.
  // Don't trust x-forwarded-for as it's trivially spoofable.
  const rateLimitKey = 'global';
  if (!checkRateLimit(rateLimitKey)) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Maximum 10 requests per minute.' },
      { status: 429 },
    );
  }

  let body: GenerateRequest;
  try {
    body = (await req.json()) as GenerateRequest;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  // --- Validate mode ---
  const mode = asString(body.mode) as Mode | null;
  if (!mode || !VALID_MODES.includes(mode)) {
    return NextResponse.json(
      { error: `Invalid mode. Must be one of: ${VALID_MODES.join(', ')}.` },
      { status: 400 },
    );
  }

  // --- Validate prompt ---
  const prompt = asString(body.prompt);
  if (!prompt) {
    return NextResponse.json({ error: 'prompt is required and must be a non-empty string.' }, { status: 400 });
  }
  if (prompt.length > 1000) {
    return NextResponse.json({ error: 'prompt must be 1000 characters or fewer.' }, { status: 400 });
  }

  // --- Validate tone (optional, default: professional) ---
  const rawTone = asString(body.tone);
  const tone: Tone = rawTone && VALID_TONES.includes(rawTone as Tone) ? (rawTone as Tone) : 'professional';

  // --- Validate count (optional, default: 3) ---
  const count = asInt(body.count, 3, 1, 6);

  // --- Validate existingText (required for rewrite/expand, optional for others) ---
  const existingText = asString(body.existingText);
  if ((mode === 'rewrite' || mode === 'expand') && !existingText) {
    return NextResponse.json(
      { error: `existingText is required for mode "${mode}".` },
      { status: 400 },
    );
  }
  if (existingText && existingText.length > 2000) {
    return NextResponse.json({ error: 'existingText must be 2000 characters or fewer.' }, { status: 400 });
  }

  // --- Attempt LLM generation if configured ---
  const aiApiUrl = process.env.AI_API_URL?.trim();

  if (aiApiUrl) {
    try {
      const suggestions = await generateWithLlm(prompt, mode, tone, count, existingText, aiApiUrl);
      if (suggestions.length > 0) {
        return NextResponse.json({ suggestions, aiPowered: true });
      }
      // Fall through to templates if LLM returned nothing useful.
      console.warn('[ai/generate] LLM returned no usable suggestions — falling back to templates.');
    } catch (err) {
      console.error('[ai/generate] LLM call failed, falling back to templates:', err);
    }
  }

  // --- Template-based fallback ---
  let suggestions: string[];

  switch (mode) {
    case 'generate':
      suggestions = generateVariations(prompt, tone, count);
      break;
    case 'rewrite':
      suggestions = rewriteVariations(existingText ?? prompt, tone, count);
      break;
    case 'expand':
      suggestions = expandToThread(existingText ?? prompt, tone, count);
      break;
    case 'hook':
      suggestions = generateHooks(prompt, tone, count);
      break;
    default:
      suggestions = generateVariations(prompt, tone, count);
  }

  return NextResponse.json({ suggestions, aiPowered: false });
}
