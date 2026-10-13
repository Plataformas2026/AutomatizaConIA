import { NextResponse } from 'next/server';
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { getSessionContext } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { agentNameSchema, MAX_AGENTS } from '@/lib/agents/types';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({ name: agentNameSchema });

/**
 * Crea un agente local y devuelve su token UNA SOLA VEZ.
 * En la base de datos solo se guarda el hash (sha256): si pierdes el token,
 * se crea otro agente y se borra el anterior.
 */
export async function POST(req: Request) {
  const ctx = await getSessionContext();
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: 'name' }, { status: 400 });

  const { count } = await ctx.supabase.from('local_agents').select('id', { count: 'exact', head: true });
  if ((count ?? 0) >= MAX_AGENTS) return NextResponse.json({ error: 'too_many_agents' }, { status: 409 });

  const token = `aci_${randomBytes(32).toString('base64url')}`;
  const tokenHash = createHash('sha256').update(token, 'utf8').digest('hex');

  const { data, error } = await createAdminClient()
    .from('local_agents')
    .insert({ company_id: ctx.companyId, name: body.data.name, token_hash: tokenHash, created_by: ctx.user.id })
    .select('id')
    .single();
  if (error) return NextResponse.json({ error: 'db_error' }, { status: 500 });

  return NextResponse.json({ id: data.id, token }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
}
