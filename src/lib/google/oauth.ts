import 'server-only';
import { appUrl, env } from '@/lib/env';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

/** drive.file = acceso SOLO a los archivos que el usuario elige con el Picker
 *  (mínimo privilegio; scope no sensible → sin verificación restringida). */
export const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const GOOGLE_SCOPES = [DRIVE_FILE_SCOPE, 'openid', 'email'];

export class GoogleAuthRevokedError extends Error {
  constructor() {
    super('El usuario revocó el acceso o el token expiró');
    this.name = 'GoogleAuthRevokedError';
  }
}

export function redirectUri(): string {
  return `${appUrl()}/api/google/callback`;
}

export function buildAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: env().GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: GOOGLE_SCOPES.join(' '),
    access_type: 'offline', // necesario para el refresh_token
    prompt: 'consent', // garantiza que Google devuelva refresh_token
    state,
  });
  return `${AUTH_URL}?${params}`;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  id_token?: string;
}

async function postToken(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env().GOOGLE_CLIENT_ID,
      client_secret: env().GOOGLE_CLIENT_SECRET,
      ...body,
    }),
    cache: 'no-store',
  });
  const json = (await res.json().catch(() => ({}))) as TokenResponse & { error?: string };
  if (!res.ok) {
    if (json.error === 'invalid_grant') throw new GoogleAuthRevokedError();
    throw new Error(`Google token endpoint: ${json.error ?? res.status}`);
  }
  return json;
}

export function exchangeCode(code: string) {
  return postToken({ code, grant_type: 'authorization_code', redirect_uri: redirectUri() });
}

/* ── Access tokens de corta vida, cacheados por instancia ──── */
const cache = new Map<string, { token: string; expiresAt: number }>();

export async function getAccessToken(tokenId: string, refreshToken: string): Promise<string> {
  const hit = cache.get(tokenId);
  if (hit && hit.expiresAt > Date.now() + 60_000) return hit.token;

  const res = await postToken({ refresh_token: refreshToken, grant_type: 'refresh_token' });
  cache.set(tokenId, { token: res.access_token, expiresAt: Date.now() + res.expires_in * 1000 });
  return res.access_token;
}

export function forgetAccessToken(tokenId: string) {
  cache.delete(tokenId);
}

export async function revokeToken(token: string) {
  await fetch(REVOKE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token }),
  }).catch(() => undefined);
}

/** El id_token llega directo de Google por TLS en el canje del code,
 *  así que basta decodificar el payload para leer el email. */
export function emailFromIdToken(idToken?: string): string | null {
  if (!idToken) return null;
  try {
    const payload = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString('utf8'));
    return typeof payload.email === 'string' ? payload.email : null;
  } catch {
    return null;
  }
}
