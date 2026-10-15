'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { MAX_CHARTS, type ChartResult, type QueryItemResult } from '@/lib/stats/types';
import { clearLocalCache, localQuery } from '@/lib/stats/local';
import { IconChart, IconPlus, IconRefresh } from '../Icons';
import { ChartBuilder, type FileOption, type SavedChart } from './ChartBuilder';
import { ChartCard, type ChartState } from './ChartCard';

type Editing = SavedChart | 'new' | null;

export function StatsBoard({
  files,
  initialCharts,
  projectId,
  readOnly = false,
}: {
  files: FileOption[];
  initialCharts: SavedChart[];
  /** Proyecto que se está viendo (null = archivos sin proyecto). */
  projectId: string | null;
  /** Proyecto compartido contigo: puedes ver las gráficas, no cambiarlas. */
  readOnly?: boolean;
}) {
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
      // Los archivos de este ordenador se calculan aquí, con los datos que entrega el agente.
      const localIds = new Set(files.filter((f) => f.source === 'local').map((f) => f.id));
      const mine = list.filter((c) => localIds.has(c.config.fileId));
      const remote = list.filter((c) => !localIds.has(c.config.fileId));
      const results: Record<string, QueryItemResult> = {};
      const tasks: Promise<void>[] = [];
      if (mine.length) {
        tasks.push(localQuery(mine.map((c) => ({ id: c.id, config: c.config }))).then((r) => void Object.assign(results, r)));
      }
      if (remote.length) {
        tasks.push(
          (async () => {
            const res = await fetch('/api/stats/query', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ charts: remote.map((c) => ({ id: c.id, config: c.config })) }),
            });
            const body = await res.json().catch(() => ({}));
            Object.assign(results, (body.results ?? {}) as Record<string, QueryItemResult>);
            // Por si el archivo es local pero la lista no lo sabía: reintento con el agente.
            const retry = remote.filter((c) => results[c.id]?.error === 'local_file');
            if (retry.length) Object.assign(results, await localQuery(retry.map((c) => ({ id: c.id, config: c.config }))));
          })(),
        );
      }
      await Promise.all(tasks);
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
  }, [files]);

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    void load(initialCharts);
  }, [initialCharts, load]);

  async function refreshAll() {
    setRefreshing(true);
    clearLocalCache(); // vuelve a leer también los archivos de este ordenador
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
        {!readOnly && (
          <button className="btn primary" onClick={() => setEditing('new')} disabled={noFiles || full}>
            <IconPlus size={16} />
            Nueva gráfica
          </button>
        )}
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
          <strong>{readOnly ? 'Este proyecto no tiene archivos de Drive' : 'Primero añade un archivo a este proyecto'}</strong>
          <p className="muted">
            {readOnly
              ? 'Las estadísticas se crean sobre archivos de Google Drive.'
              : 'Ve al Dashboard, añade un Excel, un CSV o una Hoja de Google (o muévelo a este proyecto) y vuelve aquí para crear gráficas.'}
          </p>
        </div>
      )}

      {readOnly && !noFiles && charts.length === 0 && (
        <div className="empty">
          <span className="empty-icon">
            <IconChart size={28} />
          </span>
          <strong>Todavía no hay gráficas en este proyecto</strong>
          <p className="muted">Cuando quien comparte el proyecto cree alguna, aparecerá aquí.</p>
        </div>
      )}

      {!readOnly && !noFiles && charts.length === 0 && (
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
            onEdit={readOnly ? undefined : () => setEditing(chart)}
            onDelete={readOnly ? undefined : () => remove(chart)}
          />
        ))}
      </div>

      {editing && (
        <ChartBuilder
          key={editing === 'new' ? 'new' : editing.id}
          files={files}
          projectId={projectId}
          initial={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={onSaved}
        />
      )}
    </>
  );
}
