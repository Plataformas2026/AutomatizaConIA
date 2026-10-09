import 'server-only';
import type { SessionContext } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { decrypt } from '@/lib/crypto';
import { getAccessToken } from '@/lib/google/oauth';
import { downloadFile, FileTooLargeError, getFileMeta, GoogleApiError } from '@/lib/google/drive';
import { parseMimeFor, parseWorkbook, type ParsedTable } from '@/lib/parsing/parse';
import { StatsError } from './compute';

/** Archivo descargado en memoria. Vive solo durante la petición. */
export interface OpenedFile {
  buffer: ArrayBuffer;
  mime: string;
}

/** Descarga un archivo del Drive del usuario (lectura al vuelo, sin guardar nada). */
export async function openFile(ctx: SessionContext, fileId: string): Promise<OpenedFile> {
  // RLS: solo aparece si el archivo es de la empresa del usuario.
  const { data: file } = await ctx.supabase
    .from('shared_files_metadata')
    .select('id, google_token_id, drive_file_id')
    .eq('id', fileId)
    .maybeSingle();
  if (!file) throw new StatsError('file_not_found', 404);

  const { data: token } = await createAdminClient()
    .from('google_tokens')
    .select('id, refresh_token_enc, status')
    .eq('id', file.google_token_id)
    .maybeSingle();
  if (!token || token.status !== 'active') throw new StatsError('google_not_connected', 409);

  try {
    const accessToken = await getAccessToken(token.id, decrypt(token.refresh_token_enc));
    const meta = await getFileMeta(accessToken, file.drive_file_id);
    const buffer = await downloadFile(accessToken, meta);
    return { buffer, mime: parseMimeFor(meta.mimeType) };
  } catch (e) {
    if (e instanceof FileTooLargeError) throw new StatsError('file_too_large', 413);
    if (e instanceof GoogleApiError && (e.status === 403 || e.status === 404)) {
      throw new StatsError('file_not_accessible', 403);
    }
    throw new StatsError('google_error', 502);
  }
}

/** Tabla de una hoja concreta (o del CSV entero si `sheet` es null). */
export function tableFor(file: OpenedFile, sheet: string | null): ParsedTable {
  const selection = sheet ? { mode: 'selected' as const, names: [sheet] } : { mode: 'first' as const, names: [] };
  const workbook = parseWorkbook(file.buffer, file.mime, selection);
  const found = workbook.sheets[0];
  if (!found) throw new StatsError('sheet_not_found', 404);
  return found.table;
}

/** Todas las hojas con sus tablas (para describir la estructura). */
export function allTables(file: OpenedFile) {
  return parseWorkbook(file.buffer, file.mime, { mode: 'all', names: [] }).sheets;
}
