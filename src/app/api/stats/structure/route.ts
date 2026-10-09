import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSessionContext } from '@/lib/auth';
import { inferKind, StatsError } from '@/lib/stats/compute';
import { allTables, openFile } from '@/lib/stats/source';
import type { StructureSheet } from '@/lib/stats/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const querySchema = z.object({ fileId: z.string().uuid() });

/**
 * Hojas y columnas de un archivo (con el tipo de cada columna) para rellenar
 * los desplegables del creador de gráficas. Solo salen NOMBRES y tipos.
 */
export async function GET(req: Request) {
  const ctx = await getSessionContext();
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = querySchema.safeParse({ fileId: new URL(req.url).searchParams.get('fileId') });
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });

  try {
    const file = await openFile(ctx, parsed.data.fileId);
    const sheets: StructureSheet[] = allTables(file).map(({ sheetName, table }) => ({
      name: sheetName,
      rows: table.rows.length,
      columns: table.headers.map((name) => ({ name, kind: inferKind(table, name) })),
    }));
    return NextResponse.json({ sheets }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    if (e instanceof StatsError) return NextResponse.json({ error: e.code }, { status: e.status });
    return NextResponse.json({ error: 'read_error' }, { status: 502 });
  }
}
