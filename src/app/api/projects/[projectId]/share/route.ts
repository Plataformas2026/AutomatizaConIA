import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSessionContext } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

const MAX_SHARES = 20;
const idSchema = z.string().uuid();
const inviteSchema = z.object({ email: z.string().trim().toLowerCase().email().max(254) });
const notifySchema = z.object({ id: z.string().uuid(), notify: z.enum(['assigned', 'all']) });
const removeSchema = z.object({ kind: z.enum(['member', 'invitation']), id: z.string().uuid() });

/** Solo la empresa propietaria del proyecto puede gestionarlo. */
async function ownProject(projectId: string) {
  const ctx = await getSessionContext();
  if (!ctx) return { error: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) } as const;
  if (!idSchema.safeParse(projectId).success) {
    return { error: NextResponse.json({ error: 'not_found' }, { status: 404 }) } as const;
  }
  const { data: project } = await ctx.supabase
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .eq('company_id', ctx.companyId)
    .maybeSingle();
  if (!project) return { error: NextResponse.json({ error: 'not_found' }, { status: 404 }) } as const;
  return { ctx } as const;
}

/** Personas con acceso e invitaciones pendientes. */
export async function GET(_req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const r = await ownProject(projectId);
  if ('error' in r) return r.error;

  const admin = createAdminClient();
  const [{ data: members }, { data: invitations }] = await Promise.all([
    admin.from('project_members').select('user_id, created_at, notify').eq('project_id', projectId).order('created_at'),
    admin.from('project_invitations').select('id, email, created_at').eq('project_id', projectId).order('created_at'),
  ]);

  const people = await Promise.all(
    (members ?? []).map(async (m) => {
      const { data } = await admin.auth.admin.getUserById(m.user_id);
      return { id: m.user_id as string, email: data.user?.email ?? 'Usuario', since: m.created_at as string, notify: (m.notify as string) === 'all' ? 'all' : 'assigned' };
    }),
  );

  return NextResponse.json(
    { members: people, invitations: invitations ?? [] },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

/** Invita por correo. Al entrar con ese correo (confirmado), la persona verá el proyecto. */
export async function POST(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const r = await ownProject(projectId);
  if ('error' in r) return r.error;
  const { ctx } = r;

  const body = inviteSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: 'invalid_email' }, { status: 400 });
  if (body.data.email === (ctx.user.email ?? '').toLowerCase()) {
    return NextResponse.json({ error: 'self_invite' }, { status: 400 });
  }

  const admin = createAdminClient();
  const [{ count: members }, { count: pending }] = await Promise.all([
    admin.from('project_members').select('user_id', { count: 'exact', head: true }).eq('project_id', projectId),
    admin.from('project_invitations').select('id', { count: 'exact', head: true }).eq('project_id', projectId),
  ]);
  if ((members ?? 0) + (pending ?? 0) >= MAX_SHARES) {
    return NextResponse.json({ error: 'too_many_shares' }, { status: 409 });
  }

  const { error } = await admin
    .from('project_invitations')
    .upsert({ project_id: projectId, email: body.data.email, invited_by: ctx.user.id }, { onConflict: 'project_id,email' });
  if (error) return NextResponse.json({ error: 'db_error' }, { status: 500 });
  return NextResponse.json({ ok: true }, { status: 201 });
}

/** Elige qué avisos recibe una persona: solo los suyos (según las columnas del Excel) o todos los del proyecto. */
export async function PATCH(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const r = await ownProject(projectId);
  if ('error' in r) return r.error;
  const body = notifySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const admin = createAdminClient();
  const { error } = await admin
    .from('project_members')
    .update({ notify: body.data.notify })
    .eq('project_id', projectId)
    .eq('user_id', body.data.id);
  if (error) return NextResponse.json({ error: 'db_error' }, { status: 500 });
  return NextResponse.json({ ok: true });
}

/** Quita el acceso de una persona o cancela una invitación. */
export async function DELETE(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const r = await ownProject(projectId);
  if ('error' in r) return r.error;

  const body = removeSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });

  const admin = createAdminClient();
  const { error } =
    body.data.kind === 'member'
      ? await admin.from('project_members').delete().eq('project_id', projectId).eq('user_id', body.data.id)
      : await admin.from('project_invitations').delete().eq('project_id', projectId).eq('id', body.data.id);
  if (error) return NextResponse.json({ error: 'db_error' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
