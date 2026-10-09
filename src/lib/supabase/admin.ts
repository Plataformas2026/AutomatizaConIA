import 'server-only';
import { createClient } from '@supabase/supabase-js';

/** Cliente service_role: SALTA RLS. Solo para webhook, cron y escrituras
 *  de servidor (tokens, canales, alertas). Nunca importar desde el cliente. */
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
