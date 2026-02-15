import { isAccountSlot, normalizeAccountSlot, type AccountSlot } from './account-slots';

export interface CsvImportIssue {
  lineNumber: number;
  message: string;
  field?: string;
}

export interface PreparedCsvPost {
  lineNumber: number;
  accountSlot: AccountSlot;
  text: string;
  scheduledTime: Date;
  communityId: string | null;
  replyToTweetId: string | null;
}

export interface PrepareCsvImportOptions {
  intervalMinutes?: number;
  startTime?: Date;
  reschedulePast?: boolean;
  accountSlot?: AccountSlot;
}

export interface PrepareCsvImportResult {
  headers: string[];
  posts: PreparedCsvPost[];
  errors: CsvImportIssue[];
  warnings: CsvImportIssue[];
  totalRows: number;
}

interface CsvLine {
  lineNumber: number;
  cells: string[];
}

const TEXT_ALIASES = ['text', 'tweet', 'post', 'content', 'body'];
const SCHEDULE_ALIASES = ['scheduled_time', 'scheduled_at', 'schedule_time', 'publish_at', 'datetime', 'date'];
const COMMUNITY_ALIASES = ['community_id', 'community', 'communityid'];
const REPLY_ALIASES = ['reply_to_tweet_id', 'in_reply_to_tweet_id', 'reply_to_post_id', 'reply_to'];
const ACCOUNT_SLOT_ALIASES = ['account_slot', 'slot', 'account'];

function normalizeHeader(value: string): string {
  return value
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

function isRowEmpty(cells: string[]): boolean {
  return cells.every((cell) => cell.trim().length === 0);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

function parseBoolean(value: string | null | undefined): boolean {
  if (!value) return false;
  return ['1', 'true', 'yes', 'y'].includes(value.trim().toLowerCase());
}

function parseCsvLines(csvText: string): CsvLine[] {
  const input = csvText.endsWith('\n') ? csvText : `${csvText}\n`;
  const lines: CsvLine[] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  let lineNumber = 1;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    const nextChar = input[i + 1];

    if (inQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          cell += '"';
          i += 1;
          continue;
        }
        inQuotes = false;
        continue;
      }
      cell += char;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }

    if (char === ',') {
      row.push(cell);
      cell = '';
      continue;
    }

    if (char === '\r') {
      continue;
    }

    if (char === '\n') {
      row.push(cell);
      lines.push({ lineNumber, cells: row });
      row = [];
      cell = '';
      lineNumber += 1;
      continue;
    }

    cell += char;
  }

  return lines;
}

function getColumnIndex(headers: string[], aliases: string[]): number {
  return headers.findIndex((header) => aliases.includes(header));
}

