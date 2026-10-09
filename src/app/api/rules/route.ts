import { after } from 'next/server';
import { NextResponse } from 'next/server';
import { getSessionContext } from '@/lib/auth';
import { createRuleSchema } from '@/lib/rules/types';
import { processFile } from '@/lib/pipeline/process-file';

export const dynamic = 'force-dynamic';

/** Crea una regla. Valida con Zod, escribe con la sesión del usuario (RLS) y
 *  la evalúa de inmediato contra el estado actual del archivo. */
export async function POST(req: Request) {
  const ctx = await getSessionContext();
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = createRuleSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_body', issues: parsed.error.flatten() }, { status: 400 });
  }
  const { fileId, name, condition, actions } = parsed.data;

  // RLS garantiza que el archivo es de la empresa del usuario.
  const { data: file } = await ctx.supabase
    .from('shared_files_metadata')
    .select('id, company_id')
    .eq('id', fileId)
    .maybeSingle();
  if (!file) return NextResponse.json({ error: 'file_not_found' }, { status: 404 });

  const { data: rule, error } = await ctx.supabase
    .from('rules')
    .insert({
      company_id: file.company_id,
      file_id: file.id,
      name,
      condition,
      actions,
      created_by: ctx.user.id,
    })
    .select('id, name, enabled, condition, actions, last_error, last_evaluated_at')
    .single();
  if (error) return NextResponse.json({ error: 'db_error' }, { status: 500 });

  // force: evalúa ya, aunque la versión del archivo no haya cambiado.
  after(async () => {
    try {
      await processFile(file.id, { force: true });
    } catch {
      /* el error queda reflejado en shared_files_metadata.last_error */
    }
  });

  return NextResponse.json(rule, { status: 201 });
}
