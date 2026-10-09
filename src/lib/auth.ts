import 'server-only';
import { createClient } from '@/lib/supabase/server';

/** Sesión + empresa del usuario. MVP: una empresa por usuario.
 *  El company_id SIEMPRE sale de aquí, nunca del cuerpo de la petición. */
export async function getSessionContext() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: membership } = await supabase
    .from('company_members')
    .select('company_id, role')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!membership) return null;

  return {
    supabase,
    user,
    companyId: membership.company_id as string,
    role: membership.role as 'owner' | 'admin' | 'member',
  };
}

export type SessionContext = NonNullable<Awaited<ReturnType<typeof getSessionContext>>>;
