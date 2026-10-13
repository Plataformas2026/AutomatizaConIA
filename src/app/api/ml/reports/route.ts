import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSessionContext } from '@/lib/auth';
import { toSavedSummary } from '@/lib/ml/run';
import { MAX_REPORTS, mlConfigSchema, mlTitle, ML_TASKS, type MlResult } from '@/lib/ml/types';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  config: mlConfigSchema,
  result: z.object({ task: z.enum(ML_TASKS) }).passthrough(),
});

/** Guarda el informe de un análisis (sin valores ni puntos de tus datos). */
export async function POST(req: Request) {
  const ctx = await getSessionContext();
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success || body.data.result.task !== body.data.config.task) {
    return NextResponse.json({ error: 'invalid_config' }, { status: 400 });
  }
  const { config } = body.data;

  // RLS: el archivo debe ser de la empresa del usuario.
  const { data: file } = await ctx.supabase.from('shared_files_metadata').select('id').eq('id', config.fileId).maybeSingle();
  if (!file) return NextResponse.json({ error: 'file_not_found' }, { status: 404 });

  const { count } = await ctx.supabase.from('ml_reports').select('id', { count: 'exact', head: true });
  if ((count ?? 0) >= MAX_REPORTS) return NextResponse.json({ error: 'too_many_reports' }, { status: 409 });

  // Se vacían los datos de fila: solo se conserva el informe.
  const summary = toSavedSummary(body.data.result as unknown as MlResult);
  const title = mlTitle(config);

  const { data, error } = await ctx.supabase
    .from('ml_reports')
    .insert({
      company_id: ctx.companyId,
      user_id: ctx.user.id,
      file_id: file.id,
      title,
      task: config.task,
      config,
      summary,
    })
    .select('id, file_id, title, task, config, summary, created_at')
    .single();
  if (error) return NextResponse.json({ error: 'db_error' }, { status: 500 });
  return NextResponse.json({ report: data });
}
