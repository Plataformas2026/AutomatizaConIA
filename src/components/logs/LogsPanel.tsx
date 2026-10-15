'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { IconLog } from '../Icons';

export interface LogEntry {
  id: number;
  agent_id: string;
  level: 'info' | 'warning' | 'error';
  message: string;
  occurrences: number;
  logged_at: string;
}
export interface AgentInfo {
  id: string;
  name: string;
  status: 'active' | 'revoked';
  last_seen_at: string | null;
  agent_version: string | null;
}

const LEVEL_LABEL = { info: 'Estado', warning: 'Aviso', error: 'Error' } as const;
const MAX_SHOWN = 500;
/** Un agente que no contacta en este tiempo se marca como «sin contacto». */
const SILENT_MS = 5 * 60_000;

function ago(iso: string | null, now: number): string {
  if (!iso) return 'nunca';
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 45) return 'hace unos segundos';
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  return `hace ${Math.round(s / 86400)} d`;
}

type LevelFilter = 'attention' | 'error' | 'all';

/** Avisos y errores de todos los agentes de la empresa, en tiempo real. */
export function LogsPanel({ companyId, initialLogs, agents: initialAgents }: { companyId: string; initialLogs: LogEntry[]; agents: AgentInfo[] }) {
  const [logs, setLogs] = useState<LogEntry[]>(initialLogs);
  const [agents, setAgents] = useState<AgentInfo[]>(initialAgents);
  const [level, setLevel] = useState<LevelFilter>('attention');
  const [agentFilter, setAgentFilter] = useState('all');
  const [live, setLive] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [fresh, setFresh] = useState<Set<number>>(new Set());
  const seen = useRef(new Set(initialLogs.map((l) => l.id)));

  // Reloj para los «hace X min» y para detectar agentes sin contacto.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  async function reloadAgents() {
    const { data } = await createClient()
      .from('local_agents')
      .select('id, name, status, last_seen_at, agent_version')
      .eq('company_id', companyId)
      .order('created_at', { ascending: true });
    if (data) setAgents(data as AgentInfo[]);
  }

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`logs-live:${companyId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'agent_logs', filter: `company_id=eq.${companyId}` },
        (payload) => {
          const row = payload.new as LogEntry;
          if (seen.current.has(row.id)) return;
          seen.current.add(row.id);
          setLogs((prev) => [row, ...prev].slice(0, MAX_SHOWN));
          setFresh((prev) => new Set(prev).add(row.id));
          setTimeout(() => setFresh((prev) => { const n = new Set(prev); n.delete(row.id); return n; }), 6000);
          void reloadAgents();
        },
      )
      .subscribe((status) => setLive(status === 'SUBSCRIBED'));
    const onFocus = () => void reloadAgents();
    window.addEventListener('focus', onFocus);
    const poll = setInterval(() => void reloadAgents(), 60_000);
    return () => {
      window.removeEventListener('focus', onFocus);
      clearInterval(poll);
      void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  const names = useMemo(() => new Map(agents.map((a) => [a.id, a.name])), [agents]);
  const shown = logs.filter(
    (l) =>
      (agentFilter === 'all' || l.agent_id === agentFilter) &&
      (level === 'all' || (level === 'attention' ? l.level !== 'info' : l.level === 'error')),
  );
  const counts = useMemo(() => {
    const day = now - 86_400_000;
    const recent = logs.filter((l) => new Date(l.logged_at).getTime() > day);
    return { errors: recent.filter((l) => l.level === 'error').length, warnings: recent.filter((l) => l.level === 'warning').length };
  }, [logs, now]);

  const activeAgents = agents.filter((a) => a.status === 'active');

  return (
    <>
      {activeAgents.length > 0 && (
        <ul className="agent-strip" aria-label="Estado de los agentes">
          {activeAgents.map((a) => {
            const silent = !a.last_seen_at || now - new Date(a.last_seen_at).getTime() > SILENT_MS;
            return (
              <li key={a.id} className={`agent-pill ${silent ? 'is-silent' : 'is-ok'}`}>
                <span className="agent-dot" aria-hidden="true" />
                <span>
                  <strong>{a.name}</strong>
                  <span className="muted">
                    {silent ? ` · sin contacto (${ago(a.last_seen_at, now)})` : ` · activo ${ago(a.last_seen_at, now)}`}
                    {a.agent_version ? ` · v${a.agent_version}` : ''}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <div className="logs-bar">
        <div className="logs-filters">
          <label>
            <span className="field-title">Mostrar</span>
            <select value={level} onChange={(e) => setLevel(e.target.value as LevelFilter)}>
              <option value="attention">Avisos y errores</option>
              <option value="error">Solo errores</option>
              <option value="all">Todo (incluye estados)</option>
            </select>
          </label>
          {agents.length > 1 && (
            <label>
              <span className="field-title">Agente</span>
              <select value={agentFilter} onChange={(e) => setAgentFilter(e.target.value)}>
                <option value="all">Todos</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </label>
          )}
        </div>
        <div className="logs-summary muted">
          <span className={`live-dot ${live ? 'on' : ''}`} aria-hidden="true" />
          {live ? 'En directo' : 'Conectando…'} · últimas 24 h: <strong>{counts.errors}</strong> error(es), <strong>{counts.warnings}</strong> aviso(s)
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="empty">
          <span className="empty-icon"><IconLog size={28} /></span>
          <strong>{logs.length === 0 ? 'Todavía no hay registros' : 'Nada que mostrar con este filtro'}</strong>
          <p className="muted">
            {logs.length === 0
              ? 'Cuando un agente (versión 1.8.0 o posterior) tenga un aviso o un error, aparecerá aquí al instante.'
              : 'Cambia el filtro de arriba para ver también los estados.'}
          </p>
        </div>
      ) : (
        <ul className="log-list">
          {shown.map((l) => (
            <li key={l.id} className={`log-item lvl-${l.level} ${fresh.has(l.id) ? 'is-new' : ''}`}>
              <span className={`log-level lvl-${l.level}`}>{LEVEL_LABEL[l.level]}</span>
              <div className="log-main">
                <p className="log-msg">{l.message}</p>
                <div className="log-meta muted">
                  <span>{names.get(l.agent_id) ?? 'Agente eliminado'}</span>
                  <time dateTime={l.logged_at} title={new Date(l.logged_at).toLocaleString('es-ES')}>
                    {new Date(l.logged_at).toLocaleString('es-ES')} ({ago(l.logged_at, now)})
                  </time>
                  {l.occurrences > 1 && <span className="tag tag-count">{l.occurrences} veces</span>}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {logs.length >= 200 && <p className="muted">Se muestran los últimos registros; los más antiguos se eliminan solos a los 14 días.</p>}
    </>
  );
}
