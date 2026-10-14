import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import type { SessionContext } from '@/lib/auth';

/**
 * Administración de la plataforma. REGLAS:
 *  · Solo se actúa en nombre de otro usuario si `ctx.isAdmin` (viene de la base de datos, nunca del navegador).
 *  · Con service_role (salta RLS) SIEMPRE se acota por el company_id del usuario elegido.
 *  · Cada acción sobre datos ajenos se anota en admin_audit (sin contenido).
 */

export const userIdSchema = z.string().uuid();

export interface AdminUser {
  user_id: string;
  email: string;
  company_id: string;
  company_name: string;
}

export interface Target {
  companyId: string;
  /** Cliente a usar: el de la sesión (RLS) para uno mismo; service_role para otro usuario. */
  db: SupabaseClient;
  /** true si se actúa en nombre de otra persona. */
  onBehalf: boolean;
}

/** Empresa del usuario elegido (su primera empresa). null si no existe. */
export async function companyOfUser(userId: string): Promise<string | null> {
  const { data } = await createAdminClient()
    .from('company_members')
    .select('company_id')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  return (data?.company_id as string | undefined) ?? null;
}

/**
 * ¿Para quién se actúa? Sin `forUserId` (o siendo uno mismo): la propia empresa con RLS.
 * Con otro usuario: solo si eres administrador. Devuelve 'forbidden' | 'not_found' en caso de error.
 */
export async function resolveTarget(ctx: SessionContext, forUserId?: string | null): Promise<Target | 'forbidden' | 'not_found'> {
  if (!forUserId || forUserId === ctx.user.id) return { companyId: ctx.companyId, db: ctx.supabase, onBehalf: false };
  if (!ctx.isAdmin) return 'forbidden';
  const companyId = await companyOfUser(forUserId);
  if (!companyId) return 'not_found';
  return { companyId, db: createAdminClient(), onBehalf: companyId !== ctx.companyId };
}

/** Anota una acción de administración sobre datos de otra empresa (no bloquea si falla). */
export async function audit(
  ctx: SessionContext,
  targetCompanyId: string | null,
  action: string,
  entity: string,
  entityId?: string | null,
): Promise<void> {
  if (!ctx.isAdmin || !targetCompanyId || targetCompanyId === ctx.companyId) return;
  try {
    await createAdminClient().from('admin_audit').insert({
      admin_id: ctx.user.id,
      target_company_id: targetCompanyId,
      action,
      entity,
      entity_id: entityId ?? null,
    });
  } catch {
    /* el registro es best-effort: no debe impedir la acción */
  }
}

/** Cliente para tocar un recurso concreto por id: los administradores pueden con cualquiera. */
export function dbForResource(ctx: SessionContext): SupabaseClient {
  return ctx.isAdmin ? createAdminClient() : ctx.supabase;
}
