'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { MAX_CHARTS, type ChartResult, type QueryItemResult } from '@/lib/stats/types';
import { IconChart, IconPlus, IconRefresh } from '../Icons';
import { ChartBuilder, type FileOption, type SavedChart } from './ChartBuilder';
import { ChartCard, type ChartState } from './ChartCard';

type Editing = SavedChart | 'new' | null;

export function StatsBoard({ files, initialCharts }: { files: FileOption[]; initialCharts: SavedChart[] }) {
  const [charts, setCharts] = useState<SavedChart[]>(initialCharts);
  const [states, setStates] = useState<Record<string, ChartState>>({});
  const [editing, setEditing] = useState<Editing>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loaded = useRef(false);

  /** Pide los datos agregados de varias gráficas en UNA petición (un archivo = una descarga). */
  const load = useCallback(async (list: SavedChart[]) => {
    if (!list.length) return;
    setStates((prev) => {
      const next = { ...prev };
      for (const c of list) next[c.id] = { status: 'loading' };
      return next;
    });
    try {
      const res = await fetch('/api/stats/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ charts: list.map((c) => ({ id: c.id, config: c.config })) }),
      });
      const body = await res.json().catch(() => ({}));
      const results: Record<string, QueryItemResult> = body.results ?? {};
      setStates((prev) => {
        const next = { ...prev };
        for (const c of list) {
          const item = results[c.id];
          next[c.id] = item?.result
            ? { status: 'ok', result: item.result }
            : { status: 'error', error: item?.error ?? 'read_error' };
        }
        return next;
      });
    } catch {
      setStates((prev) => {
        const next = { ...prev };
        for (const c of list) next[c.id] = { status: 'error', error: 'read_error' };
        return next;
      });
    }
  }, []);

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    void load(initialCharts);
  }, [initialCharts, load]);

  async function refreshAll() {
    setRefreshing(true);
    await load(charts);
    setRefreshing(false);
  }

  function onSaved(chart: SavedChart, result: ChartResult | null) {
    setCharts((prev) => {
      const exists = prev.some((c) => c.id === chart.id);
      return exists ? prev.map((c) => (c.id === chart.id ? chart : c)) : [...prev, chart];
    });
    if (result) setStates((prev) => ({ ...prev, [chart.id]: { status: 'ok', result } }));
    else void load([chart]);
    setEditing(null);
  }

  async function remove(chart: SavedChart) {
    if (!confirm('¿Quitar esta gráfica del panel? El archivo en tu Drive no se toca.')) return;
    setError(null);
    const res = await fetch(`/api/stats/charts/${chart.id}`, { method: 'DELETE' });
    if (!res.ok) {
      setError('No se pudo quitar la gráfica. Inténtalo de nuevo.');
      return;
    }
    setCharts((prev) => prev.filter((c) => c.id !== chart.id));
  }

  const fileName = (id: string) => files.find((f) => f.id === id)?.name ?? 'Archivo';
  const noFiles = files.length === 0;
  const full = charts.length >= MAX_CHARTS;

  return (
    <>
      <div className="stats-toolbar">
        <button className="btn primary" onClick={() => setEditing('new')} disabled={noFiles || full}>
          <IconPlus size={16} />
          Nueva gráfica
        </button>
        {charts.length > 0 && (
          <button className="btn" onClick={refreshAll} disabled={refreshing}>
            <IconRefresh size={16} />
            {refreshing ? 'Actualizando…' : 'Actualizar datos'}
          </button>
        )}
        <span className="muted grow stats-count">
          {charts.length > 0 && `${charts.length} de ${MAX_CHARTS} gráficas`}
        </span>
      </div>
      {error && <p className="err">{error}</p>}

      {noFiles && (
        <div className="empty">
          <span className="empty-icon">
            <IconChart size={28} />
          </span>
          <strong>Primero comparte un archivo</strong>
          <p className="muted">Ve al Dashboard, añade un Excel, un CSV o una Hoja de Google y vuelve aquí para crear gráficas.</p>
        </div>
      )}

      {!noFiles && charts.length === 0 && (
        <div className="empty">
          <span className="empty-icon">
            <IconChart size={28} />
          </span>
          <strong>Tu panel está vacío</strong>
          <p className="muted">
            Crea tu primera gráfica: elige el tipo, las columnas de cada eje y la operación (suma, promedio, recuento…).
          </p>
          <button className="btn primary" onClick={() => setEditing('new')}>
            <IconPlus size={16} />
            Crear la primera gráfica
          </button>
        </div>
      )}

      <div className="chart-grid">
        {charts.map((chart) => (
          <ChartCard
            key={chart.id}
            config={chart.config}
            fileName={fileName(chart.config.fileId)}
            state={states[chart.id] ?? { status: 'loading' }}
            onEdit={() => setEditing(chart)}
            onDelete={() => remove(chart)}
          />
        ))}
      </div>

      {editing && (
        <ChartBuilder
          key={editing === 'new' ? 'new' : editing.id}
          files={files}
          initial={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={onSaved}
        />
      )}
    </>
  );
}
