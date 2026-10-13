import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSessionContext } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({ action: z.enum(['sent', 'dismissed']) });

/**
 * «Ya lo he enviado» / «Descartar». El contenido del correo (destinatario, asunto, texto)
 * se borra en el mismo momento: solo queda un registro sin datos que se limpia a los 7 días.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getSessionContext();
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });

  const { data, error } = await createAdminClient()
    .from('email_outbox')
    .update({
      status: body.data.action,
      resolved_at: new Date().toISOString(),
      resolved_by: ctx.user.id,
      from_addr: null,
      to_addr: null,
      subject: null,
      body: null,
      problem: null,
    })
    .eq('id', id)
    .eq('company_id', ctx.companyId)
    .in('status', ['pending', 'drafted'])
    .select('id');
  if (error) return NextResponse.json({ error: 'db_error' }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
