import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSessionContext } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { decrypt } from '@/lib/crypto';
import { getAccessToken } from '@/lib/google/oauth';
import { downloadFile, FileTooLargeError, getFileMeta, GoogleApiError } from '@/lib/google/drive';
import { parseMimeFor, parseWorkbook } from '@/lib/parsing/parse';
import { formatCell } from '@/lib/email/render';
import { conditionColumns } from '@/lib/rules/engine';
import { conditionSchema } from '@/lib/rules/types';
import { ALERT_ROWS_MAX, ALERT_ROWS_COLS, type AlertRowsResponse } from '@/lib/alerts/rows';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const bodySchema = z.object({ alertId: z.string().uuid() });
const CELL_CHARS = 120;

/**
 * Detalle de una alerta: las filas exactas que la dispararon.
 *  · Archivo de Google Drive: se lee AL VUELO y se devuelve el texto de esas filas (no se guarda nada).
 *  · Archivo local: el servidor no tiene el archivo. Devuelve qué filas pedir y el navegador se las pide
 *    al agente de ese ordenador (los datos no pasan por ningún servidor).
 * Solo se pueden ver filas que figuran en la alerta, y solo alertas visibles para la persona (RLS).
 */
export async function POST(req: Request) {
  const ctx = await getSessionContext();
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });

  const { data: alert } = await ctx.supabase
    .from('alerts')
    .select('id, company_id, file_id, rule_id, sheet_name, row_refs, matched_count')
    .eq('id', body.data.alertId)
    .maybeSingle();
  if (!alert || !alert.file_id) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const refs = ((alert.row_refs ?? []) as number[]).filter((n) => Number.isInteger(n) && n > 0).slice(0, ALERT_ROWS_MAX);
  const total = Math.max(alert.matched_count ?? 0, refs.length);

  const admin = createAdminClient();
  const { data: file } = await admin
    .from('shared_files_metadata')
    .select('id, name, source, google_token_id, drive_file_id, sheet_mode, sheet_names, company_id')
    .eq('id', alert.file_id)
    .maybeSingle();
  if (!file || file.company_id !== alert.company_id) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // Columnas que usa la regla: se resaltan en el detalle.
  let highlight: string[] = [];
  if (alert.rule_id) {
    const { data: rule } = await admin.from('rules').select('condition, company_id').eq('id', alert.rule_id).maybeSingle();
    const cond = rule && rule.company_id === alert.company_id ? conditionSchema.safeParse(rule.condition) : null;
    if (cond?.success) highlight = [...new Set(conditionColumns(cond.data))];
  }

  if (file.source === 'local') {
    const out: AlertRowsResponse = { mode: 'local', fileId: file.id, sheet: alert.sheet_name, rows: refs, total, highlight };
    return NextResponse.json(out, { headers: { 'Cache-Control': 'no-store' } });
  }

  const { data: token } = await admin
    .from('google_tokens')
    .select('id, refresh_token_enc, status')
    .eq('id', file.google_token_id)
    .maybeSingle();
  if (!token || token.status !== 'active') return NextResponse.json({ error: 'google_not_connected' }, { status: 409 });

  try {
    const accessToken = await getAccessToken(token.id, decrypt(token.refresh_token_enc));
    const meta = await getFileMeta(accessToken, file.drive_file_id);
    const buffer = await downloadFile(accessToken, meta);
    const mime = parseMimeFor(meta.mimeType);
    const wanted = alert.sheet_name as string | null;
    let workbook = parseWorkbook(buffer, mime, {
      mode: (file.sheet_mode ?? 'first') as 'first' | 'all' | 'selected',
      names: (file.sheet_names ?? []) as string[],
    });
    if (wanted && workbook.available.includes(wanted)) workbook = parseWorkbook(buffer, mime, { mode: 'selected', names: [wanted] });
    const first = workbook.sheets[0];
    if (!first) return NextResponse.json({ error: 'sheet_not_found' }, { status: 404 });
    const headers = first.table.headers.slice(0, ALERT_ROWS_COLS);
    const byNumber = new Map(first.table.rows.map((r) => [r.rowNumber, r]));
    const rows: { n: number; cells: string[] }[] = [];
    const missing: number[] = [];
    for (const n of refs) {
      const r = byNumber.get(n);
      if (!r) missing.push(n);
      else rows.push({ n, cells: headers.map((h) => formatCell(r.values[h]).slice(0, CELL_CHARS)) });
    }
    const out: AlertRowsResponse = {
      mode: 'data',
      fileName: file.name,
      sheet: first.sheetName,
      headers,
      rows,
      missing,
      moreColumns: first.table.headers.length > ALERT_ROWS_COLS,
      total,
      highlight,
    };
    return NextResponse.json(out, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    if (e instanceof FileTooLargeError) return NextResponse.json({ error: 'file_too_large' }, { status: 413 });
    if (e instanceof GoogleApiError && (e.status === 403 || e.status === 404)) return NextResponse.json({ error: 'file_not_accessible' }, { status: 403 });
    return NextResponse.json({ error: 'read_error' }, { status: 502 });
  }
}
