import { NextResponse } from 'next/server';

import { sqlite } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface SearchRow {
  entity_type: string;
  entity_id: number;
  excerpt: string;
  match_field: string;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const q = url.searchParams.get('q')?.trim() || '';

    if (q.length < 2) {
      return NextResponse.json({ error: 'Query param q must be at least 2 characters.' }, { status: 400 });
    }

    const limitParam = url.searchParams.get('limit');
    const limit = Math.max(1, Math.min(100, Number(limitParam) || 20));

    // Escape LIKE special characters in the search query
    const escaped = q.replace(/%/g, '\\%').replace(/_/g, '\\_');
    const pattern = `%${escaped}%`;

    const perTable = Math.ceil(limit / 5);

    // Build the UNION query with per-table LIMIT applied via a subquery wrapper
    // so each arm contributes at most perTable rows before the combined slice.
    const unionSql = `
      SELECT 'post'     AS entity_type, id AS entity_id, SUBSTR(text, 1, 200)     AS excerpt, 'text'    AS match_field
        FROM scheduled_posts  WHERE text     LIKE ? ESCAPE '\' LIMIT ?
      UNION ALL
      SELECT 'inbox'    AS entity_type, id AS entity_id, SUBSTR(text, 1, 200)     AS excerpt, 'text'    AS match_field
        FROM engagement_inbox WHERE text     LIKE ? ESCAPE '\' LIMIT ?
      UNION ALL
      SELECT 'campaign' AS entity_type, id AS entity_id, SUBSTR(name, 1, 200)     AS excerpt, 'name'    AS match_field
        FROM campaigns        WHERE name     LIKE ? ESCAPE '\' LIMIT ?
      UNION ALL
      SELECT 'draft'    AS entity_type, id AS entity_id, SUBSTR(text, 1, 200)     AS excerpt, 'text'    AS match_field
        FROM draft_posts      WHERE text     LIKE ? ESCAPE '\' LIMIT ?
      UNION ALL
      SELECT 'template' AS entity_type, id AS entity_id, SUBSTR(name, 1, 200)     AS excerpt, 'name'    AS match_field
        FROM post_templates   WHERE name     LIKE ? ESCAPE '\' LIMIT ?
      UNION ALL
      SELECT 'template' AS entity_type, id AS entity_id, SUBSTR(template, 1, 200) AS excerpt, 'content' AS match_field
        FROM post_templates   WHERE template LIKE ? ESCAPE '\' AND name NOT LIKE ? ESCAPE '\' LIMIT ?
    `;

    // bind params: pattern + perTable for each of the 5 arms, plus the extra
    // NOT LIKE guard and perTable for the 6th (template content) arm.
    const bindParams: unknown[] = [
      pattern, perTable,  // scheduled_posts
      pattern, perTable,  // engagement_inbox
      pattern, perTable,  // campaigns
      pattern, perTable,  // draft_posts
      pattern, perTable,  // post_templates (name)
      pattern, pattern, perTable, // post_templates (content, excluding name matches)
    ];

    const rows = sqlite.prepare(unionSql).all(...bindParams) as SearchRow[];

    const results = rows.slice(0, limit).map((row) => ({
      entityType: row.entity_type,
      entityId: row.entity_id,
      excerpt: row.excerpt,
      matchField: row.match_field,
    }));

    return NextResponse.json({ query: q, total: results.length, results });
  } catch (error) {
    console.error('Error performing global search:', error);
    return NextResponse.json({ error: 'Failed to perform search.' }, { status: 500 });
  }
}
