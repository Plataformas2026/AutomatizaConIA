import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSessionContext } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { decrypt } from '@/lib/crypto';
import { getAccessToken } from '@/lib/google/oauth';
import { ALLOWED_MIME_TYPES, downloadFile, FileTooLargeError, getFileMeta, GoogleApiError } from '@/lib/google/drive';
import { listSheets, parseMimeFor } from '@/lib/parsing/parse';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const bodySchema = z.object({ driveFileId: z.string().min(5).max(200) });

/**
 * Antes de vincular un archivo: devuelve su nombre y la lista de hojas para que
 * el usuario elija cuáles vigilar. Lee el archivo al vuelo y descarta el
 * contenido; solo salen los NOMBRES de las hojas.
 */
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

  try {
    const accessToken = await getAccessToken(token.id, decrypt(token.refresh_token_enc));
    const meta = await getFileMeta(accessToken, body.data.driveFileId);

    if (!ALLOWED_MIME_TYPES.has(meta.mimeType)) {
      return NextResponse.json({ error: 'unsupported_type', mimeType: meta.mimeType }, { status: 415 });
    }

    const mime = parseMimeFor(meta.mimeType);
    const sheets = mime === 'text/csv' ? [] : listSheets(await downloadFile(accessToken, meta), mime);

    return NextResponse.json(
      { name: meta.name, mimeType: meta.mimeType, sheets },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    if (e instanceof FileTooLargeError) return NextResponse.json({ error: 'file_too_large' }, { status: 413 });
    if (e instanceof GoogleApiError && (e.status === 403 || e.status === 404)) {
      return NextResponse.json({ error: 'file_not_accessible' }, { status: 403 });
    }
    return NextResponse.json({ error: 'google_error' }, { status: 502 });
  }
}
