import 'server-only';
import { randomUUID } from 'node:crypto';
import { appUrl } from '@/lib/env';
import { channelToken } from '@/lib/crypto';
import { GoogleApiError } from '@/lib/google/drive';

const API = 'https://www.googleapis.com/drive/v3';

/** files.watch admite como máximo 24 h. Pedimos 23 h para no rozar el límite. */
const CHANNEL_TTL_MS = 23 * 60 * 60 * 1000;

export interface WatchChannel {
  channelId: string;
  resourceId: string;
  expiresAt: Date;
}

export async function startWatch(accessToken: string, driveFileId: string): Promise<WatchChannel> {
  const channelId = randomUUID();
  const res = await fetch(`${API}/files/${encodeURIComponent(driveFileId)}/watch?supportsAllDrives=true`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: channelId,
      type: 'web_hook',
      address: `${appUrl()}/api/webhooks/drive`,
      token: channelToken(channelId), // Google lo devuelve en X-Goog-Channel-Token
      expiration: String(Date.now() + CHANNEL_TTL_MS),
    }),
    cache: 'no-store',
  });

  const json = (await res.json().catch(() => ({}))) as {
    resourceId?: string;
    expiration?: string;
    error?: { message?: string };
  };
  if (!res.ok || !json.resourceId) {
    throw new GoogleApiError(res.status, json.error?.message ?? 'No se pudo crear el canal de notificaciones');
  }
  return {
    channelId,
    resourceId: json.resourceId,
    expiresAt: new Date(Number(json.expiration ?? Date.now() + CHANNEL_TTL_MS)),
  };
}

/** Best effort: si el canal ya caducó Google responde 404 y no pasa nada. */
export async function stopWatch(accessToken: string, channelId: string, resourceId: string) {
  await fetch(`${API}/channels/stop`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: channelId, resourceId }),
    cache: 'no-store',
  }).catch(() => undefined);
}
