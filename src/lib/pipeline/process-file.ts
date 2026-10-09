import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { decrypt, matchFingerprint } from '@/lib/crypto';
import { forgetAccessToken, getAccessToken, GoogleAuthRevokedError } from '@/lib/google/oauth';
import { downloadFile, FileTooLargeError, getFileMeta, GoogleApiError } from '@/lib/google/drive';
import { GOOGLE_SHEET_MIME, parseTable } from '@/lib/parsing/parse';
import { evaluateRule } from '@/lib/rules/engine';
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
 * bloque `try` (variable `table`). Se pasa a evaluateRule (puro) y de ahí solo
 * salen números de fila. No hay console.log de filas ni escritura a disco/BD.
 */
export async function processFile(fileId: string, opts: { force?: boolean } = {}): Promise<ProcessResult> {
  const admin = createAdminClient();

  const { data: file } = await admin
    .from('shared_files_metadata')
    .select('id, company_id, google_token_id, drive_file_id, name, mime_type, status, last_version')
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
      .select('id, name, condition, actions, last_fingerprint')
      .eq('file_id', file.id)
      .eq('enabled', true);

    // Sin reglas activas no hace falta ni descargar el archivo.
    if (!rawRules?.length) return { status: 'processed', rules: 0, alerts: 0 };

    const effectiveMime = meta.mimeType === GOOGLE_SHEET_MIME ? GOOGLE_SHEET_MIME : file.mime_type;
    const buffer = await downloadFile(accessToken, meta);
    const table = parseTable(buffer, effectiveMime); // ← datos del usuario, solo en memoria

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
      const evaluation = evaluateRule(rule, table);

      if (evaluation.error) {
        await admin.from('rules').update({ last_error: evaluation.error, last_evaluated_at: now }).eq('id', rule.id);
        continue;
      }

      const fingerprint =
        evaluation.matchedCount > 0 ? matchFingerprint(rule.id, evaluation.matchedRows) : null;

      // Solo alertamos cuando el conjunto de filas que cumple cambia.
      if (fingerprint && fingerprint !== raw.last_fingerprint) {
        await runActions(rule.actions, {
          admin,
          companyId: file.company_id,
          file: { id: file.id, name: file.name },
          rule: { id: rule.id, name: rule.name },
          matchedCount: evaluation.matchedCount,
          rowRefs: evaluation.matchedRows.slice(0, 200),
        });
        alerts++;
      }

      await admin
        .from('rules')
        .update({ last_fingerprint: fingerprint, last_error: null, last_evaluated_at: now })
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
