'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { personalize, type MyShare } from '@/lib/assign/assign';
import { defaultColumns, rowLabel } from '@/lib/alerts/rows';
import { createClient } from '@/lib/supabase/client';
import { useAlerts, type AlertRow } from '../AlertsProvider';
import { useAlertRows } from './useAlertRows';

interface TaskLabel {
  now: string | null;
  next: string | null;
  prev: string | null;
  canPass: boolean;
  canBack: boolean;
  mine: boolean;
}
const title = (n: string | null) => (n ? n.replace(/\b\p{L}/gu, (c) => c.toUpperCase()) : '');

const SEVERITY_LABEL = { info: 'Informativa', warning: 'Aviso', critical: 'Crítica' } as const;

/** Detalle completo de una alerta: el mensaje entero y las filas exactas que la dispararon, con sus datos. */
export function AlertDetail({
  alert,
  share,
  onFill,
  onClose,
}: {
  alert: AlertRow;
  share?: MyShare;
  /** Abre «Rellenar» (solo si la regla tiene plantilla). */
  onFill?: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const state = useAlertRows(alert.id);
  const [allCols, setAllCols] = useState(false);
  const [onlyMine, setOnlyMine] = useState(false);
  const { reloadHandoffs } = useAlerts();
  const [labels, setLabels] = useState<Record<string, TaskLabel>>({});
  const [taskError, setTaskError] = useState<string | null>(null);
  const chainRows = useMemo(() => Object.keys(alert.chains ?? {}).map(Number), [alert.chains]);

  async function loadLabels() {
    const supabase = createClient();
    const next: Record<string, TaskLabel> = {};
    for (let i = 0; i < chainRows.length; i += 40) {
      const { data } = await supabase.rpc('alert_task_labels', { p_alert: alert.id, p_rows: chainRows.slice(i, i + 40) });
      Object.assign(next, data ?? {});
    }
    setLabels(next);
  }
  useEffect(() => {
    if (chainRows.length) void loadLabels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alert.id, chainRows.length]);

  async function pass(row: number, delta: 1 | -1) {
    setTaskError(null);
    const { error } = await createClient().rpc('handoff_task', { p_alert: alert.id, p_row: row, p_delta: delta });
    if (error) {
      setTaskError('No se pudo pasar la tarea. Puede que ya no la tengas tú.');
      return;
    }
    if (alert.rule_id) await reloadHandoffs(alert.rule_id);
    await loadLabels();
  }

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  const mine = useMemo(() => new Set(share?.rows ?? []), [share]);
  const data = state.status === 'ok' ? state.data : null;
  const shown = useMemo(() => {
    if (!data) return [];
    return onlyMine && mine.size ? data.rows.filter((r) => mine.has(r.n)) : data.rows;
  }, [data, onlyMine, mine]);
  const cols = useMemo(() => {
    if (!data) return [];
    return allCols ? data.headers.map((_, i) => i) : defaultColumns(data.headers, data.highlight);
  }, [data, allCols]);

  const message = share ? personalize(alert.message, share) : alert.message;
  const notShown = data ? Math.max(0, data.total - data.rows.length - data.missing.length) : 0;

  return (
    <dialog ref={ref} className="dialog dialog-wide alert-detail" onClose={onClose} aria-labelledby="ad-title">
      <div className="ad-head">
        <h2 id="ad-title">Detalle de la alerta</h2>
        <span className={`tag ad-sev ad-sev-${alert.severity}`}>{SEVERITY_LABEL[alert.severity]}</span>
      </div>
      <p className="ad-message">{message}</p>
      <div className="chips">
        <span className="tag tag-file">{alert.file_name}</span>
        {alert.sheet_name && <span className="tag tag-sheet">Hoja «{alert.sheet_name}»</span>}
        <span className="tag tag-rule">Regla «{alert.rule_name}»</span>
        <span className="tag tag-count">
          {alert.matched_count} fila{alert.matched_count === 1 ? '' : 's'}
        </span>
        <time className="muted" dateTime={alert.created_at}>
          {new Date(alert.created_at).toLocaleString('es-ES')}
        </time>
      </div>

      <h3 className="share-h">Filas que han disparado la alerta</h3>
      {taskError && <p className="err" role="alert">{taskError}</p>}
      {state.status === 'loading' && <p className="muted" role="status">Leyendo las filas del archivo…</p>}
      {state.status === 'error' && <p className="err" role="alert">{state.message}</p>}
      {data && (
        <>
          <div className="ad-tools">
            {data.moreColumns || data.headers.length > 4 ? (
              <label className="choice">
                <input type="checkbox" checked={allCols} onChange={(e) => setAllCols(e.target.checked)} />
                <span>Ver todas las columnas</span>
              </label>
            ) : null}
            {mine.size > 0 && (
              <label className="choice">
                <input type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} />
                <span>Solo las mías ({mine.size})</span>
              </label>
            )}
          </div>
          {data.rows.length === 0 ? (
            <p className="muted">Esas filas ya no existen en el archivo. Se actualizará en la próxima comprobación.</p>
          ) : (
            <div className="ad-table-wrap" tabIndex={0} aria-label="Filas de la alerta">
              <table className="ad-table">
                <thead>
                  <tr>
                    <th scope="col">Fila</th>
                    {chainRows.length > 0 && <th scope="col">Responsable</th>}
                    {cols.map((i) => (
                      <th key={i} scope="col" className={data.highlight.includes(data.headers[i]) ? 'is-rule' : ''}>
                        {data.headers[i]}
                        {data.highlight.includes(data.headers[i]) && <span className="ad-rule-mark" title="Columna que usa la regla"> ●</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.n} className={mine.has(r.n) ? 'is-mine' : ''}>
                      <th scope="row" title={rowLabel(data.headers, r.cells, r.n)}>
                        {r.n}
                        {mine.has(r.n) && <span className="ad-mine"> tuya</span>}
                      </th>
                      {chainRows.length > 0 && (
                        <td>
                          {labels[String(r.n)] ? (
                            <span className="task-cell">
                              <span>{title(labels[String(r.n)].now)}{labels[String(r.n)].mine ? ' (tú)' : ''}</span>
                              {labels[String(r.n)].canPass && labels[String(r.n)].next && (
                                <button type="button" className="btn" onClick={() => void pass(r.n, 1)}>
                                  Pasar tarea a {title(labels[String(r.n)].next)}
                                </button>
                              )}
                              {labels[String(r.n)].canBack && labels[String(r.n)].prev && (
                                <button type="button" className="btn ghost-line" onClick={() => void pass(r.n, -1)}>
                                  Devolver a {title(labels[String(r.n)].prev)}
                                </button>
                              )}
                            </span>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                      )}
                      {cols.map((i) => (
                        <td key={i} className={data.highlight.includes(data.headers[i]) ? 'is-rule' : ''}>
                          {r.cells[i] || <span className="muted">—</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="muted ad-foot">
            {data.highlight.length > 0 && <>● Columnas que usa la regla. </>}
            {data.missing.length > 0 && <>{data.missing.length} fila(s) ya no existen en el archivo. </>}
            {notShown > 0 && <>Se muestran las primeras {data.rows.length} de {data.total} filas.</>}
          </p>
        </>
      )}

      <div className="dialog-actions">
        {onFill && (
          <button type="button" className="btn primary" onClick={onFill}>
            Rellenar informe…
          </button>
        )}
        <button type="button" className="btn" onClick={() => ref.current?.close()}>
          Cerrar
        </button>
      </div>
    </dialog>
  );
}
