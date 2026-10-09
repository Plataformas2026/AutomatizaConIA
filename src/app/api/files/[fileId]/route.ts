import { after, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSessionContext } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { decrypt } from '@/lib/crypto';
import { getAccessToken } from '@/lib/google/oauth';
import { stopWatch } from '@/lib/google/watch';
import { processFile } from '@/lib/pipeline/process-file';
import {
  checkSheetSelection,
  normalizeSelection,
  sheetModeSchema,
  sheetNamesSchema,
} from '@/lib/files/sheet-selection';

export const dynamic = 'force-dynamic';

const patchSchema = z
  .object({ sheetMode: sheetModeSchema, sheetNames: sheetNamesSchema.default([]) })
  .superRefine(checkSheetSelection);

/** Cambia qué hojas se vigilan y reevalúa las reglas con la nueva selección. */
export async function PATCH(req: Request, { params }: { params: Promise<{ fileId: string }> }) {
  const { fileId } = await params;
  const ctx = await getSessionContext();
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = patchSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });

  // RLS: si el archivo no es de su empresa, no aparece.
  const { data: file } = await ctx.supabase
    .from('shared_files_metadata')
    .select('id, mime_type')
    .eq('id', fileId)
    .maybeSingle();
  if (!file) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (file.mime_type === 'text/csv') return NextResponse.json({ error: 'no_sheets' }, { status: 400 });

  const selection = normalizeSelection(body.data.sheetMode, body.data.sheetNames);
  const { error } = await createAdminClient()
    .from('shared_files_metadata')
    .update({ ...selection, last_error: null })
    .eq('id', file.id);
  if (error) return NextResponse.json({ error: 'db_error' }, { status: 500 });

  after(async () => {
    try {
      await processFile(file.id, { force: true });
    } catch {
      /* el error queda reflejado en shared_files_metadata.last_error */
    }
  });

  return NextResponse.json({ ok: true, ...selection });
}

/** Deja de compartir el archivo: para el canal y borra su configuración. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ fileId: string }> }) {
  const { fileId } = await params;
  const ctx = await getSessionContext();
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // RLS: si el archivo no es de su empresa, no aparece.
  const { data: file } = await ctx.supabase
    .from('shared_files_metadata')
    .select('id, google_token_id, watch_channel_id, watch_resource_id')
    .eq('id', fileId)
    .maybeSingle();
  if (!file) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const admin = createAdminClient();

  if (file.watch_channel_id && file.watch_resource_id) {
    const { data: token } = await admin
      .from('google_tokens')
      .select('id, refresh_token_enc')
      .eq('id', file.google_token_id)
      .maybeSingle();
    if (token) {
      try {
        const accessToken = await getAccessToken(token.id, decrypt(token.refresh_token_enc));
        await stopWatch(accessToken, file.watch_channel_id, file.watch_resource_id);
      } catch {
        // Si no se puede parar, el canal caduca solo en ≤ 24 h y el webhook lo ignorará.
      }
    }
  }

  const { error } = await admin.from('shared_files_metadata').delete().eq('id', file.id);
  if (error) return NextResponse.json({ error: 'db_error' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
