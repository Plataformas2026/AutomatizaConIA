import { hasTimeOperator } from '@/lib/rules/engine';
import type { Condition } from '@/lib/rules/types';
import { createAdminClient } from '@/lib/supabase/admin';
import { env } from '@/lib/env';
import { safeEqual } from '@/lib/crypto';
import { renewWatch } from '@/lib/pipeline/renew-watch';
import { processFile } from '@/lib/pipeline/process-file';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// Renovamos todo canal que caduque en las próximas 12 h (TTL máx. de Drive: 24 h).
const RENEW_WINDOW_MS = 12 * 60 * 60 * 1000;

async function handle(req: Request) {
  const auth = req.headers.get('authorization') ?? '';
  if (!safeEqual(auth, `Bearer ${env().CRON_SECRET}`)) {
    return new Response('Unauthorized', { status: 401 });
  }

  const admin = createAdminClient();
  const threshold = new Date(Date.now() + RENEW_WINDOW_MS).toISOString();

  const { data: files } = await admin
    .from('shared_files_metadata')
    .select('id')
    .eq('status', 'active')
    .eq('source', 'drive') // los archivos locales los vigila el agente del PC
    .or(`watch_expires_at.is.null,watch_expires_at.lt.${threshold}`)
    .limit(200);

  let renewed = 0;
  let failed = 0;
  for (const f of files ?? []) {
    try {
      if (await renewWatch(f.id)) renewed++;
      // Reconciliación: si hubo un hueco entre canales, se detecta por `version`
      // (solo metadatos; no descarga nada si no cambió).
      await processFile(f.id);
    } catch (e) {
      failed++;
      console.error('[cron/renew]', e instanceof Error ? e.name : 'UnknownError');
    }
  }

  // Reglas de fecha («ha pasado al menos…», «ya llegó la fecha»): dependen del día de hoy, así que se
  // reevalúan cada día aunque el archivo no haya cambiado.
  let dateChecked = 0;
  const { data: dateRules } = await admin
    .from('rules')
    .select('file_id, condition')
    .eq('enabled', true)
    .limit(2000);
  // Las condiciones compuestas pueden llevar un operador de fecha dentro de un grupo: se mira el árbol entero.
  const dateFileIds = [
    ...new Set(
      (dateRules ?? [])
        .filter((r) => {
          try {
            return hasTimeOperator(r.condition as Condition);
          } catch {
            return false;
          }
        })
        .map((r) => r.file_id as string),
    ),
  ].slice(0, 50);
  if (dateFileIds.length) {
    const { data: dateFiles } = await admin
      .from('shared_files_metadata')
      .select('id')
      .in('id', dateFileIds)
      .eq('source', 'drive')
      .eq('status', 'active');
    for (const f of dateFiles ?? []) {
      try {
        await processFile(f.id, { force: true });
        dateChecked++;
      } catch (e) {
        failed++;
        console.error('[cron/date-rules]', e instanceof Error ? e.name : 'UnknownError');
      }
    }
  }

  // Limpieza de correos: resueltos > 7 días y pendientes olvidados > 30 días (no se acumulan datos).
  const { error: purgeError } = await admin.rpc('purge_email_outbox');
  if (purgeError) console.error('[cron/purge-outbox]', purgeError.code ?? 'error');

  // Registros de los agentes: se conservan 14 días.
  const { error: logsError } = await admin.rpc('purge_agent_logs');
  if (logsError) console.error('[cron/purge-agent-logs]', logsError.code ?? 'error');

  return Response.json({ checked: files?.length ?? 0, renewed, failed, dateChecked });
}

// Vercel Cron usa GET; pg_net (Supabase) usa POST.
export const GET = handle;
export const POST = handle;
