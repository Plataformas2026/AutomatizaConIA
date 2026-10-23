import { redirect } from 'next/navigation';
import { getSessionContext } from '@/lib/auth';
import { LogsPanel, type AgentInfo, type LogEntry } from '@/components/logs/LogsPanel';

export const dynamic = 'force-dynamic';

export default async function LogsPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect('/login');

  const [{ data: logs }, { data: agents }] = await Promise.all([
    ctx.supabase
      .from('agent_logs')
      .select('id, agent_id, level, message, occurrences, logged_at')
      .eq('company_id', ctx.companyId)
      .order('id', { ascending: false })
      .limit(200),
    ctx.supabase
      .from('local_agents')
      .select('id, name, status, last_seen_at, agent_version')
      .eq('company_id', ctx.companyId)
      .order('created_at', { ascending: true }),
  ]);

  return (
    <>
      <h1>Logs de los agentes</h1>
      <p className="sub">
        Aquí llegan los avisos y errores de los agentes de tus ordenadores. Se conservan 14 días.
      </p>
      <LogsPanel
        companyId={ctx.companyId}
        initialLogs={(logs ?? []) as LogEntry[]}
        agents={(agents ?? []) as AgentInfo[]}
      />
    </>
  );
}
