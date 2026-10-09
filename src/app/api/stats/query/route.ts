import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSessionContext } from '@/lib/auth';
import { computeChart, StatsError } from '@/lib/stats/compute';
import { openFile, tableFor, type OpenedFile } from '@/lib/stats/source';
import { chartConfigSchema, MAX_CHARTS, type QueryItemResult } from '@/lib/stats/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const bodySchema = z.object({
  charts: z
    .array(z.object({ id: z.string().min(1).max(80), config: chartConfigSchema }))
    .min(1)
    .max(MAX_CHARTS),
});

/**
 * Calcula los datos de varias gráficas a la vez. Cada archivo se descarga UNA
 * sola vez por petición, se agrega en memoria y se descarta: la respuesta
 * contiene únicamente cifras agregadas, nunca filas del archivo.
 */
export async function POST(req: Request) {
  const ctx = await getSessionContext();
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });

  const results: Record<string, QueryItemResult> = {};

  // Agrupa por archivo para no descargarlo varias veces.
  const byFile = new Map<string, typeof body.data.charts>();
  for (const chart of body.data.charts) {
    const list = byFile.get(chart.config.fileId) ?? [];
    list.push(chart);
    byFile.set(chart.config.fileId, list);
  }

  for (const [fileId, charts] of byFile) {
    let file: OpenedFile | null = null;
    let fileError: string | null = null;
    try {
      file = await openFile(ctx, fileId);
    } catch (e) {
      fileError = e instanceof StatsError ? e.code : 'read_error';
    }

    for (const { id, config } of charts) {
      if (!file) {
        results[id] = { error: fileError ?? 'read_error' };
        continue;
      }
      try {
        results[id] = { result: computeChart(tableFor(file, config.sheet), config) };
      } catch (e) {
        // Solo se registra el código de error, nunca contenido del archivo.
        results[id] = { error: e instanceof StatsError ? e.code : 'read_error' };
      }
    }
    file = null; // el contenido se descarta aquí
  }

  return NextResponse.json({ results }, { headers: { 'Cache-Control': 'no-store' } });
}
