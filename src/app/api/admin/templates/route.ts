import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSessionContext } from '@/lib/auth';
import { audit, companyOfUser, userIdSchema } from '@/lib/admin';
import { createAdminClient } from '@/lib/supabase/admin';
import { listFields, MAX_TEMPLATE_BYTES, TemplateError } from '@/lib/templates/docx';

export const dynamic = 'force-dynamic';

const MAX_TEMPLATES = 30;

/** Plantillas de la cuenta de un usuario (solo administradores). No devuelve el contenido del documento. */
export async function GET(req: Request) {
  const ctx = await getSessionContext();
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!ctx.isAdmin) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const userId = userIdSchema.safeParse(new URL(req.url).searchParams.get('userId'));
  if (!userId.success) return NextResponse.json({ error: 'invalid_user' }, { status: 400 });
  const companyId = await companyOfUser(userId.data);
  if (!companyId) return NextResponse.json({ error: 'user_not_found' }, { status: 404 });

  const { data, error } = await createAdminClient()
    .from('report_templates')
    .select('id, name, file_name, fields, mapping, created_at')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: 'db_error' }, { status: 500 });
  return NextResponse.json({ templates: data ?? [] });
}

const bodySchema = z.object({
  userId: userIdSchema,
  name: z.string().trim().min(1).max(120),
  fileName: z.string().trim().min(1).max(200),
  contentB64: z.string().min(100).max(1_800_000),
});

/** Sube una plantilla Word (.docx) con campos {{así}} a la cuenta de un usuario. */
export async function POST(req: Request) {
  const ctx = await getSessionContext();
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!ctx.isAdmin) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(body.data.contentB64)) return NextResponse.json({ error: 'invalid_file' }, { status: 400 });

  const bytes = new Uint8Array(Buffer.from(body.data.contentB64, 'base64'));
  if (bytes.byteLength > MAX_TEMPLATE_BYTES) return NextResponse.json({ error: 'too_big' }, { status: 413 });
  let fields: string[];
  try {
    fields = await listFields(bytes);
  } catch (e) {
    if (e instanceof TemplateError) return NextResponse.json({ error: 'not_docx' }, { status: 400 });
    throw e;
  }
  if (fields.length === 0) return NextResponse.json({ error: 'no_fields' }, { status: 422 });

  const companyId = await companyOfUser(body.data.userId);
  if (!companyId) return NextResponse.json({ error: 'user_not_found' }, { status: 404 });
  const db = createAdminClient();
  const { count } = await db.from('report_templates').select('id', { count: 'exact', head: true }).eq('company_id', companyId);
  if ((count ?? 0) >= MAX_TEMPLATES) return NextResponse.json({ error: 'too_many' }, { status: 409 });

  const { data, error } = await db
    .from('report_templates')
    .insert({
      company_id: companyId,
      name: body.data.name,
      file_name: body.data.fileName,
      content_b64: body.data.contentB64,
      fields,
      mapping: {},
      created_by: ctx.user.id,
    })
    .select('id, name, file_name, fields, mapping, created_at')
    .single();
  if (error) return NextResponse.json({ error: 'db_error' }, { status: 500 });
  await audit(ctx, companyId, 'template.create', 'template', data.id as string);
  return NextResponse.json(data, { status: 201 });
}
