import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { getSessionContext } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { encrypt, safeEqual } from '@/lib/crypto';
import { DRIVE_FILE_SCOPE, emailFromIdToken, exchangeCode } from '@/lib/google/oauth';
import { appUrl } from '@/lib/env';

export const dynamic = 'force-dynamic';

/** Paso 2 del OAuth: canjea el code, cifra el refresh_token y lo guarda. */
export async function GET(req: NextRequest) {
  const back = (qs: string) => NextResponse.redirect(`${appUrl()}/dashboard?${qs}`);

  const ctx = await getSessionContext();
  if (!ctx) return NextResponse.redirect(`${appUrl()}/login`);

  const url = new URL(req.url);
  if (url.searchParams.get('error')) return back('google=denied');

  const store = await cookies();
  const expected = store.get('g_oauth_state')?.value;
  const received = url.searchParams.get('state') ?? '';
  store.delete({ name: 'g_oauth_state', path: '/api/google' });
  if (!expected || !safeEqual(expected, received)) return back('google=state_error');

  const code = url.searchParams.get('code');
  if (!code) return back('google=no_code');

  try {
    const tokens = await exchangeCode(code);
    const scopes = (tokens.scope ?? '').split(' ').filter(Boolean);

    // El usuario puede desmarcar el permiso de Drive en la pantalla de consentimiento.
    if (!scopes.includes(DRIVE_FILE_SCOPE)) return back('google=missing_scope');
    if (!tokens.refresh_token) return back('google=no_refresh_token');

    const email = emailFromIdToken(tokens.id_token) ?? 'cuenta-google';
    const admin = createAdminClient();

    const { error } = await admin.from('google_tokens').upsert(
      {
        company_id: ctx.companyId, // siempre de la sesión, nunca de la query
        connected_by: ctx.user.id,
        google_email: email,
        refresh_token_enc: encrypt(tokens.refresh_token),
        scopes,
        status: 'active',
      },
      { onConflict: 'company_id,google_email' },
    );
    if (error) {
      console.error('ERROR DE SUPABASE AL GUARDAR TOKEN:', error);
      return new Response(`Error de Supabase al guardar: ${JSON.stringify(error)}`, { status: 500 });
    }

    // Si era una reconexión, reactivamos los archivos que quedaron como "revoked".
    await admin
      .from('shared_files_metadata')
      .update({ status: 'active', last_error: null })
      .eq('company_id', ctx.companyId)
      .eq('status', 'revoked');

    return back('google=connected');
  } catch (err: any) {
    console.error('ERROR DETALLADO EN EXCHANGE/CALLBACK:', err);
    return new Response(
      `Fallo crítico en callback de Google: ${err.message || JSON.stringify(err)}`,
      { status: 500 }
    );
  }
}
