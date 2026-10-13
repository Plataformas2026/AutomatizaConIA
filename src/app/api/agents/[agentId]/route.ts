import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSessionContext } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

/** Elimina el agente: su token deja de funcionar al instante. Sus archivos quedan sin agente. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params;
  const ctx = await getSessionContext();
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!z.string().uuid().safeParse(agentId).success) return NextResponse.json({ error: 'agent_not_found' }, { status: 404 });

  // RLS: solo agentes de mi empresa.
  const { data: agent } = await ctx.supabase.from('local_agents').select('id').eq('id', agentId).maybeSingle();
  if (!agent) return NextResponse.json({ error: 'agent_not_found' }, { status: 404 });

  const { error } = await createAdminClient()
    .from('local_agents')
    .delete()
    .eq('id', agent.id)
    .eq('company_id', ctx.companyId);
  if (error) return NextResponse.json({ error: 'db_error' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
