import { NextResponse } from 'next/server';
import { getSessionContext } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { decrypt } from '@/lib/crypto';
import { getAccessToken } from '@/lib/google/oauth';
import { downloadFile, FileTooLargeError, getFileMeta, GoogleApiError } from '@/lib/google/drive';
import { parseTable } from '@/lib/parsing/parse';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Devuelve SOLO los nombres de columna para rellenar los desplegables del
 * creador de reglas. Lee el archivo al vuelo y descarta el contenido; no se
 * guarda ni siquiera la lista de columnas (se pide cada vez).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ fileId: string }> }) {
  const { fileId } = await params;
  const ctx = await getSessionContext();
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data: file } = await ctx.supabase
    .from('shared_files_metadata')
    .select('id, google_token_id, drive_file_id, mime_type')
    .eq('id', fileId)
    .maybeSingle();
  if (!file) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const admin = createAdminClient();
  const { data: token } = await admin
    .from('google_tokens')
    .select('id, refresh_token_enc, status')
    .eq('id', file.google_token_id)
    .maybeSingle();
  if (!token || token.status !== 'active') {
    return NextResponse.json({ error: 'google_not_connected' }, { status: 409 });
  }

  try {
    const accessToken = await getAccessToken(token.id, decrypt(token.refresh_token_enc));
    const meta = await getFileMeta(accessToken, file.drive_file_id);
    const table = parseTable(await downloadFile(accessToken, meta), meta.mimeType);
    return NextResponse.json({ columns: table.headers }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    if (e instanceof FileTooLargeError) return NextResponse.json({ error: 'file_too_large' }, { status: 413 });
    if (e instanceof GoogleApiError && (e.status === 403 || e.status === 404)) {
      return NextResponse.json({ error: 'file_not_accessible' }, { status: 403 });
    }
    return NextResponse.json({ error: 'read_error' }, { status: 502 });
  }
}
