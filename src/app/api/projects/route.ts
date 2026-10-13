import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSessionContext } from '@/lib/auth';
import { coverSchema, MAX_PROJECTS, projectNameSchema } from '@/lib/projects/types';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  name: projectNameSchema,
  cover: coverSchema.nullable().optional(),
});

/** Crea un proyecto (nombre + portada opcional). */
export async function POST(req: Request) {
  const ctx = await getSessionContext();
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const raw = await req.json().catch(() => null);
  const body = bodySchema.safeParse(raw);
  if (!body.success) {
    const coverIssue = body.error.issues.some((i) => i.path[0] === 'cover');
    return NextResponse.json({ error: coverIssue ? 'invalid_cover' : 'name' }, { status: 400 });
  }

  const { count } = await ctx.supabase.from('projects').select('id', { count: 'exact', head: true }).eq('company_id', ctx.companyId);
  if ((count ?? 0) >= MAX_PROJECTS) return NextResponse.json({ error: 'too_many_projects' }, { status: 409 });

  const { data, error } = await ctx.supabase
    .from('projects')
    .insert({
      company_id: ctx.companyId,
      name: body.data.name,
      cover: body.data.cover ?? null,
      created_by: ctx.user.id,
    })
    .select('id')
    .single();
  if (error) return NextResponse.json({ error: 'db_error' }, { status: 500 });

  return NextResponse.json({ id: data.id }, { status: 201 });
}
