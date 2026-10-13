import 'server-only';
import type { SessionContext } from '@/lib/auth';
import { ONLINE_WINDOW_MS, relativeTimeEs, type AgentCard } from './types';

/** Agentes de la empresa con su estado (RLS: solo los míos). El token nunca sale de aquí. */
export async function loadAgentCards(ctx: SessionContext): Promise<AgentCard[]> {
  const [{ data: agents }, { data: files }] = await Promise.all([
    ctx.supabase
      .from('local_agents')
      .select('id, name, last_seen_at, agent_version, created_at')
      .eq('status', 'active')
      .order('created_at', { ascending: true }),
    ctx.supabase.from('shared_files_metadata').select('agent_id').eq('source', 'local'),
  ]);

  const counts = new Map<string, number>();
  for (const f of files ?? []) if (f.agent_id) counts.set(f.agent_id, (counts.get(f.agent_id) ?? 0) + 1);

  const now = Date.now();
  return (agents ?? []).map((a) => ({
    id: a.id,
    name: a.name,
    online: !!a.last_seen_at && now - new Date(a.last_seen_at).getTime() < ONLINE_WINDOW_MS,
    lastSeenLabel: relativeTimeEs(a.last_seen_at, now),
    version: a.agent_version,
    fileCount: counts.get(a.id) ?? 0,
  }));
}
