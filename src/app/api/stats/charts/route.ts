import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSessionContext } from '@/lib/auth';
import { chartConfigSchema, MAX_CHARTS } from '@/lib/stats/types';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({ config: chartConfigSchema });

/** Guarda una gráfica nueva del usuario (solo su configuración). */
export async function POST(req: Request) {
  const ctx = await getSessionContext();
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: 'invalid_config' }, { status: 400 });
  const { config } = body.data;

  // RLS: el archivo debe ser de la empresa del usuario.
  const { data: file } = await ctx.supabase
    .from('shared_files_metadata')
    .select('id')
    .eq('id', config.fileId)
    .maybeSingle();
  if (!file) return NextResponse.json({ error: 'file_not_found' }, { status: 404 });

  const { data: existing, error: listError } = await ctx.supabase
    .from('stats_charts')
    .select('position')
    .order('position', { ascending: false })
    .limit(MAX_CHARTS + 1);
  if (listError) return NextResponse.json({ error: 'db_error' }, { status: 500 });
  if ((existing?.length ?? 0) >= MAX_CHARTS) {
    return NextResponse.json({ error: 'too_many_charts' }, { status: 409 });
  }
  const position = (existing?.[0]?.position ?? -1) + 1;

  const { data, error } = await ctx.supabase
    .from('stats_charts')
    .insert({ company_id: ctx.companyId, user_id: ctx.user.id, config, position })
    .select('id, config, position')
    .single();
  if (error) return NextResponse.json({ error: 'db_error' }, { status: 500 });
  return NextResponse.json({ chart: data });
}
