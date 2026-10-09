import { after } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { channelToken, safeEqual } from '@/lib/crypto';
import { processFile } from '@/lib/pipeline/process-file';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Webhook de Google Drive (push notifications).
 *
 * Google envía el aviso con el cuerpo VACÍO y solo cabeceras X-Goog-*.
 * No trae datos del archivo: por eso, tras validar, leemos al vuelo con la
 * API de Drive (lib/pipeline/process-file.ts).
 *
 * Reglas del protocolo:
 *  - Responder 2xx rápido. El trabajo pesado va en after() (tras la respuesta).
 *  - 'sync' es el mensaje inicial al crear el canal: se ignora.
 *  - Para canales desconocidos (p. ej. el anterior tras una renovación)
 *    respondemos 200 igualmente, para que Google no reintente.
 */
export async function POST(req: Request) {
  const channelId = req.headers.get('x-goog-channel-id');
  const token = req.headers.get('x-goog-channel-token');
  const state = req.headers.get('x-goog-resource-state');

  // 1) Autenticidad: el token es un HMAC del channelId que solo nosotros podemos generar.
  if (!channelId || !token || !safeEqual(token, channelToken(channelId))) {
    return new Response('Unauthorized', { status: 401 });
  }

  // 2) Mensaje de handshake.
  if (state === 'sync') return new Response(null, { status: 200 });

  // 3) Localizar el archivo por canal y procesar tras responder.
  const admin = createAdminClient();
  const { data: file } = await admin
    .from('shared_files_metadata')
    .select('id')
    .eq('watch_channel_id', channelId)
    .maybeSingle();

  if (file) {
    after(async () => {
      try {
        await processFile(file.id);
      } catch (e) {
        console.error('[webhook/drive]', e instanceof Error ? e.name : 'UnknownError');
      }
    });
  }
  return new Response(null, { status: 200 });
}
