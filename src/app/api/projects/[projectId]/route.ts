import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSessionContext } from '@/lib/auth';
import { audit, dbForResource } from '@/lib/admin';
import { coverSchema, projectNameSchema } from '@/lib/projects/types';

export const dynamic = 'force-dynamic';

const patchSchema = z
  .object({
    name: projectNameSchema.optional(),
    // null = quitar la portada; ausente = no tocarla.
    cover: coverSchema.nullable().optional(),
  })
  .refine((b) => b.name !== undefined || b.cover !== undefined);

const idSchema = z.string().uuid();

/** Cambia el nombre y/o la portada. RLS limita todo a la empresa del usuario. */
export async function PATCH(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const ctx = await getSessionContext();
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!idSchema.safeParse(projectId).success) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const body = patchSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) {
    const coverIssue = body.error.issues.some((i) => i.path[0] === 'cover');
    return NextResponse.json({ error: coverIssue ? 'invalid_cover' : 'name' }, { status: 400 });
  }

  const update: { name?: string; cover?: string | null } = {};
  if (body.data.name !== undefined) update.name = body.data.name;
  if (body.data.cover !== undefined) update.cover = body.data.cover;

  const { data, error } = await dbForResource(ctx).from('projects').update(update).eq('id', projectId).select('id, company_id');
  if (error) return NextResponse.json({ error: 'db_error' }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  await audit(ctx, data[0].company_id as string, 'project.update', 'project', projectId);
  return NextResponse.json({ ok: true });
}

/** Borra el proyecto. Sus archivos NO se borran: pasan a estar sueltos (FK on delete set null). */
export async function DELETE(_req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const ctx = await getSessionContext();
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!idSchema.safeParse(projectId).success) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const { data, error } = await dbForResource(ctx).from('projects').delete().eq('id', projectId).select('id, company_id');
  if (error) return NextResponse.json({ error: 'db_error' }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  await audit(ctx, data[0].company_id as string, 'project.delete', 'project', projectId);
  return NextResponse.json({ ok: true });
}
