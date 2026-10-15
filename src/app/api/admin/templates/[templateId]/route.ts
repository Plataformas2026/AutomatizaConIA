import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSessionContext } from '@/lib/auth';
import { audit } from '@/lib/admin';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

const idSchema = z.string().uuid();
const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    /** campo de la plantilla → nombre de columna ('' = sin asignar) */
    mapping: z.record(z.string().min(1).max(80), z.string().max(200)).refine((m) => Object.keys(m).length <= 200).optional(),
  })
  .refine((b) => b.name !== undefined || b.mapping !== undefined);

/** Cambia el nombre o el mapeo campo → columna de una plantilla (solo administradores). */
export async function PATCH(req: Request, { params }: { params: Promise<{ templateId: string }> }) {
  const { templateId } = await params;
  const ctx = await getSessionContext();
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!ctx.isAdmin) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (!idSchema.safeParse(templateId).success) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const body = patchSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });

  const update: { name?: string; mapping?: Record<string, string>; updated_at: string } = { updated_at: new Date().toISOString() };
  if (body.data.name !== undefined) update.name = body.data.name;
  if (body.data.mapping !== undefined) update.mapping = Object.fromEntries(Object.entries(body.data.mapping).filter(([, v]) => v.trim() !== ''));

  const { data, error } = await createAdminClient()
    .from('report_templates')
    .update(update)
    .eq('id', templateId)
    .select('id, company_id')
    .maybeSingle();
  if (error) return NextResponse.json({ error: 'db_error' }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  await audit(ctx, data.company_id as string, 'template.update', 'template', templateId);
  return NextResponse.json({ ok: true });
}

/** Borra la plantilla. Las reglas que la usaban conservan su aviso, pero sin botón «Rellenar». */
export async function DELETE(_req: Request, { params }: { params: Promise<{ templateId: string }> }) {
  const { templateId } = await params;
  const ctx = await getSessionContext();
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!ctx.isAdmin) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (!idSchema.safeParse(templateId).success) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const { data, error } = await createAdminClient().from('report_templates').delete().eq('id', templateId).select('id, company_id');
  if (error) return NextResponse.json({ error: 'db_error' }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  await audit(ctx, data[0].company_id as string, 'template.delete', 'template', templateId);
  return NextResponse.json({ ok: true });
}
