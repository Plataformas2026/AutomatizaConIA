'use client';

import { useState } from 'react';
import {
  AGG_LABELS,
  chartInfo,
  displayTitle,
  ERROR_MESSAGES,
  type ChartConfig,
  type ChartResult,
} from '@/lib/stats/types';
import { IconChart, IconEdit, IconTableView, IconTrash } from '../Icons';
import { ChartRenderer } from './ChartRenderer';
import { fmt } from './format';

export type ChartState =
  | { status: 'loading' }
  | { status: 'ok'; result: ChartResult }
  | { status: 'error'; error: string };

/** Vista alternativa en tabla de cualquier gráfica (accesible y para copiar cifras). */
function ResultTable({ config, result }: { config: ChartConfig; result: ChartResult }) {
  if (result.kind === 'kpi') {
    return (
      <table className="sumtable">
        <tbody>
          <tr>
            <th scope="row">{config.agg === 'count' ? 'Filas' : `${AGG_LABELS[config.agg]} de ${config.y}`}</th>
            <td className="num">{result.value === null ? '—' : fmt(result.value)}</td>
          </tr>
        </tbody>
      </table>
    );
  }
  if (result.kind === 'points') {
    return (
      <div className="table-scroll">
        <table className="sumtable">
          <thead>
            <tr>
              <th scope="col" className="num">{config.x}</th>
              <th scope="col" className="num">{config.y}</th>
            </tr>
          </thead>
          <tbody>
            {result.data.slice(0, 100).map((p, i) => (
              <tr key={i}>
                <td className="num">{fmt(p.x)}</td>
                <td className="num">{fmt(p.y)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {result.data.length > 100 && <p className="muted chart-note">Se muestran las primeras 100 de {result.data.length} filas.</p>}
      </div>
    );
  }
  if (result.kind === 'multi') {
    return (
      <div className="table-scroll">
        <table className="sumtable">
          <thead>
            <tr>
              <th scope="col">{config.x}</th>
              {result.keys.map((k) => (
                <th scope="col" className="num" key={k}>{k}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.data.map((row) => (
              <tr key={String(row.label)}>
                <th scope="row">{row.label}</th>
                {result.keys.map((k) => (
                  <td className="num" key={k}>{fmt(row[k] as number)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return (
    <div className="table-scroll">
      <table className="sumtable">
        <thead>
          <tr>
            <th scope="col">{config.x}</th>
            <th scope="col" className="num">
              {config.agg === 'count' ? 'Filas' : `${AGG_LABELS[config.agg]} de ${config.y}`}
            </th>
          </tr>
        </thead>
        <tbody>
          {result.data.map((d) => (
            <tr key={d.label}>
              <th scope="row">{d.label}</th>
              <td className="num">{fmt(d.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface Props {
  config: ChartConfig;
  fileName: string;
  state: ChartState;
  onEdit: () => void;
  onDelete: () => void;
}

export function ChartCard({ config, fileName, state, onEdit, onDelete }: Props) {
  const [asTable, setAsTable] = useState(false);
  const info = chartInfo(config.type);
  const isKpi = config.type === 'kpi';
  const canToggle = state.status === 'ok' && config.type !== 'table';

  return (
    <article className={`chart-card ${config.size === 'wide' ? 'is-wide' : ''} ${isKpi ? 'is-kpi' : ''}`}>
      <header className="chart-head">
        <div className="grow">
          <h3>{displayTitle(config)}</h3>
          <div className="chips">
            <span className="tag tag-type">{info.label}</span>
            <span className="tag tag-file">{fileName}</span>
            {config.sheet && <span className="tag tag-sheet">Hoja «{config.sheet}»</span>}
          </div>
        </div>
        <div className="chart-actions">
          {canToggle && (
            <button
              type="button"
              className="iconbtn"
              onClick={() => setAsTable((v) => !v)}
              aria-pressed={asTable}
              title={asTable ? 'Ver gráfica' : 'Ver como tabla'}
            >
              {asTable ? <IconChart size={17} /> : <IconTableView size={17} />}
              <span className="sr-only">{asTable ? 'Ver gráfica' : 'Ver como tabla'}</span>
            </button>
          )}
          <button type="button" className="iconbtn" onClick={onEdit} title="Editar gráfica">
            <IconEdit size={17} />
            <span className="sr-only">Editar gráfica</span>
          </button>
          <button type="button" className="iconbtn danger" onClick={onDelete} title="Quitar gráfica">
            <IconTrash size={17} />
            <span className="sr-only">Quitar gráfica</span>
          </button>
        </div>
      </header>

      <div className="chart-body">
        {state.status === 'loading' && (
          <div className="chart-skeleton" role="status" aria-label="Cargando datos">
            <span />
          </div>
        )}
        {state.status === 'error' && (
          <p className="err chart-note">{ERROR_MESSAGES[state.error] ?? ERROR_MESSAGES.read_error}</p>
        )}
        {state.status === 'ok' &&
          (asTable ? (
            <ResultTable config={config} result={state.result} />
          ) : (
            <ChartRenderer config={config} result={state.result} />
          ))}
      </div>

      {state.status === 'ok' && state.result.kind === 'points' && state.result.sampled && (
        <p className="muted chart-foot">Muestra de {state.result.data.length} de {state.result.total} puntos.</p>
      )}
      {state.status === 'ok' && state.result.kind !== 'points' && state.result.kind !== 'kpi' && state.result.folded && (
        <p className="muted chart-foot">Se muestran los valores principales; el resto no cabe en la gráfica.</p>
      )}
    </article>
  );
}
