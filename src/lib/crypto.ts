import 'server-only';
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { env } from '@/lib/env';

function encryptionKey(): Buffer {
  const key = Buffer.from(env().TOKEN_ENCRYPTION_KEY, 'base64');
  if (key.length !== 32) {
    throw new Error('TOKEN_ENCRYPTION_KEY debe ser 32 bytes en base64 (openssl rand -base64 32)');
  }
  return key;
}

/** AES-256-GCM. Formato: v1.<iv>.<tag>.<ciphertext> (todo base64). */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join('.');
}

export function decrypt(payload: string): string {
  const [version, iv, tag, data] = payload.split('.');
  if (version !== 'v1' || !iv || !tag || !data) throw new Error('Formato de token cifrado no válido');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}

/** Token que enviamos a Google al crear el canal y que Google devuelve en
 *  X-Goog-Channel-Token. Derivado por HMAC: no hace falta guardarlo. */
export function channelToken(channelId: string): string {
  return createHmac('sha256', env().WEBHOOK_SECRET).update(`channel:${channelId}`).digest('hex');
}

/** Huella de "qué filas cumplen la regla". Solo depende de nº de fila. */
export function matchFingerprint(ruleId: string, rowNumbers: number[]): string {
  return createHmac('sha256', env().WEBHOOK_SECRET)
    .update(`match:${ruleId}:${rowNumbers.join(',')}`)
    .digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
