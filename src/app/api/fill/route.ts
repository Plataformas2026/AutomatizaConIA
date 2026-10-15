import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSessionContext } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { decrypt } from '@/lib/crypto';
import { getAccessToken } from '@/lib/google/oauth';
import { downloadFile, FileTooLargeError, getFileMeta, GoogleApiError } from '@/lib/google/drive';
import { parseMimeFor, parseWorkbook } from '@/lib/parsing/parse';
import { fillDocx, makeResolver, TemplateError, todayText } from '@/lib/templates/docx';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const bodySchema = z.object({
  alertId: z.string().uuid(),
  row: z.number().int().min(1).max(2_000_000),
});

/**
 * «Rellenar»: abre la plantilla de la alerta con los datos de una fila.
 *  · Archivo de Google Drive: el servidor lee el archivo AL VUELO, rellena la plantilla y devuelve el .docx.
 *    No se guarda ni la fila ni el documento.
 *  · Archivo local: el servidor NO tiene el archivo. Responde {mode:'local'} y el navegador pide al agente de
 *    ese ordenador que rellene y abra el documento (los datos no salen del PC).
 * Solo se puede rellenar una fila que figure en la alerta (la propia o las de su reparto).
 */
export async function POST(req: Request) {
  const ctx = await getSessionContext();
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });

  // RLS: solo alertas de mi empresa o de proyectos compartidos conmigo.
  const { data: alert } = await ctx.supabase
    .from('alerts')
    .select('id, company_id, file_id, rule_name, template_id, sheet_name, row_refs, assignees')
    .eq('id', body.data.alertId)
    .maybeSingle();
  if (!alert || !alert.file_id || !alert.template_id) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const allowed = new Set<number>((alert.row_refs ?? []) as number[]);
  for (const v of Object.values((alert.assignees ?? {}) as Record<string, { rows?: number[] }>)) {
    for (const r of v.rows ?? []) allowed.add(r);
  }
  if (!allowed.has(body.data.row)) return NextResponse.json({ error: 'row_not_in_alert' }, { status: 400 });

  const admin = createAdminClient();
  const { data: file } = await admin
    .from('shared_files_metadata')
    .select('id, name, source, google_token_id, drive_file_id, sheet_mode, sheet_names, company_id')
    .eq('id', alert.file_id)
    .maybeSingle();
  if (!file || file.company_id !== alert.company_id) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const { data: tpl } = await admin
    .from('report_templates')
    .select('id, name, content_b64, mapping, company_id')
    .eq('id', alert.template_id)
    .maybeSingle();
  if (!tpl || tpl.company_id !== alert.company_id) return NextResponse.json({ error: 'template_not_found' }, { status: 404 });

  if (file.source === 'local') {
    return NextResponse.json({ mode: 'local', fileId: file.id, templateId: tpl.id, sheet: alert.sheet_name, row: body.data.row });
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
    const table = workbook.sheets[0]?.table;
    const found = table?.rows.find((r) => r.rowNumber === body.data.row);
    if (!table || !found) return NextResponse.json({ error: 'row_not_found' }, { status: 404 });

    const resolve = makeResolver(table.headers, found.values, tpl.mapping as Record<string, string>, {
      row: body.data.row,
      today: todayText(),
      fileName: file.name,
      sheet: workbook.sheets[0]?.sheetName ?? null,
      rule: alert.rule_name,
    });
    const docx = await fillDocx(new Uint8Array(Buffer.from(tpl.content_b64 as string, 'base64')), resolve);
    const safe = `${tpl.name}_fila${body.data.row}`.replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(0, 100) || 'informe';
    return new Response(Buffer.from(docx), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="informe.docx"; filename*=UTF-8''${encodeURIComponent(safe)}.docx`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    if (e instanceof TemplateError) return NextResponse.json({ error: 'bad_template' }, { status: 422 });
    if (e instanceof FileTooLargeError) return NextResponse.json({ error: 'file_too_large' }, { status: 413 });
    if (e instanceof GoogleApiError && (e.status === 403 || e.status === 404)) return NextResponse.json({ error: 'file_not_accessible' }, { status: 403 });
    return NextResponse.json({ error: 'read_error' }, { status: 502 });
  }
}
