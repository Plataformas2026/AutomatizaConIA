'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AGG_LABELS,
  allowedAggs,
  autoTitle,
  CHART_CATALOG,
  CHART_GROUPS,
  chartConfigSchema,
  chartInfo,
  ERROR_MESSAGES,
  LIMIT_OPTIONS,
  MAX_CHARTS,
  NUMERIC_AGGS,
  ORDERED_TYPES,
  STACKED_TYPES,
  type Agg,
  type ChartConfig,
  type ChartResult,
  type ChartType,
  type ColumnKind,
  type StructureSheet,
} from '@/lib/stats/types';
import { ChartRenderer } from './ChartRenderer';
import { IconClose } from '../Icons';

export interface FileOption {
  id: string;
  name: string;
  mime_type: string;
}

export interface SavedChart {
  id: string;
  config: ChartConfig;
  position: number;
}

type Cols = StructureSheet['columns'];

interface Draft {
  type: ChartType;
  title: string;
  fileId: string;
  sheet: string | null;
  x: string | null;
  y: string | null;
  agg: Agg;
  series: string | null;
  limit: number;
  size: 'normal' | 'wide';
}

const KIND_LABEL: Record<ColumnKind, string> = { number: 'número', date: 'fecha', text: 'texto' };

/** Ajusta las columnas elegidas a lo que admite el tipo de gráfica y a lo que existe en la hoja. */
function reconcile(d: Draft, cols: Cols): Draft {
  const names = cols.map((c) => c.name);
  const numbers = cols.filter((c) => c.kind === 'number');
  const categories = cols.filter((c) => c.kind !== 'number');
  const next = { ...d };

  if (d.type === 'scatter') {
    const numNames = numbers.map((c) => c.name);
    next.x = d.x && numNames.includes(d.x) ? d.x : (numNames[0] ?? null);
    next.y = d.y && numNames.includes(d.y) && d.y !== next.x ? d.y : (numNames.find((n) => n !== next.x) ?? numNames[0] ?? null);
    next.series = null;
    return next;
  }

  if (d.type !== 'kpi') {
    if (d.x && names.includes(d.x)) next.x = d.x;
    else if (ORDERED_TYPES.includes(d.type)) next.x = (cols.find((c) => c.kind === 'date') ?? categories[0] ?? cols[0])?.name ?? null;
    else next.x = (categories[0] ?? cols[0])?.name ?? null;
  } else {
    next.x = null;
  }

  if (!allowedAggs(d.type).includes(d.agg)) next.agg = 'count';

  if (next.agg === 'count') {
    next.y = d.y && names.includes(d.y) ? d.y : null;
  } else if (next.agg === 'distinct') {
    next.y = d.y && names.includes(d.y) ? d.y : (categories[0] ?? cols[0])?.name ?? null;
  } else {
    next.y = d.y && names.includes(d.y) ? d.y : (numbers[0] ?? cols[0])?.name ?? null;
  }

  if (STACKED_TYPES.includes(d.type)) {
    next.series =
      d.series && names.includes(d.series) && d.series !== next.x
        ? d.series
        : (categories.find((c) => c.name !== next.x) ?? cols.find((c) => c.name !== next.x))?.name ?? null;
  } else {
    next.series = null;
  }
  return next;
}

function newDraft(files: FileOption[], saved: SavedChart | null): Draft {
  if (saved) return { ...saved.config };
  return {
    type: 'bar',
    title: '',
    fileId: files[0]?.id ?? '',
    sheet: null,
    x: null,
    y: null,
    agg: 'count',
    series: null,
    limit: 10,
    size: 'normal',
  };
}

type Preview =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; config: ChartConfig; result: ChartResult }
  | { status: 'error'; error: string };

interface Props {
  files: FileOption[];
  initial: SavedChart | null;
  onClose: () => void;
  onSaved: (chart: SavedChart, result: ChartResult | null) => void;
}

