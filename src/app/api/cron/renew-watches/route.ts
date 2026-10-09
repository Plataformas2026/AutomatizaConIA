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
  return Response.json({ checked: files?.length ?? 0, renewed, failed });
}

// Vercel Cron usa GET; pg_net (Supabase) usa POST.
export const GET = handle;
export const POST = handle;
