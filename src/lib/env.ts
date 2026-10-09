import 'server-only';
import { z } from 'zod';

const schema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  NEXT_PUBLIC_APP_URL: z.string().url(),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  TOKEN_ENCRYPTION_KEY: z.string().min(1),
  WEBHOOK_SECRET: z.string().min(16),
  CRON_SECRET: z.string().min(16),
  MAX_FILE_BYTES: z.coerce.number().int().positive().default(15 * 1024 * 1024),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

/** Validación perezosa: no rompe el build si faltan variables, sí el primer uso. */
export function env(): Env {
  if (!cached) cached = schema.parse(process.env);
  return cached;
}

/** URL base sin barra final. */
export function appUrl(): string {
  return env().NEXT_PUBLIC_APP_URL.replace(/\/+$/, '');
}
