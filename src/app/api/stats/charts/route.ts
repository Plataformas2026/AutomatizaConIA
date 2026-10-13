import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSessionContext } from '@/lib/auth';
import { chartConfigSchema, MAX_CHARTS } from '@/lib/stats/types';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  config: chartConfigSchema,
  /** Proyecto al que se vincula la gráfica; null = archivos sin proyecto. */
  projectId: z.string().uuid().nullable().default(null),
});

/** Guarda una gráfica nueva (solo su configuración), vinculada a un proyecto. */
export async function POST(req: Request) {
  const ctx = await getSessionContext();
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: 'invalid_config' }, { status: 400 });
  const { config, projectId } = body.data;

  // Solo se crean gráficas sobre archivos y proyectos de MI empresa.
  if (projectId) {
    const { data: project } = await ctx.supabase
      .from('projects')
      .select('id')
      .eq('id', projectId)
      .eq('company_id', ctx.companyId)
      .maybeSingle();
    if (!project) return NextResponse.json({ error: 'project_not_found' }, { status: 404 });
  }
  const { data: file } = await ctx.supabase
    .from('shared_files_metadata')
    .select('id, project_id')
    .eq('id', config.fileId)
    .eq('company_id', ctx.companyId)
    .maybeSingle();
  if (!file) return NextResponse.json({ error: 'file_not_found' }, { status: 404 });
  // La gráfica solo puede usar archivos del proyecto al que pertenece.
  if ((file.project_id ?? null) !== projectId) {
    return NextResponse.json({ error: 'file_not_in_project' }, { status: 400 });
  }

  let listQuery = ctx.supabase
    .from('stats_charts')
    .select('position')
    .eq('user_id', ctx.user.id)
    .order('position', { ascending: false })
    .limit(MAX_CHARTS + 1);
  listQuery = projectId ? listQuery.eq('project_id', projectId) : listQuery.is('project_id', null);
  const { data: existing, error: listError } = await listQuery;
  if (listError) return NextResponse.json({ error: 'db_error' }, { status: 500 });
  if ((existing?.length ?? 0) >= MAX_CHARTS) {
    return NextResponse.json({ error: 'too_many_charts' }, { status: 409 });
  }
  const position = (existing?.[0]?.position ?? -1) + 1;

  const { data, error } = await ctx.supabase
    .from('stats_charts')
    .insert({ company_id: ctx.companyId, user_id: ctx.user.id, project_id: projectId, config, position })
    .select('id, config, position')
    .single();
  if (error) return NextResponse.json({ error: 'db_error' }, { status: 500 });
  return NextResponse.json({ chart: data });
}
