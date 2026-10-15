import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Action } from '@/lib/rules/types';

/** Las plantillas que citan las acciones de una regla deben ser de la empresa dueña del archivo. */
export async function templatesBelong(db: SupabaseClient, companyId: string, actions: Action[] | undefined): Promise<boolean> {
  const ids = [...new Set((actions ?? []).flatMap((a) => (a.type === 'alert' && a.templateId ? [a.templateId] : [])))];
  if (!ids.length) return true;
  const { data } = await db.from('report_templates').select('id').eq('company_id', companyId).in('id', ids);
  return (data?.length ?? 0) === ids.length;
}
