import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSessionContext } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { decrypt } from '@/lib/crypto';
import { getAccessToken } from '@/lib/google/oauth';
import { ALLOWED_MIME_TYPES, getFileMeta, GoogleApiError } from '@/lib/google/drive';
import { startWatch } from '@/lib/google/watch';
import {
  checkSheetSelection,
  normalizeSelection,
  sheetModeSchema,
  sheetNamesSchema,
} from '@/lib/files/sheet-selection';

export const dynamic = 'force-dynamic';

const bodySchema = z
  .object({
    driveFileId: z.string().min(5).max(200),
    // Hojas a vigilar (solo aplica a Excel / Google Sheets). Por defecto: la primera.
    sheetMode: sheetModeSchema.default('first'),
    sheetNames: sheetNamesSchema.default([]),
  })
  .superRefine(checkSheetSelection);

/** Registra el archivo elegido en el Picker y abre su canal de notificaciones. */
export async function POST(req: Request) {
  const ctx = await getSessionContext();
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });

  const admin = createAdminClient();
  const { data: token } = await admin
    .from('google_tokens')
    .select('id, refresh_token_enc')
    .eq('company_id', ctx.companyId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!token) return NextResponse.json({ error: 'google_not_connected' }, { status: 409 });

  let accessToken: string;
  let meta;
  try {
    accessToken = await getAccessToken(token.id, decrypt(token.refresh_token_enc));
    // Si el Picker no concedió acceso a este archivo, Drive responde 404/403 aquí.
    meta = await getFileMeta(accessToken, body.data.driveFileId);
  } catch (e) {
    if (e instanceof GoogleApiError && (e.status === 403 || e.status === 404)) {
      return NextResponse.json({ error: 'file_not_accessible' }, { status: 403 });
    }
    return NextResponse.json({ error: 'google_error' }, { status: 502 });
  }

  if (!ALLOWED_MIME_TYPES.has(meta.mimeType)) {
    return NextResponse.json({ error: 'unsupported_type', mimeType: meta.mimeType }, { status: 415 });
  }

  const { data: file, error: insertError } = await admin
    .from('shared_files_metadata')
    .insert({
      company_id: ctx.companyId,
      google_token_id: token.id,
      drive_file_id: meta.id,
      name: meta.name,
      mime_type: meta.mimeType,
      status: 'active',
      last_version: meta.version, // base de referencia: solo reaccionamos a cambios posteriores
      created_by: ctx.user.id,
      // Un CSV no tiene hojas: siempre "first".
      ...(meta.mimeType === 'text/csv'
        ? { sheet_mode: 'first', sheet_names: [] }
        : normalizeSelection(body.data.sheetMode, body.data.sheetNames)),
    })
    .select('id')
    .single();

  if (insertError) {
    const duplicate = insertError.code === '23505';
    return NextResponse.json({ error: duplicate ? 'already_added' : 'db_error' }, { status: duplicate ? 409 : 500 });
  }

  try {
    const channel = await startWatch(accessToken, meta.id);
    await admin
      .from('shared_files_metadata')
      .update({
        watch_channel_id: channel.channelId,
        watch_resource_id: channel.resourceId,
        watch_expires_at: channel.expiresAt.toISOString(),
      })
      .eq('id', file.id);
  } catch (e) {
    // Sin canal no hay tiempo real: no dejamos un archivo "a medias".
    await admin.from('shared_files_metadata').delete().eq('id', file.id);
    const reason = e instanceof GoogleApiError ? e.reason : 'watch_failed';
    return NextResponse.json({ error: 'watch_failed', reason }, { status: 502 });
  }

  return NextResponse.json({ id: file.id, name: meta.name }, { status: 201 });
}
