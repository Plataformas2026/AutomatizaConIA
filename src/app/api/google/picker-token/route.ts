import { NextResponse } from 'next/server';
import { getSessionContext } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { decrypt } from '@/lib/crypto';
import { getAccessToken, GoogleAuthRevokedError } from '@/lib/google/oauth';

export const dynamic = 'force-dynamic';

/**
 * Entrega al navegador un access_token de ~1 h para abrir el Google Picker.
 * Solo vale para el scope drive.file (archivos que el usuario elija).
 * El refresh_token jamás sale del servidor.
 */
export async function GET() {
  const ctx = await getSessionContext();
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const admin = createAdminClient();
  const { data: token } = await admin
    .from('google_tokens')
    .select('id, refresh_token_enc')
    .eq('company_id', ctx.companyId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!token) return NextResponse.json({ error: 'google_not_connected' }, { status: 409 });

  try {
    const accessToken = await getAccessToken(token.id, decrypt(token.refresh_token_enc));
    return NextResponse.json({ accessToken }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    if (e instanceof GoogleAuthRevokedError) {
      await admin.from('google_tokens').update({ status: 'revoked' }).eq('id', token.id);
      return NextResponse.json({ error: 'google_revoked' }, { status: 409 });
    }
    return NextResponse.json({ error: 'token_error' }, { status: 502 });
  }
}
