import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSessionContext, type SessionContext } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { audit } from '@/lib/admin';
import { MAX_MOVE_FILES } from '@/lib/projects/types';

function dbFor(ctx: SessionContext) {
  return ctx.isAdmin ? createAdminClient() : ctx.supabase;
}

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

  // Empresa sobre la que se actúa: la propia; un administrador, la del proyecto de destino.
  let companyId: string | null = ctx.companyId;
  if (body.data.projectId) {
    const { data: project } = await dbFor(ctx)
      .from('projects')
      .select('id, company_id')
      .eq('id', body.data.projectId)
      .maybeSingle();
    if (!project) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    if (project.company_id !== ctx.companyId && !ctx.isAdmin) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    companyId = project.company_id as string;
  }

  // Las altas/cambios de archivos van con service_role: se acota SIEMPRE por company_id
  // (el de la sesión, o —solo administradores— el del proyecto de destino).
  const { data, error } = await createAdminClient()
    .from('shared_files_metadata')
    .update({ project_id: body.data.projectId })
    .in('id', body.data.fileIds)
    .eq('company_id', companyId)
    .select('id');
  if (error) return NextResponse.json({ error: 'db_error' }, { status: 500 });

  if (data?.length) await audit(ctx, companyId, 'file.move', 'file', null);
  return NextResponse.json({ moved: data?.length ?? 0 });
}
