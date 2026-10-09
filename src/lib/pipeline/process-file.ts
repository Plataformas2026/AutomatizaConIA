import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { decrypt, matchFingerprint } from '@/lib/crypto';
import { forgetAccessToken, getAccessToken, GoogleAuthRevokedError } from '@/lib/google/oauth';
import { downloadFile, FileTooLargeError, getFileMeta, GoogleApiError } from '@/lib/google/drive';
import { parseMimeFor, parseWorkbook, type SheetSelection } from '@/lib/parsing/parse';
import { evaluateRuleAcrossSheets } from '@/lib/rules/engine';
import { ruleSchema } from '@/lib/rules/types';
import { runActions } from '@/lib/actions';

export type ProcessResult =
  | { status: 'skipped'; reason: string }
  | { status: 'processed'; rules: number; alerts: number }
  | { status: 'error'; reason: string };

/**
 * Lectura efímera + evaluación + alerta.
 *
 * Invariante de privacidad: el contenido del archivo existe SOLO dentro de este
 * bloque `try` (variable `workbook`). Se pasa a evaluateRuleAcrossSheets (puro) y
 * de ahí solo salen números de fila. No hay console.log de filas ni escritura
 * a disco/BD.
 */
export async function processFile(fileId: string, opts: { force?: boolean } = {}): Promise<ProcessResult> {
  const admin = createAdminClient();

  const { data: file } = await admin
    .from('shared_files_metadata')
    .select(
      'id, company_id, google_token_id, drive_file_id, name, mime_type, status, last_version, sheet_mode, sheet_names',
    )
    .eq('id', fileId)
    .maybeSingle();
  if (!file) return { status: 'skipped', reason: 'file_not_found' };
  if (file.status === 'paused') return { status: 'skipped', reason: 'paused' };

  const { data: token } = await admin
    .from('google_tokens')
    .select('id, refresh_token_enc, status')
    .eq('id', file.google_token_id)
    .maybeSingle();
  if (!token || token.status !== 'active') return { status: 'skipped', reason: 'token_inactive' };

  const selection: SheetSelection = {
    mode: (file.sheet_mode ?? 'first') as SheetSelection['mode'],
    names: (file.sheet_names ?? []) as string[],
  };

  let claimedVersion: string | null = null;

  try {
    const accessToken = await getAccessToken(token.id, decrypt(token.refresh_token_enc));
    const meta = await getFileMeta(accessToken, file.drive_file_id);

    if (meta.trashed) {
      await admin
        .from('shared_files_metadata')
        .update({ status: 'paused', last_error: 'El archivo está en la papelera de Drive' })
        .eq('id', file.id);
      return { status: 'skipped', reason: 'trashed' };
    }

    // Deduplicación: Drive suele enviar varias notificaciones por guardado.
    if (!opts.force) {
      if (meta.version === file.last_version) {
        await admin
          .from('shared_files_metadata')
          .update({ last_checked_at: new Date().toISOString() })
          .eq('id', file.id);
        return { status: 'skipped', reason: 'unchanged' };
      }
      const { data: claimed } = await admin.rpc('claim_file_version', {
        p_file: file.id,
        p_expected: file.last_version,
        p_new: meta.version,
      });
      if (!claimed) return { status: 'skipped', reason: 'already_claimed' };
      claimedVersion = meta.version;
    } else {
      await admin
        .from('shared_files_metadata')
        .update({ last_version: meta.version, last_checked_at: new Date().toISOString(), last_error: null })
        .eq('id', file.id);
    }

    const { data: rawRules } = await admin
      .from('rules')
      .select('id, name, condition, actions, last_fingerprints')
      .eq('file_id', file.id)
      .eq('enabled', true);

    // Sin reglas activas no hace falta ni descargar el archivo.
    if (!rawRules?.length) return { status: 'processed', rules: 0, alerts: 0 };

    const buffer = await downloadFile(accessToken, meta);
    const workbook = parseWorkbook(buffer, parseMimeFor(meta.mimeType), selection); // ← datos del usuario, solo en memoria

    // Hojas elegidas que ya no existen (renombradas o borradas en Drive).
    if (workbook.sheets.length === 0) {
      await admin
        .from('shared_files_metadata')
        .update({ last_error: 'Las hojas seleccionadas ya no existen en el archivo. Elige otras en «Hojas vigiladas».' })
        .eq('id', file.id);
      return { status: 'processed', rules: rawRules.length, alerts: 0 };
    }

    let alerts = 0;
    const now = new Date().toISOString();

    for (const raw of rawRules) {
      const parsed = ruleSchema.safeParse(raw);
      if (!parsed.success) {
        // Las reglas pueden escribirse vía PostgREST con RLS: tratarlas como no fiables.
        await admin.from('rules').update({ last_error: 'Regla no válida', last_evaluated_at: now }).eq('id', raw.id);
        continue;
      }
      const rule = parsed.data;
      const evaluation = evaluateRuleAcrossSheets(rule, workbook.sheets);

      if (evaluation.error) {
        await admin.from('rules').update({ last_error: evaluation.error, last_evaluated_at: now }).eq('id', rule.id);
        continue;
      }

      // Una huella por hoja: solo alertamos por las hojas cuyo conjunto de filas cambió.
      const previous = (raw.last_fingerprints ?? {}) as Record<string, string>;
      const next: Record<string, string> = {};

      for (const sheet of evaluation.sheets) {
        const key = sheet.sheetName ?? '';
        const fingerprint =
          sheet.matchedCount > 0 ? matchFingerprint(`${rule.id}|${key}`, sheet.matchedRows) : null;
        if (!fingerprint) continue;
        next[key] = fingerprint;

        if (fingerprint !== previous[key]) {
          await runActions(rule.actions, {
            admin,
            companyId: file.company_id,
            file: { id: file.id, name: file.name },
            rule: { id: rule.id, name: rule.name },
            sheetName: sheet.sheetName,
            columnName: rule.condition.left.column,
            matchedCount: sheet.matchedCount,
            rowRefs: sheet.matchedRows.slice(0, 200),
          });
          alerts++;
        }
      }

      await admin
        .from('rules')
        .update({ last_fingerprints: next, last_error: null, last_evaluated_at: now })
        .eq('id', rule.id);
    }

    return { status: 'processed', rules: rawRules.length, alerts };
  } catch (e) {
    // Si falló tras reclamar la versión, la devolvemos para reintentar luego.
    if (claimedVersion) {
      await admin.rpc('claim_file_version', {
        p_file: file.id,
        p_expected: claimedVersion,
        p_new: file.last_version,
      });
    }
    return handleFailure(e, file.id, token.id);
  }
}

