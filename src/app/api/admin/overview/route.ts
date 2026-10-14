import { NextResponse } from 'next/server';
import { getSessionContext } from '@/lib/auth';
import { companyOfUser, userIdSchema } from '@/lib/admin';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

/** Proyectos y archivos de un usuario (solo metadatos), para que el administrador los gestione. */
export async function GET(req: Request) {
  const ctx = await getSessionContext();
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!ctx.isAdmin) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const userId = userIdSchema.safeParse(new URL(req.url).searchParams.get('userId'));
  if (!userId.success) return NextResponse.json({ error: 'invalid_user' }, { status: 400 });
  const companyId = await companyOfUser(userId.data);
  if (!companyId) return NextResponse.json({ error: 'user_not_found' }, { status: 404 });

  const db = createAdminClient();
  const [{ data: projects }, { data: files }] = await Promise.all([
    db.from('projects').select('id, name, cover, created_at').eq('company_id', companyId).order('created_at', { ascending: false }),
    db
      .from('shared_files_metadata')
      .select('id, name, source, status, project_id, last_error')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(500),
  ]);

  const ids = (files ?? []).map((f) => f.id as string);
  const ruleCount: Record<string, number> = {};
  if (ids.length) {
    const { data: rules } = await db.from('rules').select('file_id').in('file_id', ids);
    for (const r of rules ?? []) ruleCount[r.file_id as string] = (ruleCount[r.file_id as string] ?? 0) + 1;
  }

  return NextResponse.json({
    companyId,
    projects: projects ?? [],
    files: (files ?? []).map((f) => ({ ...f, rules: ruleCount[f.id as string] ?? 0 })),
  });
}
