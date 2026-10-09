import { after } from 'next/server';
import { NextResponse } from 'next/server';
import { getSessionContext } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { updateRuleSchema } from '@/lib/rules/types';
import { processFile } from '@/lib/pipeline/process-file';

export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, { params }: { params: Promise<{ ruleId: string }> }) {
  const { ruleId } = await params;
  const ctx = await getSessionContext();
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = updateRuleSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const patch = parsed.data;

  const { data: rule, error } = await ctx.supabase
    .from('rules')
    .update(patch)
    .eq('id', ruleId)
    .select('id, file_id, name, enabled, condition, actions, last_error, last_evaluated_at')
    .maybeSingle();
  if (error) return NextResponse.json({ error: 'db_error' }, { status: 500 });
  if (!rule) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // Si cambia lo que la regla evalúa (o se reactiva), se reinicia su huella
  // para que pueda volver a alertar, y se reevalúa ahora.
  if (patch.condition || patch.actions || patch.enabled === true) {
    await createAdminClient().from('rules').update({ last_fingerprint: null }).eq('id', rule.id);
    after(async () => {
      try {
        await processFile(rule.file_id, { force: true });
      } catch {
        /* ver last_error del archivo */
      }
    });
  }
  return NextResponse.json(rule);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ ruleId: string }> }) {
  const { ruleId } = await params;
  const ctx = await getSessionContext();
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { error } = await ctx.supabase.from('rules').delete().eq('id', ruleId);
  if (error) return NextResponse.json({ error: 'db_error' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
