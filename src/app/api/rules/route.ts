import { after } from 'next/server';
import { NextResponse } from 'next/server';
import { getSessionContext } from '@/lib/auth';
import { audit, dbForResource } from '@/lib/admin';
import { createRuleSchema } from '@/lib/rules/types';
import { templatesBelong } from '@/lib/templates/check';
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

  // Usuario normal: RLS + company_id de la sesión. Administrador: cualquier archivo; la regla
  // se guarda con la empresa del propio archivo (así llega al agente y a las alertas de su dueño).
  const db = dbForResource(ctx);
  let fileQuery = db.from('shared_files_metadata').select('id, company_id, source').eq('id', fileId);
  if (!ctx.isAdmin) fileQuery = fileQuery.eq('company_id', ctx.companyId);
  const { data: file } = await fileQuery.maybeSingle();
  if (!file) return NextResponse.json({ error: 'file_not_found' }, { status: 404 });

  if (!(await templatesBelong(db, file.company_id as string, actions))) {
    return NextResponse.json({ error: 'template_not_found' }, { status: 400 });
  }

  const { data: rule, error } = await db
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

  await audit(ctx, file.company_id as string, 'rule.create', 'rule', rule.id);

  // force: evalúa ya, aunque la versión del archivo no haya cambiado.
  // Archivo local: lo evalúa el agente del PC en su próxima sincronización (≤ 1 min).
  if (file.source !== 'local') {
    after(async () => {
      try {
        await processFile(file.id, { force: true });
      } catch {
        /* el error queda reflejado en shared_files_metadata.last_error */
      }
    });
  }

  return NextResponse.json(rule, { status: 201 });
}
