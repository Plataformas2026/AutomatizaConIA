import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSessionContext } from '@/lib/auth';
import { StatsError } from '@/lib/stats/compute';
import { openFile, tableFor } from '@/lib/stats/source';
import { runMl } from '@/lib/ml/run';
import { mlConfigSchema } from '@/lib/ml/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const bodySchema = z.object({ config: mlConfigSchema });

/**
 * Entrena / ejecuta el modelo con los datos del archivo, leídos al vuelo de Drive.
 * Todo ocurre en memoria durante la petición: la respuesta es el informe y nada
 * del archivo queda guardado en el servidor.
 */
export async function POST(req: Request) {
  const ctx = await getSessionContext();
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: 'invalid_config' }, { status: 400 });
  const { config } = body.data;

  try {
    const file = await openFile(ctx, config.fileId);
    const table = tableFor(file, config.sheet);
    const result = runMl(table, config);
    return NextResponse.json({ result }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    // Solo se devuelve un código de error, nunca contenido del archivo.
    if (e instanceof StatsError) return NextResponse.json({ error: e.code }, { status: e.status });
    return NextResponse.json({ error: 'read_error' }, { status: 502 });
  }
}
