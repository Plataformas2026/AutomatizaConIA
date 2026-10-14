import { NextResponse } from 'next/server';
import { getSessionContext } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { decrypt } from '@/lib/crypto';
import { getAccessToken } from '@/lib/google/oauth';
import { downloadFile, FileTooLargeError, getFileMeta, GoogleApiError } from '@/lib/google/drive';
import { parseMimeFor, parseWorkbook, type SheetSelection } from '@/lib/parsing/parse';
import { formatCell } from '@/lib/email/render';
import type { PreviewData } from '@/lib/agents/local-api';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const PREVIEW_ROWS = 100;
const PREVIEW_COLS = 30;
const CELL_CHARS = 120;

/**
 * Vista previa de un archivo de GOOGLE DRIVE: se lee al vuelo, se devuelven las primeras filas y se
 * descarta. No se guarda nada. (Los archivos locales no pasan por aquí: los muestra el agente de tu PC.)
 */
export async function GET(req: Request, { params }: { params: Promise<{ fileId: string }> }) {
  const { fileId } = await params;
  const ctx = await getSessionContext();
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data: file } = await ctx.supabase
    .from('shared_files_metadata')
    .select('id, source, name, google_token_id, drive_file_id, sheet_mode, sheet_names')
    .eq('id', fileId)
    .eq('company_id', ctx.companyId)
    .maybeSingle();
  if (!file) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (file.source === 'local') return NextResponse.json({ error: 'use_agent' }, { status: 409 });

  const admin = createAdminClient();
  const { data: token } = await admin
    .from('google_tokens')
    .select('id, refresh_token_enc, status')
    .eq('id', file.google_token_id)
    .maybeSingle();
  if (!token || token.status !== 'active') return NextResponse.json({ error: 'google_not_connected' }, { status: 409 });

  const wanted = new URL(req.url).searchParams.get('sheet')?.slice(0, 200) || null;
  const own: SheetSelection = {
    mode: (file.sheet_mode ?? 'first') as SheetSelection['mode'],
    names: (file.sheet_names ?? []) as string[],
  };

  try {
    const accessToken = await getAccessToken(token.id, decrypt(token.refresh_token_enc));
    const meta = await getFileMeta(accessToken, file.drive_file_id);
    const buffer = await downloadFile(accessToken, meta);
    let workbook = parseWorkbook(buffer, parseMimeFor(meta.mimeType), own);
    if (wanted && workbook.available.includes(wanted)) {
      workbook = parseWorkbook(buffer, parseMimeFor(meta.mimeType), { mode: 'selected', names: [wanted] });
    }

    const first = workbook.sheets[0];
    const headers = first?.table.headers.slice(0, PREVIEW_COLS) ?? [];
    const rows = (first?.table.rows ?? []).slice(0, PREVIEW_ROWS).map((r) => ({
      n: r.rowNumber,
      cells: headers.map((h) => formatCell(r.values[h]).slice(0, CELL_CHARS)),
    }));
    const body: PreviewData = {
      fileName: file.name,
      sheets: workbook.available,
      sheet: first?.sheetName ?? null,
      headers,
      rows,
      totalRows: first?.table.rows.length ?? 0,
      truncated: (first?.table.rows.length ?? 0) > PREVIEW_ROWS || (first?.table.headers.length ?? 0) > PREVIEW_COLS,
    };
    return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    if (e instanceof FileTooLargeError) return NextResponse.json({ error: 'file_too_large' }, { status: 413 });
    if (e instanceof GoogleApiError && (e.status === 403 || e.status === 404)) {
      return NextResponse.json({ error: 'file_not_accessible' }, { status: 403 });
    }
    return NextResponse.json({ error: 'read_error' }, { status: 502 });
  }
}
