import fs from 'fs/promises';
import path from 'path';
import { NextResponse } from 'next/server';

import {
  generateUploadFilename,
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_FILES,
} from '@/lib/uploads';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const files = formData.getAll('files') as File[];

    if (!files || files.length === 0) {
      return NextResponse.json(
        { error: 'Missing files. Upload one or more files using the "files" field.' },
        { status: 400 },
      );
    }

    if (files.length > MAX_UPLOAD_FILES) {
      return NextResponse.json(
        { error: `Too many files. X supports up to ${MAX_UPLOAD_FILES} media attachments per post.` },
        { status: 400 },
      );
    }

    const uploadDir = path.join(process.cwd(), 'public', 'uploads');
    await fs.mkdir(uploadDir, { recursive: true });

    const mediaUrls: string[] = [];
    for (const file of files) {
      if (typeof file.size === 'number' && file.size > MAX_UPLOAD_BYTES) {
        return NextResponse.json(
          { error: `File too large. Max ${MAX_UPLOAD_BYTES} bytes per upload.` },
          { status: 400 },
        );
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      const filename = generateUploadFilename(file.name || 'upload');
      await fs.writeFile(path.join(uploadDir, filename), buffer);
      mediaUrls.push(`/uploads/${filename}`);
    }

    return NextResponse.json({ mediaUrls });
  } catch (error) {
    console.error('Error uploading media:', error);
    return NextResponse.json({ error: 'Failed to upload media.' }, { status: 500 });
  }
}
