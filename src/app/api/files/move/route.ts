import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSessionContext } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { MAX_MOVE_FILES } from '@/lib/projects/types';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  fileIds: z.array(z.string().uuid()).min(1).max(MAX_MOVE_FILES),
  projectId: z.string().uuid().nullable(), // null = sacar del proyecto (suelto)
});

/** Mueve uno o varios archivos a un proyecto, o los deja sueltos (projectId = null). */
export async function POST(req: Request) {
  const ctx = await getSessionContext();
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });

  // El destino debe ser un proyecto de MI empresa (RLS lo filtra).
  if (body.data.projectId) {
    const { data: project } = await ctx.supabase
      .from('projects')
      .select('id')
      .eq('id', body.data.projectId)
      .eq('company_id', ctx.companyId)
      .maybeSingle();
    if (!project) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  // Las altas/cambios de archivos van con service_role: se acota SIEMPRE por company_id de la sesión.
  const { data, error } = await createAdminClient()
    .from('shared_files_metadata')
    .update({ project_id: body.data.projectId })
    .in('id', body.data.fileIds)
    .eq('company_id', ctx.companyId)
    .select('id');
  if (error) return NextResponse.json({ error: 'db_error' }, { status: 500 });

  return NextResponse.json({ moved: data?.length ?? 0 });
}
