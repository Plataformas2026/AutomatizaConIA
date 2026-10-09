import { randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionContext } from '@/lib/auth';
import { buildAuthUrl } from '@/lib/google/oauth';
import { appUrl } from '@/lib/env';

export const dynamic = 'force-dynamic';

/** Paso 1 del OAuth: redirige a Google con un `state` anti-CSRF en cookie. */
export async function GET() {
  const ctx = await getSessionContext();
  if (!ctx) return NextResponse.redirect(`${appUrl()}/login`);

  const state = randomBytes(24).toString('hex');
  (await cookies()).set('g_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api/google',
    maxAge: 600,
  });
  return NextResponse.redirect(buildAuthUrl(state));
}
