import type { SupabaseClient } from '@supabase/supabase-js';
import { identifiers, type Handoffs } from '@/lib/assign/assign';
import { countUnread, handoffKey, type NotifyContext, type RelevantAlert } from './relevance';

export const ALERT_COLUMNS = 'id, company_id, project_id, rule_id, sheet_name, assignees, chains, audience, rev, status';

/** Carga lo necesario para saber qué avisos me tocan y cuáles he leído (se pasa al proveedor del cliente). */
export async function loadNotify(
  supabase: SupabaseClient,
  user: { id: string; email?: string | null },
  companyId: string,
): Promise<{ ctx: NotifyContext; reads: Record<string, number>; unread: number }> {
  const [{ data: aliasRows }, { data: mem }, { data: alerts }, { data: readRows }, { data: hand }] = await Promise.all([
    supabase.from('user_aliases').select('alias'),
    supabase.from('project_members').select('project_id, notify').eq('user_id', user.id),
    supabase.from('alerts').select(ALERT_COLUMNS).neq('status', 'dismissed').order('created_at', { ascending: false }).limit(500),
    supabase.from('alert_reads').select('alert_id, rev'),
    supabase.from('row_handoffs').select('rule_id, sheet, row_number, level').limit(5000),
  ]);
  const handoffs: Record<string, Handoffs> = {};
  for (const h of hand ?? []) (handoffs[handoffKey(h.rule_id as string, h.sheet as string)] ??= {})[h.row_number as number] = h.level as number;
  const ctx: NotifyContext = {
    companyId,
    ids: identifiers(user.email ?? '', (aliasRows ?? []).map((r) => r.alias as string)),
    notifyAll: (mem ?? []).filter((m) => m.notify === 'all').map((m) => m.project_id as string),
    handoffs,
  };
  const reads: Record<string, number> = {};
  for (const r of readRows ?? []) reads[r.alert_id as string] = r.rev as number;
  const unread = await countUnread((alerts ?? []) as RelevantAlert[], ctx, reads);
  return { ctx, reads, unread };
}
