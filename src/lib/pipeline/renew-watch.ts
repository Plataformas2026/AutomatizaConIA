import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { decrypt } from '@/lib/crypto';
import { getAccessToken } from '@/lib/google/oauth';
import { startWatch, stopWatch } from '@/lib/google/watch';

/** Crea un canal nuevo y, solo si todo va bien, para el anterior (sin hueco de cobertura). */
export async function renewWatch(fileId: string): Promise<boolean> {
  const admin = createAdminClient();

  const { data: file } = await admin
    .from('shared_files_metadata')
    .select('id, drive_file_id, google_token_id, watch_channel_id, watch_resource_id, status')
    .eq('id', fileId)
    .maybeSingle();
  if (!file || file.status === 'revoked' || file.status === 'paused') return false;

  const { data: token } = await admin
    .from('google_tokens')
    .select('id, refresh_token_enc, status')
    .eq('id', file.google_token_id)
    .maybeSingle();
  if (!token || token.status !== 'active') return false;

  const accessToken = await getAccessToken(token.id, decrypt(token.refresh_token_enc));
  const channel = await startWatch(accessToken, file.drive_file_id);

  const { error } = await admin
    .from('shared_files_metadata')
    .update({
      watch_channel_id: channel.channelId,
      watch_resource_id: channel.resourceId,
      watch_expires_at: channel.expiresAt.toISOString(),
    })
    .eq('id', file.id);
  if (error) throw new Error('No se pudo guardar el canal renovado');

  if (file.watch_channel_id && file.watch_resource_id) {
    await stopWatch(accessToken, file.watch_channel_id, file.watch_resource_id);
  }
  return true;
}
