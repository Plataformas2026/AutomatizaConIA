import { NextResponse } from 'next/server';
import { getSessionContext } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { decrypt } from '@/lib/crypto';
import { getAccessToken } from '@/lib/google/oauth';
import { downloadFile, FileTooLargeError, getFileMeta, GoogleApiError } from '@/lib/google/drive';
import { parseMimeFor, parseWorkbook, type SheetSelection } from '@/lib/parsing/parse';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Devuelve la ESTRUCTURA del archivo (nombres de hojas y de columnas) para los
 * desplegables del creador de reglas y el selector de hojas. Lee el archivo al
 * vuelo y descarta el contenido; no se guarda nada.
 *
 *  - sheets:    todas las hojas que existen ([] en CSV)
 *  - selection: lo que el usuario eligió vigilar
 *  - active:    hojas que se vigilan ahora mismo
 *  - columns:   columnas de las hojas activas y en cuáles aparece cada una
 */
export async function GET(_req: Request, { params }: { params: Promise<{ fileId: string }> }) {
  const { fileId } = await params;
  const ctx = await getSessionContext();
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data: file } = await ctx.supabase
    .from('shared_files_metadata')
    .select('id, google_token_id, drive_file_id, sheet_mode, sheet_names')
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

  const selection: SheetSelection = {
    mode: (file.sheet_mode ?? 'first') as SheetSelection['mode'],
    names: (file.sheet_names ?? []) as string[],
  };

  try {
    const accessToken = await getAccessToken(token.id, decrypt(token.refresh_token_enc));
    const meta = await getFileMeta(accessToken, file.drive_file_id);
    const workbook = parseWorkbook(await downloadFile(accessToken, meta), parseMimeFor(meta.mimeType), selection);

    const columnMap = new Map<string, string[]>();
    for (const s of workbook.sheets) {
      for (const header of s.table.headers) {
        const list = columnMap.get(header) ?? [];
        if (s.sheetName) list.push(s.sheetName);
        columnMap.set(header, list);
      }
    }

    return NextResponse.json(
      {
        sheets: workbook.available,
        selection,
        active: workbook.sheets.map((s) => s.sheetName).filter((n): n is string => n !== null),
        columns: Array.from(columnMap, ([name, sheets]) => ({ name, sheets })),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    if (e instanceof FileTooLargeError) return NextResponse.json({ error: 'file_too_large' }, { status: 413 });
    if (e instanceof GoogleApiError && (e.status === 403 || e.status === 404)) {
      return NextResponse.json({ error: 'file_not_accessible' }, { status: 403 });
    }
    return NextResponse.json({ error: 'read_error' }, { status: 502 });
  }
}