function parseDateValue(raw: string): Date | null {
  const value = raw.trim();
  if (!value) return null;

  if (/^\d{10}$/.test(value)) {
    const parsed = new Date(Number(value) * 1000);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  if (/^\d{13}$/.test(value)) {
    const parsed = new Date(Number(value));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const parsed = new Date(`${value}T09:00:00`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(:\d{2})?$/.test(value)) {
    const normalized = value.replace(/\s+/, 'T');
    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function resolveHeaderAndRows(lines: CsvLine[]): { headers: string[]; dataRows: CsvLine[] } {
  const firstNonEmptyIndex = lines.findIndex((line) => !isRowEmpty(line.cells));
  if (firstNonEmptyIndex === -1) {
    return { headers: [], dataRows: [] };
  }

  const firstLine = lines[firstNonEmptyIndex];
  const normalized = firstLine.cells.map(normalizeHeader);
  const hasKnownHeader = normalized.some((value) =>
    [...TEXT_ALIASES, ...SCHEDULE_ALIASES, ...COMMUNITY_ALIASES, ...REPLY_ALIASES, ...ACCOUNT_SLOT_ALIASES].includes(value),
  );

  if (hasKnownHeader) {
    return {
      headers: normalized,
      dataRows: lines.slice(firstNonEmptyIndex + 1),
    };
  }

  const fallbackHeaders = ['text', 'scheduled_time', 'community_id', 'reply_to_tweet_id', 'account_slot'].slice(0, firstLine.cells.length);
  return {
    headers: fallbackHeaders,
    dataRows: lines.slice(firstNonEmptyIndex),
  };
}

export function prepareCsvImport(csvText: string, options: PrepareCsvImportOptions = {}): PrepareCsvImportResult {
  const errors: CsvImportIssue[] = [];
  const warnings: CsvImportIssue[] = [];
  const lines = parseCsvLines(csvText);
  const { headers, dataRows } = resolveHeaderAndRows(lines);

  if (headers.length === 0) {
    return {
      headers,
      posts: [],
      errors: [{ lineNumber: 1, message: 'CSV is empty or contains no usable rows.' }],
      warnings,
      totalRows: 0,
    };
  }

  const textIndex = getColumnIndex(headers, TEXT_ALIASES);
  const scheduleIndex = getColumnIndex(headers, SCHEDULE_ALIASES);
  const communityIndex = getColumnIndex(headers, COMMUNITY_ALIASES);
  const replyIndex = getColumnIndex(headers, REPLY_ALIASES);
  const accountSlotIndex = getColumnIndex(headers, ACCOUNT_SLOT_ALIASES);

  if (textIndex === -1) {
    return {
      headers,
      posts: [],
      errors: [{ lineNumber: 1, message: 'Missing required tweet text column. Expected one of: text, tweet, post, content.' }],
      warnings,
      totalRows: dataRows.length,
    };
  }

  const intervalMinutes = clamp(Math.floor(options.intervalMinutes ?? 60), 1, 24 * 60);
  const reschedulePast = options.reschedulePast ?? true;
  const defaultAccountSlot = normalizeAccountSlot(options.accountSlot, 1);
  const now = new Date();
  const startTime = options.startTime && !Number.isNaN(options.startTime.getTime())
    ? options.startTime
    : addMinutes(now, 5);

  let nextAutoTime = new Date(startTime);
  const posts: PreparedCsvPost[] = [];

  for (const row of dataRows) {
    if (isRowEmpty(row.cells)) {
      continue;
    }

    const readValue = (index: number): string => {
      if (index < 0) return '';
      return (row.cells[index] || '').trim();
    };

    const text = readValue(textIndex);
    if (!text) {
      errors.push({
        lineNumber: row.lineNumber,
        field: 'text',
        message: 'Missing tweet text.',
      });
      continue;
    }

    if (text.length > 280) {
      warnings.push({
        lineNumber: row.lineNumber,
        field: 'text',
        message: `Tweet is ${text.length} characters. Posting may fail if your account is limited to 280.`,
      });
    }

    const scheduleRaw = readValue(scheduleIndex);
    const hasScheduledTime = Boolean(scheduleRaw);
    let scheduledTime: Date | null = hasScheduledTime ? parseDateValue(scheduleRaw) : null;

    if (scheduleRaw && !scheduledTime) {
      errors.push({
        lineNumber: row.lineNumber,
        field: 'scheduled_time',
        message: `Invalid scheduled time: "${scheduleRaw}"`,
      });
      continue;
    }

    let usedAutoTime = false;
    if (!scheduledTime) {
      scheduledTime = new Date(nextAutoTime);
      nextAutoTime = addMinutes(nextAutoTime, intervalMinutes);
      usedAutoTime = true;
    } else if (scheduledTime.getTime() < now.getTime() && reschedulePast) {
      warnings.push({
        lineNumber: row.lineNumber,
        field: 'scheduled_time',
        message: 'Scheduled time is in the past; auto-rescheduled.',
      });
      scheduledTime = new Date(nextAutoTime);
      nextAutoTime = addMinutes(nextAutoTime, intervalMinutes);
      usedAutoTime = true;
    }

    if (hasScheduledTime && !usedAutoTime && scheduledTime) {
      const candidateNext = addMinutes(scheduledTime, intervalMinutes);
      if (candidateNext.getTime() > nextAutoTime.getTime()) {
        nextAutoTime = candidateNext;
      }
    }

    const communityId = readValue(communityIndex) || null;
    const replyToTweetId = readValue(replyIndex) || null;
    const accountSlotRaw = readValue(accountSlotIndex);
    let accountSlot = defaultAccountSlot;

    if (accountSlotRaw) {
      const parsedSlot = Number(accountSlotRaw);
      if (!Number.isFinite(parsedSlot) || !isAccountSlot(parsedSlot)) {
        errors.push({
          lineNumber: row.lineNumber,
          field: 'account_slot',
          message: `Invalid account slot "${accountSlotRaw}". Use 1 or 2.`,
        });
        continue;
      }
      accountSlot = parsedSlot;
    }

    posts.push({
      lineNumber: row.lineNumber,
      accountSlot,
      text,
      scheduledTime,
      communityId,
      replyToTweetId,
    });
  }

  return {
    headers,
    posts,
    errors,
    warnings,
    totalRows: dataRows.length,
  };
}

export function parseCsvImportFlags(params: {
  dryRun?: string | null;
  intervalMinutes?: string | null;
  startTime?: string | null;
  reschedulePast?: string | null;
  accountSlot?: string | null;
}): {
  dryRun: boolean;
  intervalMinutes: number;
  startTime?: Date;
  reschedulePast: boolean;
  accountSlot: AccountSlot;
} {
  const dryRun = parseBoolean(params.dryRun);
  const reschedulePast = params.reschedulePast === null || params.reschedulePast === undefined
    ? true
    : parseBoolean(params.reschedulePast);

  const requestedInterval = Number(params.intervalMinutes || 60);
  const intervalMinutes = clamp(Number.isFinite(requestedInterval) ? requestedInterval : 60, 1, 24 * 60);

  let startTime: Date | undefined;
  if (params.startTime && params.startTime.trim()) {
    const parsed = parseDateValue(params.startTime);
    if (parsed) {
      startTime = parsed;
    }
  }

  return {
    dryRun,
    intervalMinutes,
    startTime,
    reschedulePast,
    accountSlot: normalizeAccountSlot(params.accountSlot, 1),
  };
}
