import { sql } from 'drizzle-orm';

import { db } from '@/db/client';

export const dynamic = 'force-dynamic';

/** Liveness plus a real database round trip. */
export async function GET() {
  try {
    await db.execute(sql`select 1`);
    return Response.json({ ok: true, database: 'up' });
  } catch {
    return Response.json({ ok: false, database: 'down' }, { status: 503 });
  }
}
