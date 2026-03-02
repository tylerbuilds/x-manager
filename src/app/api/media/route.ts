import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { NextResponse } from 'next/server';
import { and, count, desc, like, eq, type SQL } from 'drizzle-orm';

import { db } from '@/lib/db';
import { mediaLibrary } from '@/lib/db/schema';
import { sanitizeUploadFilename, MAX_UPLOAD_BYTES } from '@/lib/uploads';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MEDIA_DIR = path.join(process.cwd(), 'public', 'uploads', 'library');

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const search = url.searchParams.get('search')?.trim() || null;
    const mimeFilter = url.searchParams.get('mime_type')?.trim() || null;
    const tagFilter = url.searchParams.get('tag')?.trim() || null;

    const conditions: SQL[] = [];

    if (search) {
      conditions.push(like(mediaLibrary.originalName, `%${search}%`));
    }

    if (mimeFilter) {
      conditions.push(like(mediaLibrary.mimeType, `${mimeFilter}%`));
    }

    if (tagFilter) {
      // JSON array stored as text — use LIKE for tag matching
      conditions.push(like(mediaLibrary.tags, `%"${tagFilter}"%`));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const limitParam = url.searchParams.get('limit');
    const limit = Math.max(1, Math.min(200, Number(limitParam) || 50));
    const offsetParam = url.searchParams.get('offset');
    const offset = Math.max(0, Number(offsetParam) || 0);

    const [items, [{ total }]] = await Promise.all([
      db.select().from(mediaLibrary).where(where).orderBy(desc(mediaLibrary.uploadedAt)).limit(limit).offset(offset),
      db.select({ total: count() }).from(mediaLibrary).where(where),
    ]);

    return NextResponse.json({
      items,
      total,
      offset,
      limit,
      hasMore: offset + items.length < total,
    });
  } catch (error) {
    console.error('Error listing media:', error);
    return NextResponse.json({ error: 'Failed to list media.' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const files = formData.getAll('files') as File[];
    const tagsRaw = formData.get('tags') as string | null;
    const description = (formData.get('description') as string | null)?.trim() || null;

    if (files.length === 0) {
      return NextResponse.json({ error: 'No files provided.' }, { status: 400 });
    }

    if (files.length > 10) {
      return NextResponse.json({ error: 'Too many files. Maximum 10 per upload.' }, { status: 400 });
    }

    let tags: string[] = [];
    if (tagsRaw) {
      try {
        const parsed = JSON.parse(tagsRaw);
        if (Array.isArray(parsed)) {
          tags = parsed.filter((t): t is string => typeof t === 'string');
        }
      } catch {
        // Try comma-separated
        tags = tagsRaw.split(',').map((t) => t.trim()).filter(Boolean);
      }
    }

    await fs.mkdir(MEDIA_DIR, { recursive: true });

    const results = [];
    for (const file of files) {
      if (typeof file.size === 'number' && file.size > MAX_UPLOAD_BYTES) {
        return NextResponse.json(
          { error: `File "${file.name}" too large. Max ${MAX_UPLOAD_BYTES} bytes.` },
          { status: 400 },
        );
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      const safeName = sanitizeUploadFilename(file.name || `upload-${crypto.randomUUID()}`);
      const filename = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${safeName}`;
      await fs.writeFile(path.join(MEDIA_DIR, filename), buffer);

      const inserted = await db.insert(mediaLibrary).values({
        filename,
        originalName: file.name || safeName,
        mimeType: file.type || 'application/octet-stream',
        sizeBytes: buffer.length,
        tags: tags.length > 0 ? JSON.stringify(tags) : null,
        description,
      }).returning();

      results.push({ ...inserted[0], url: `/uploads/library/${filename}` });
    }

    return NextResponse.json({ items: results });
  } catch (error) {
    console.error('Error uploading media:', error);
    return NextResponse.json({ error: 'Failed to upload media.' }, { status: 500 });
  }
}
