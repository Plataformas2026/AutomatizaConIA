import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSessionContext } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { baseName, localPathSchema } from '@/lib/agents/types';

export const dynamic = 'force-dynamic';

const patchSchema = z.object({ path: localPathSchema.nullable() });

/** Cambia (o quita) la ruta de un archivo local. El agente la recoge en menos de un minuto. */
export async function PATCH(req: Request, { params }: { params: Promise<{ fileId: string }> }) {
  const { fileId } = await params;
  const ctx = await getSessionContext();
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!z.string().uuid().safeParse(fileId).success) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const body = patchSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });

  const { data: file } = await ctx.supabase
    .from('shared_files_metadata')
    .select('id, name, source')
    .eq('id', fileId)
    .eq('company_id', ctx.companyId)
    .maybeSingle();
  if (!file || file.source !== 'local') return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const path = body.data.path?.trim() || null;
  if (path && baseName(path).toLowerCase() !== file.name.toLowerCase()) {
    return NextResponse.json({ error: 'path_mismatch' }, { status: 400 });
  }

  const { error } = await createAdminClient()
    .from('shared_files_metadata')
    .update({ local_path: path, last_error: null })
    .eq('id', file.id)
    .eq('company_id', ctx.companyId);
  if (error) return NextResponse.json({ error: 'db_error' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