async function handleFailure(e: unknown, fileId: string, tokenId: string): Promise<ProcessResult> {
  const admin = createAdminClient();
  // Registramos solo el tipo de error: los mensajes de parseo podrían citar datos.
  console.error('[processFile]', e instanceof Error ? e.name : 'UnknownError');

  if (e instanceof GoogleAuthRevokedError) {
    forgetAccessToken(tokenId);
    await admin.from('google_tokens').update({ status: 'revoked' }).eq('id', tokenId);
    await admin
      .from('shared_files_metadata')
      .update({ status: 'revoked', last_error: 'Acceso a Google revocado: vuelve a conectar tu Drive' })
      .eq('google_token_id', tokenId);
    return { status: 'error', reason: 'auth_revoked' };
  }

  if (e instanceof GoogleApiError && (e.status === 404 || e.status === 403)) {
    await admin
      .from('shared_files_metadata')
      .update({ status: 'error', last_error: 'No se encuentra el archivo o se retiró el permiso' })
      .eq('id', fileId);
    return { status: 'error', reason: 'file_inaccessible' };
  }

  if (e instanceof FileTooLargeError) {
    await admin.from('shared_files_metadata').update({ status: 'error', last_error: e.message }).eq('id', fileId);
    return { status: 'error', reason: 'file_too_large' };
  }

  // Errores transitorios (red, 5xx): no cambiamos el estado, se reintenta en la próxima notificación.
  await admin
    .from('shared_files_metadata')
    .update({ last_error: 'Error temporal al leer el archivo; se reintentará' })
    .eq('id', fileId);
  return { status: 'error', reason: 'transient' };
}
