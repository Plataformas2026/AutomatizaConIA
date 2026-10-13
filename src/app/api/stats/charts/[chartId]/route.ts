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

  // Solo se editan gráficas propias, y con archivos del mismo proyecto.
  const { data: chart } = await ctx.supabase
    .from('stats_charts')
    .select('id, project_id')
    .eq('id', chartId)
    .eq('user_id', ctx.user.id)
    .maybeSingle();
  if (!chart) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const { data: file } = await ctx.supabase
    .from('shared_files_metadata')
    .select('id, project_id')
    .eq('id', body.data.config.fileId)
    .eq('company_id', ctx.companyId)
    .maybeSingle();
  if (!file) return NextResponse.json({ error: 'file_not_found' }, { status: 404 });
  if ((file.project_id ?? null) !== (chart.project_id ?? null)) {
    return NextResponse.json({ error: 'file_not_in_project' }, { status: 400 });
  }

  const { data, error } = await ctx.supabase
    .from('stats_charts')
    .update({ config: body.data.config })
    .eq('id', chartId)
    .eq('user_id', ctx.user.id)
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

  const { error } = await ctx.supabase.from('stats_charts').delete().eq('id', chartId).eq('user_id', ctx.user.id);
  if (error) return NextResponse.json({ error: 'db_error' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
