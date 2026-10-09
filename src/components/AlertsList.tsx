'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

interface AlertRow {
  id: string;
  file_name: string;
  rule_name: string;
  message: string;
  severity: 'info' | 'warning' | 'critical';
  matched_count: number;
  row_refs: number[];
  status: 'open' | 'read' | 'dismissed';
  created_at: string;
}

export function AlertsList({ companyId, initial }: { companyId: string; initial: AlertRow[] }) {
  const [alerts, setAlerts] = useState<AlertRow[]>(initial);
  const supabase = createClient();

  // Tiempo real: Supabase Realtime respeta RLS, solo llegan alertas de tu empresa.
  useEffect(() => {
    const channel = supabase
      .channel(`alerts:${companyId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'alerts', filter: `company_id=eq.${companyId}` },
        (payload) => setAlerts((prev) => [payload.new as AlertRow, ...prev]),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  async function setStatus(id: string, status: 'read' | 'dismissed') {
    const { error } = await supabase
      .from('alerts')
      .update({ status, read_at: new Date().toISOString() })
      .eq('id', id);
    if (error) return;
    setAlerts((prev) =>
      status === 'dismissed' ? prev.filter((a) => a.id !== id) : prev.map((a) => (a.id === id ? { ...a, status } : a)),
    );
  }

  if (!alerts.length) return <p className="muted">No hay alertas. Todo en orden.</p>;

  return (
    <>
      {alerts.map((a) => (
        <div key={a.id} className={`card sev-${a.severity} ${a.status === 'read' ? 'alert-read' : ''}`}>
          <div className="row wrap">
            <div className="grow">
              <strong>{a.message}</strong>
              <div className="muted">
                {a.file_name} · {a.rule_name} · {a.matched_count} fila{a.matched_count === 1 ? '' : 's'}
                {a.row_refs.length > 0 &&
                  ` (${a.row_refs.slice(0, 10).join(', ')}${a.matched_count > 10 ? '…' : ''})`}
              </div>
              <div className="muted">{new Date(a.created_at).toLocaleString('es-ES')}</div>
            </div>
            {a.status === 'open' && (
              <button className="btn" onClick={() => setStatus(a.id, 'read')}>
                Marcar leída
              </button>
            )}
            <button className="btn" onClick={() => setStatus(a.id, 'dismissed')}>
              Descartar
            </button>
          </div>
        </div>
      ))}
    </>
  );
}
