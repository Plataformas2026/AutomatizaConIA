import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSessionContext } from '@/lib/auth';
import { audit, companyOfUser, userIdSchema } from '@/lib/admin';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

/** Nombres por los que se reconoce a un usuario en las columnas de reparto («María López», «mlopez»…). */
export async function GET(req: Request) {
  const ctx = await getSessionContext();
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!ctx.isAdmin) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const userId = userIdSchema.safeParse(new URL(req.url).searchParams.get('userId'));
  if (!userId.success) return NextResponse.json({ error: 'invalid_user' }, { status: 400 });

  const { data, error } = await createAdminClient().from('user_aliases').select('alias').eq('user_id', userId.data).order('alias');
  if (error) return NextResponse.json({ error: 'db_error' }, { status: 500 });
  return NextResponse.json({ aliases: (data ?? []).map((r) => r.alias as string) });
}

const putSchema = z.object({
  userId: userIdSchema,
  aliases: z.array(z.string().trim().min(1).max(100)).max(10),
});

/** Sustituye la lista de alias del usuario. */
export async function PUT(req: Request) {
  const ctx = await getSessionContext();
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!ctx.isAdmin) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const body = putSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });

  const companyId = await companyOfUser(body.data.userId);
  if (!companyId) return NextResponse.json({ error: 'user_not_found' }, { status: 404 });

  const aliases = [...new Set(body.data.aliases)];
  const db = createAdminClient();
  const del = await db.from('user_aliases').delete().eq('user_id', body.data.userId);
  if (del.error) return NextResponse.json({ error: 'db_error' }, { status: 500 });
  if (aliases.length) {
    const ins = await db.from('user_aliases').insert(aliases.map((alias) => ({ user_id: body.data.userId, alias })));
    if (ins.error) return NextResponse.json({ error: 'db_error' }, { status: 500 });
  }
  await audit(ctx, companyId, 'aliases.update', 'user', body.data.userId);
  return NextResponse.json({ ok: true, aliases });
}