export function ChartBuilder({ files, initial, onClose, onSaved }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cache = useRef(new Map<string, StructureSheet[]>());
  const [draft, setDraft] = useState<Draft>(() => newDraft(files, initial));
  const [structure, setStructure] = useState<StructureSheet[] | null>(null);
  const [structError, setStructError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview>({ status: 'idle' });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  /* Estructura del archivo (hojas y columnas) cada vez que cambia el archivo. */
  useEffect(() => {
    if (!draft.fileId) return;
    let cancelled = false;
    setStructError(null);

    const apply = (sheets: StructureSheet[]) => {
      if (cancelled) return;
      setStructure(sheets);
      setDraft((d) => {
        const sheet = sheets.find((s) => s.name === d.sheet) ?? sheets[0];
        if (!sheet) return d;
        return reconcile({ ...d, sheet: sheet.name }, sheet.columns);
      });
    };

    const cached = cache.current.get(draft.fileId);
    if (cached) {
      apply(cached);
      return () => {
        cancelled = true;
      };
    }

    setStructure(null);
    fetch(`/api/stats/structure?fileId=${draft.fileId}`, { cache: 'no-store' })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setStructError(ERROR_MESSAGES[body.error] ?? ERROR_MESSAGES.read_error);
          return;
        }
        cache.current.set(draft.fileId, body.sheets);
        apply(body.sheets);
      })
      .catch(() => !cancelled && setStructError(ERROR_MESSAGES.read_error));
    return () => {
      cancelled = true;
    };
  }, [draft.fileId]);

  const sheet = structure?.find((s) => s.name === draft.sheet) ?? structure?.[0] ?? null;
  const cols: Cols = useMemo(() => sheet?.columns ?? [], [sheet]);
  const numberCols = cols.filter((c) => c.kind === 'number');

  function patch(change: Partial<Draft>) {
    setDraft((d) => reconcile({ ...d, ...change }, cols));
  }

  function changeSheet(name: string) {
    const target = structure?.find((s) => s.name === name);
    if (target) setDraft((d) => reconcile({ ...d, sheet: name }, target.columns));
  }

  function changeAgg(agg: Agg) {
    setDraft((d) => {
      const next: Draft = { ...d, agg };
      // Al pasar de «contar» a una operación con columna, propón una numérica.
      if (agg !== 'count' && agg !== 'distinct' && (!d.y || !numberCols.some((c) => c.name === d.y))) {
        next.y = numberCols[0]?.name ?? d.y;
      }
      return reconcile(next, cols);
    });
  }

  /* Configuración válida → vista previa con datos reales (agregados). */
  const parsed = useMemo(() => chartConfigSchema.safeParse(draft), [draft]);
  const config = parsed.success ? parsed.data : null;
  const configKey = config ? JSON.stringify(config) : '';

  useEffect(() => {
    if (!config || !structure) {
      setPreview({ status: 'idle' });
      return;
    }
    const controller = new AbortController();
    setPreview({ status: 'loading' });
    const timer = setTimeout(async () => {
      try {
        const res = await fetch('/api/stats/query', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ charts: [{ id: 'preview', config }] }),
          signal: controller.signal,
        });
        const body = await res.json().catch(() => ({}));
        const item = body.results?.preview;
        if (!res.ok || !item) setPreview({ status: 'error', error: 'read_error' });
        else if (item.error) setPreview({ status: 'error', error: item.error });
        else setPreview({ status: 'ok', config, result: item.result });
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setPreview({ status: 'error', error: 'read_error' });
      }
    }, 450);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configKey, structure]);

  async function save() {
    if (!config) return;
    setSaving(true);
    setSaveError(null);
    const res = await fetch(initial ? `/api/stats/charts/${initial.id}` : '/api/stats/charts', {
      method: initial ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config }),
    });
    const body = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      setSaveError(
        body.error === 'too_many_charts'
          ? `Has llegado al máximo de ${MAX_CHARTS} gráficas. Quita alguna para añadir otra.`
          : 'No se pudo guardar la gráfica. Inténtalo de nuevo.',
      );
      return;
    }
    onSaved(body.chart as SavedChart, preview.status === 'ok' ? preview.result : null);
  }

  const info = chartInfo(draft.type);
  const isKpi = draft.type === 'kpi';
  const isScatter = draft.type === 'scatter';
  const isStacked = STACKED_TYPES.includes(draft.type);
  const showLimit = !isKpi && !isScatter && !ORDERED_TYPES.includes(draft.type);
  const yOptions = draft.agg === 'distinct' ? cols : numberCols.length ? numberCols : cols;
  const xOptions = isScatter ? numberCols : cols;
  const file = files.find((f) => f.id === draft.fileId);
  const hasSheets = !!structure && structure.length > 0 && structure[0].name !== null;

  const colLabel = (c: Cols[number]) => `${c.name} (${KIND_LABEL[c.kind]})`;

  return (
    <dialog
      ref={dialogRef}
      className="dialog dialog-wide"
      aria-labelledby="builder-title"
      onClose={onClose}
      onCancel={(e) => {
        if (saving) e.preventDefault();
      }}
    >
      <div className="builder-head">
        <h2 id="builder-title">{initial ? 'Editar gráfica' : 'Nueva gráfica'}</h2>
        <button type="button" className="iconbtn" onClick={() => dialogRef.current?.close()} aria-label="Cerrar">
          <IconClose size={18} />
        </button>
      </div>

      <div className="builder">
        <form
          className="builder-form"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div className="field">
            <label htmlFor="b-type">Tipo de gráfica</label>
            <select id="b-type" value={draft.type} onChange={(e) => patch({ type: e.target.value as ChartType })}>
              {CHART_GROUPS.map((g) => (
                <optgroup key={g} label={g}>
                  {CHART_CATALOG.filter((c) => c.group === g).map((c) => (
                    <option key={c.type} value={c.type}>
                      {c.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <span className="muted">{info.hint}</span>
          </div>

          <div className="field">
            <label htmlFor="b-title">Título</label>
            <input
              id="b-title"
              maxLength={80}
              value={draft.title}
              placeholder={autoTitle(draft)}
              onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
            />
          </div>

          <div className="field">
            <label htmlFor="b-file">Archivo</label>
            <select id="b-file" value={draft.fileId} onChange={(e) => setDraft((d) => ({ ...d, fileId: e.target.value }))}>
              {files.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>

          {structError && <p className="err">{structError}</p>}
          {!structure && !structError && <p className="muted">Leyendo las columnas de tu archivo…</p>}

          {structure && hasSheets && structure.length > 1 && (
            <div className="field">
              <label htmlFor="b-sheet">Hoja</label>
              <select id="b-sheet" value={draft.sheet ?? ''} onChange={(e) => changeSheet(e.target.value)}>
                {structure.map((s) => (
                  <option key={s.name} value={s.name ?? ''}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {structure && cols.length === 0 && <p className="err">Esta hoja no tiene columnas con cabecera.</p>}

          {structure && cols.length > 0 && (
            <>
              {!isKpi && (
                <div className="field">
                  <label htmlFor="b-x">{info.xLabel}</label>
                  <select id="b-x" value={draft.x ?? ''} onChange={(e) => patch({ x: e.target.value || null })}>
                    {xOptions.map((c) => (
                      <option key={c.name} value={c.name}>
                        {colLabel(c)}
                      </option>
                    ))}
                  </select>
                  {isScatter && numberCols.length < 2 && (
                    <span className="err">La dispersión necesita dos columnas numéricas y esta hoja tiene {numberCols.length}.</span>
                  )}
                </div>
              )}

              {isScatter ? (
                <div className="field">
                  <label htmlFor="b-y">Eje Y (número)</label>
                  <select id="b-y" value={draft.y ?? ''} onChange={(e) => patch({ y: e.target.value || null })}>
                    {numberCols.map((c) => (
                      <option key={c.name} value={c.name}>
                        {colLabel(c)}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="field-pair">
                  <div className="field">
                    <label htmlFor="b-agg">{isKpi ? 'Valor: operación' : 'Eje Y: operación'}</label>
                    <select id="b-agg" value={draft.agg} onChange={(e) => changeAgg(e.target.value as Agg)}>
                      {allowedAggs(draft.type).map((a) => (
                        <option key={a} value={a}>
                          {AGG_LABELS[a]}
                        </option>
                      ))}
                    </select>
                  </div>
                  {draft.agg !== 'count' ? (
                    <div className="field">
                      <label htmlFor="b-y">{isKpi ? 'Valor: columna' : 'Eje Y: columna'}</label>
                      <select id="b-y" value={draft.y ?? ''} onChange={(e) => patch({ y: e.target.value || null })}>
                        {yOptions.map((c) => (
                          <option key={c.name} value={c.name}>
                            {colLabel(c)}
                          </option>
                        ))}
                      </select>
                      {NUMERIC_AGGS.includes(draft.agg) && numberCols.length === 0 && (
                        <span className="err">Esta hoja no tiene columnas numéricas.</span>
                      )}
                    </div>
                  ) : (
                    <p className="muted pair-note">Cuenta las filas de cada grupo.</p>
                  )}
                </div>
              )}

              {isStacked && (
                <div className="field">
                  <label htmlFor="b-series">Dividir cada barra por</label>
                  <select id="b-series" value={draft.series ?? ''} onChange={(e) => patch({ series: e.target.value || null })}>
                    {cols
                      .filter((c) => c.name !== draft.x)
                      .map((c) => (
                        <option key={c.name} value={c.name}>
                          {colLabel(c)}
                        </option>
                      ))}
                  </select>
                </div>
              )}

              <div className="field-pair">
                {showLimit && (
                  <div className="field">
                    <label htmlFor="b-limit">Mostrar hasta</label>
                    <select id="b-limit" value={draft.limit} onChange={(e) => setDraft((d) => ({ ...d, limit: Number(e.target.value) }))}>
                      {LIMIT_OPTIONS.map((n) => (
                        <option key={n} value={n}>
                          {n} grupos
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {!isKpi && (
                  <div className="field">
                    <label htmlFor="b-size">Ancho en el panel</label>
                    <select id="b-size" value={draft.size} onChange={(e) => setDraft((d) => ({ ...d, size: e.target.value as Draft['size'] }))}>
                      <option value="normal">Normal</option>
                      <option value="wide">Ancho completo</option>
                    </select>
                  </div>
                )}
              </div>
            </>
          )}

          {!parsed.success && structure && cols.length > 0 && (
            <p className="muted">{parsed.error.issues[0]?.message}</p>
          )}
          {saveError && <p className="err">{saveError}</p>}

          <div className="dialog-actions">
            <button type="button" className="btn" onClick={() => dialogRef.current?.close()} disabled={saving}>
              Cancelar
            </button>
            <button className="btn primary" disabled={!config || saving || !file}>
              {saving ? 'Guardando…' : initial ? 'Guardar cambios' : 'Añadir al panel'}
            </button>
          </div>
        </form>

        <section className="builder-preview" aria-label="Vista previa" aria-live="polite">
          <h3>{config ? config.title.trim() || autoTitle(config) : 'Vista previa'}</h3>
          {preview.status === 'idle' && <p className="muted chart-note">Completa los campos para ver la gráfica.</p>}
          {preview.status === 'loading' && (
            <div className="chart-skeleton" role="status" aria-label="Calculando">
              <span />
            </div>
          )}
          {preview.status === 'error' && (
            <p className="err chart-note">{ERROR_MESSAGES[preview.error] ?? ERROR_MESSAGES.read_error}</p>
          )}
          {preview.status === 'ok' && <ChartRenderer config={preview.config} result={preview.result} />}
        </section>
      </div>
    </dialog>
  );
}
