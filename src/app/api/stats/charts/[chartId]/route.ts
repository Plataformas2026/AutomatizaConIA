import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSessionContext } from '@/lib/auth';
import { chartConfigSchema } from '@/lib/stats/types';

export const dynamic = 'force-dynamic';

const idSchema = z.string().uuid();
const bodySchema = z.object({ config: chartConfigSchema });

/** Cambia la configuración de una gráfica propia. */
export async function PATCH(req: Request, { params }: { params: Promise<{ chartId: string }> }) {
  const { chartId } = await params;
  const ctx = await getSessionContext();
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!idSchema.safeParse(chartId).success) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: 'invalid_config' }, { status: 400 });

  const { data: file } = await ctx.supabase
    .from('shared_files_metadata')
    .select('id')
    .eq('id', body.data.config.fileId)
    .maybeSingle();
  if (!file) return NextResponse.json({ error: 'file_not_found' }, { status: 404 });

  const { data, error } = await ctx.supabase
    .from('stats_charts')
    .update({ config: body.data.config })
    .eq('id', chartId)
    .select('id, config, position')
    .maybeSingle();
  if (error) return NextResponse.json({ error: 'db_error' }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ chart: data });
}

/** Quita una gráfica propia del panel. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ chartId: string }> }) {
  const { chartId } = await params;
  const ctx = await getSessionContext();
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!idSchema.safeParse(chartId).success) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const { error } = await ctx.supabase.from('stats_charts').delete().eq('id', chartId);
  if (error) return NextResponse.json({ error: 'db_error' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
