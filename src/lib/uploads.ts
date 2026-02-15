import crypto from 'crypto';
import path from 'path';

export const MAX_UPLOAD_FILES = 4;
export const MAX_UPLOAD_BYTES = 8_000_000;

export function sanitizeUploadFilename(originalName: string): string {
  const basename = originalName.split(/[/\\]/).pop() || 'file';
  const trimmed = basename.trim() || 'file';
  const safe = trimmed
    .replace(/[^\w.\-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^\.+/, '');

  const limited = safe.slice(0, 120).trim();
  return limited.length > 0 ? limited : 'file';
}

export function generateUploadFilename(originalName: string): string {
  return `${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${sanitizeUploadFilename(originalName)}`;
}

export function ensureSafeUploadUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  // Only allow files we previously stored under public/uploads.
  if (!trimmed.startsWith('/uploads/')) return null;
  if (trimmed.includes('..') || trimmed.includes('\\') || trimmed.includes('\0')) return null;

  return trimmed;
}

export function toPublicPathFromMediaUrl(mediaUrl: string): string {
  const normalized = mediaUrl.startsWith('/') ? mediaUrl.slice(1) : mediaUrl;
  return path.join(process.cwd(), 'public', normalized);
}
