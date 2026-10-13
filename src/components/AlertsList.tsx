'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAlerts, type AlertRow } from './AlertsProvider';
import { IconBell, IconCheck, IconFolder, IconTable } from './Icons';

const SEVERITY_LABEL = { info: 'Informativa', warning: 'Aviso', critical: 'Crítica' } as const;

export function AlertsList({
  initial,
  projects = [],
}: {
  initial: AlertRow[];
  /** Proyectos con alertas (propios y compartidos conmigo), para filtrar. */
  projects?: { id: string; name: string }[];
}) {
  const [alerts, setAlerts] = useState<AlertRow[]>(initial);
  const [filter, setFilter] = useState<string>('all');
  const { adjustUnread, refreshUnread, onNewAlert, unread } = useAlerts();
  const [error, setError] = useState<string | null>(null);

  // Las alertas nuevas llegan por la suscripción única del proveedor.
  useEffect(
    () =>
      onNewAlert((a) =>
        setAlerts((prev) => (prev.some((p) => p.id === a.id) ? prev : [{ ...a, row_refs: a.row_refs ?? [] }, ...prev])),
      ),
    [onNewAlert],
  );

  async function setStatus(alert: AlertRow, status: 'read' | 'dismissed') {
    setError(null);
    const { error: dbError } = await createClient()
      .from('alerts')
      .update({ status, read_at: new Date().toISOString() })
      .eq('id', alert.id);
    if (dbError) {
      setError('No se pudo actualizar la alerta. Inténtalo de nuevo.');
      return;
    }
    if (alert.status === 'open') adjustUnread(-1);
    setAlerts((prev) =>
      status === 'dismissed'
        ? prev.filter((a) => a.id !== alert.id)
        : prev.map((a) => (a.id === alert.id ? { ...a, status } : a)),
    );
  }

  async function markAllRead() {
    setError(null);
    const { error: dbError } = await createClient()
      .from('alerts')
      .update({ status: 'read', read_at: new Date().toISOString() })
      .eq('status', 'open');
    if (dbError) {
      setError('No se pudieron marcar las alertas. Inténtalo de nuevo.');
      return;
    }
    setAlerts((prev) => prev.map((a) => (a.status === 'open' && !a.shared ? { ...a, status: 'read' } : a)));
    await refreshUnread();
  }

  const visible = alerts.filter((a) =>
    filter === 'all' ? true : filter === 'none' ? !a.project_id : a.project_id === filter,
  );

  if (!alerts.length) {
    return (
      <div className="empty">
        <span className="empty-icon">
          <IconCheck size={28} />
        </span>
        <strong>Todo en orden</strong>
        <p className="muted">Cuando una regla se cumpla, la alerta aparecerá aquí al instante.</p>
      </div>
    );
  }

  return (
    <>
      <div className="list-head">
        <span className="muted">
          {unread > 0 ? `${unread} sin leer` : 'Todas leídas'}
        </span>
        {unread > 0 && (
          <button className="btn" onClick={markAllRead}>
            <IconCheck size={16} />
            Marcar todas como leídas
          </button>
        )}
      </div>
      {error && <p className="err">{error}</p>}
      {projects.length > 0 && (
        <label className="scope-select">
          <span className="field-title">Proyecto</span>
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="all">Todos los proyectos</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
            <option value="none">Sin proyecto</option>
          </select>
        </label>
      )}
      {visible.length === 0 && <p className="muted">No hay alertas en este proyecto.</p>}

      <ul className="alert-list">
        {visible.map((a) => (
          <li key={a.id} className={`alert-item sev-${a.severity} ${a.status === 'read' ? 'is-read' : 'is-open'}`}>
            <span className="alert-sev" title={SEVERITY_LABEL[a.severity]}>
              <IconBell size={18} />
            </span>
            <div className="grow">
              <strong className="alert-msg">{a.message}</strong>
              <div className="chips">
                <span className="tag tag-file">
                  <IconTable size={14} />
                  {a.file_name}
                </span>
                {a.sheet_name && <span className="tag tag-sheet">Hoja «{a.sheet_name}»</span>}
                {(a.project_name ?? projects.find((p) => p.id === a.project_id)?.name) && (
                  <span className="tag tag-project">
                    <IconFolder size={14} />
                    {a.project_name ?? projects.find((p) => p.id === a.project_id)?.name}
                  </span>
                )}
                {a.shared && <span className="tag tag-count">Compartida contigo</span>}
                <span className="tag tag-rule">Regla «{a.rule_name}»</span>
                <span className="tag tag-count">
                  {a.matched_count} fila{a.matched_count === 1 ? '' : 's'}
                  {a.row_refs?.length > 0 &&
                    `: ${a.row_refs.slice(0, 10).join(', ')}${a.matched_count > 10 ? '…' : ''}`}
                </span>
              </div>
              <time className="muted" dateTime={a.created_at}>
                {new Date(a.created_at).toLocaleString('es-ES')}
              </time>
            </div>
            <div className="alert-actions">
              {!a.shared && a.status === 'open' && (
                <button className="btn" onClick={() => setStatus(a, 'read')}>
                  Marcar leída
                </button>
              )}
              {!a.shared && (
                <button className="btn ghost-line" onClick={() => setStatus(a, 'dismissed')}>
                  Descartar
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
