'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ALGORITHM_HINTS,
  ALGORITHM_LABELS,
  ANOMALY_METHOD_HINTS,
  ANOMALY_METHOD_LABELS,
  ANOMALY_METHODS,
  autoMlTitle,
  CLUSTER_OPTIONS,
  DEPTH_OPTIONS,
  MAX_FEATURES,
  ML_ERROR_MESSAGES,
  ML_TASK_INFO,
  mlConfigSchema,
  mlTitle,
  SENSITIVITIES,
  SENSITIVITY_LABELS,
  TRAIN_OPTIONS,
  taskInfo,
  type MlAlgorithm,
  type MlConfig,
  type MlResult,
  type MlTask,
} from '@/lib/ml/types';
import { ERROR_MESSAGES, type StructureSheet } from '@/lib/stats/types';
import { StatsError } from '@/lib/stats/compute';
import { localStructure } from '@/lib/stats/local';
import { localMl } from '@/lib/ml/local';
import { IconDownload, IconPrint, IconSpark } from '../Icons';
import type { FileOption } from '../stats/ChartBuilder';
import { downloadText, resultCsv, slug } from './exports';
import { buildReportHtml } from './reportHtml';
import { FeaturePicker, type Col } from './FeaturePicker';
import { ResultPanel } from './ResultPanel';

const ALL_ERRORS = { ...ERROR_MESSAGES, ...ML_ERROR_MESSAGES };
const KIND_LABEL = { number: 'número', date: 'fecha', text: 'texto' } as const;

interface Draft {
  task: MlTask;
  title: string;
  fileId: string;
  sheet: string | null;
  target: string | null;
  features: string[];
  algorithm: MlAlgorithm;
  trainPct: number;
  depth: number;
  anomalyMethod: (typeof ANOMALY_METHODS)[number];
  sensitivity: (typeof SENSITIVITIES)[number];
  clusters: number | null;
}

function newDraft(files: FileOption[]): Draft {
  return {
    task: 'regression',
    title: '',
    fileId: files[0]?.id ?? '',
    sheet: null,
    target: null,
    features: [],
    algorithm: 'auto',
    trainPct: 80,
    depth: 5,
    anomalyMethod: 'iqr',
    sensitivity: 'normal',
    clusters: null,
  };
}

/** Columnas entre las que se puede elegir cada cosa, según la tarea. */
function pools(task: MlTask, cols: Col[], target: string | null) {
  const numbers = cols.filter((c) => c.kind === 'number');
  const targetPool = task === 'regression' ? numbers : cols;
  const featurePool =
    task === 'anomaly' ? numbers : task === 'clustering' ? cols : cols.filter((c) => c.name !== target);
  return { numbers, targetPool, featurePool };
}

/** Elecciones por defecto que sirven para empezar sin tocar nada. */
function applyDefaults(d: Draft, cols: Col[]): Draft {
  const supervised = d.task === 'regression' || d.task === 'classification';
  let target = d.target;
  if (supervised) {
    const { targetPool } = pools(d.task, cols, null);
    if (!target || !targetPool.some((c) => c.name === target)) {
      // Lo que se quiere predecir suele estar al final de la tabla (y los identificadores, al principio).
      const texts = targetPool.filter((c) => c.kind === 'text');
      target = (d.task === 'classification' ? (texts[texts.length - 1] ?? targetPool[targetPool.length - 1]) : targetPool[targetPool.length - 1])?.name ?? null;
    }
  } else {
    target = null;
  }
  const { numbers, featurePool } = pools(d.task, cols, target);
  const pool = d.task === 'clustering' && numbers.length >= 2 ? numbers : featurePool;
  return { ...d, target, features: pool.slice(0, MAX_FEATURES).map((c) => c.name) };
}

interface Props {
  files: FileOption[];
}

export function ModelStudio({ files }: Props) {
  const resultRef = useRef<HTMLDivElement>(null);
  const cache = useRef(new Map<string, StructureSheet[]>());
  const [draft, setDraft] = useState<Draft>(() => newDraft(files));
  const [structure, setStructure] = useState<StructureSheet[] | null>(null);
  const [structError, setStructError] = useState<string | null>(null);

  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [result, setResult] = useState<MlResult | null>(null);
  const [resultConfig, setResultConfig] = useState<MlConfig | null>(null);

  /* Hojas y columnas del archivo elegido. */
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
        const sameSheet = sheet.name === d.sheet;
        const base = { ...d, sheet: sheet.name };
        // Si la hoja es la misma y las columnas siguen existiendo, se respeta lo marcado.
        const keep = sameSheet && d.features.length > 0 && d.features.every((f) => sheet.columns.some((c) => c.name === f));
        return keep ? base : applyDefaults({ ...base, features: [] }, sheet.columns);
      });
    };

    const cached = cache.current.get(draft.fileId);
    if (cached) {
      apply(cached);
      return () => { cancelled = true; };
    }
    setStructure(null);
    const done = (sheets: StructureSheet[]) => {
      if (cancelled) return;
      cache.current.set(draft.fileId, sheets);
      apply(sheets);
    };
    const fail = (code: string) => !cancelled && setStructError(ALL_ERRORS[code] ?? ALL_ERRORS.read_error);
    const viaAgent = () =>
      localStructure(draft.fileId).then(done).catch((e: unknown) => fail(e instanceof StatsError ? e.code : 'read_error'));
    if (files.find((f) => f.id === draft.fileId)?.source === 'local') {
      void viaAgent(); // archivo de este ordenador: lo lee el agente
    } else {
      fetch(`/api/stats/structure?fileId=${draft.fileId}`, { cache: 'no-store' })
        .then(async (res) => {
          const body = await res.json().catch(() => ({}));
          if (cancelled) return;
          if (res.ok) return done(body.sheets);
          if (body.error === 'local_file') return viaAgent();
          fail(body.error);
        })
        .catch(() => fail('read_error'));
    }
    return () => { cancelled = true; };
  }, [draft.fileId]);

  const sheet = structure?.find((s) => s.name === draft.sheet) ?? structure?.[0] ?? null;
  const cols: Col[] = useMemo(() => sheet?.columns ?? [], [sheet]);
  const supervised = draft.task === 'regression' || draft.task === 'classification';
  const { targetPool, featurePool } = pools(draft.task, cols, draft.target);
  const parsed = useMemo(() => mlConfigSchema.safeParse(draft), [draft]);
  const info = taskInfo(draft.task);
  const hasSheets = !!structure && structure.length > 1 && structure[0].name !== null;

  function changeTask(task: MlTask) {
    setDraft((d) => {
      const algorithm = task === 'classification' && d.algorithm === 'linear' ? 'auto' : d.algorithm;
      return applyDefaults({ ...d, task, target: null, features: [], algorithm }, cols);
    });
  }

  function changeSheet(name: string) {
    const target = structure?.find((s) => s.name === name);
    if (target) setDraft((d) => applyDefaults({ ...d, sheet: name, target: null, features: [] }, target.columns));
  }

  function changeTarget(t: string) {
    setDraft((d) => {
      const features = d.features.filter((f) => f !== t);
      return features.length ? { ...d, target: t, features } : applyDefaults({ ...d, target: t, features: [] }, cols);
    });
  }

  async function run(config: MlConfig) {
    setRunning(true);
    setRunError(null);
    try {
      let result: MlResult | null = null;
      let code = 'read_error';
      if (files.find((f) => f.id === config.fileId)?.source === 'local') {
        result = await localMl(config); // se entrena en tu navegador con los datos que entrega el agente
      } else {
        const res = await fetch('/api/ml/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ config }),
        });
        const body = await res.json().catch(() => ({}));
        if (res.ok && body.result) result = body.result as MlResult;
        else if (body.error === 'local_file') result = await localMl(config);
        else code = body.error;
      }
      if (!result) {
        setRunError(ALL_ERRORS[code] ?? ALL_ERRORS.read_error);
        setResult(null);
      } else {
        setResult(result);
        setResultConfig(config);
        requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
      }
    } catch (e) {
      setRunError(ALL_ERRORS[e instanceof StatsError ? e.code : 'read_error'] ?? ALL_ERRORS.read_error);
      setResult(null);
    }
    setRunning(false);
  }

  /** El informe se construye aquí, en tu navegador, y se descarga. No se guarda en ningún sitio. */
  function downloadReport() {
    if (!result || !resultConfig) return;
    const html = buildReportHtml(result, {
      title: reportTitle,
      fileName: fileName(resultConfig.fileId),
      sheet: resultConfig.sheet,
    });
    downloadText(`${slug(reportTitle)}.html`, html, 'text/html;charset=utf-8');
  }

  const fileName = (id: string) => files.find((f) => f.id === id)?.name ?? 'Archivo';
  const csv = result ? resultCsv(result) : null;
  const reportTitle = resultConfig ? (draft.title.trim() || mlTitle(resultConfig)) : '';
  const stepOneDone = structure && cols.length > 0;

  if (files.length === 0) {
    return (
      <div className="empty">
        <span className="empty-icon"><IconSpark size={28} /></span>
        <strong>Primero comparte un archivo</strong>
        <p className="muted">Ve al Dashboard, añade un Excel, un CSV o una Hoja de Google y vuelve aquí para analizarlo.</p>
      </div>
    );
  }

  return (
    <>
      <section className="panel studio no-print" aria-labelledby="studio-title">
        <h2 id="studio-title" className="sr-only">Configurar el análisis</h2>

        <div className="step">
          <h3><span className="step-num">1</span>¿Qué quieres hacer?</h3>
          <div className="task-grid" role="radiogroup" aria-label="Tipo de análisis">
            {ML_TASK_INFO.map((t) => (
              <label key={t.task} className={`task-card ${draft.task === t.task ? 'is-on' : ''}`} style={{ ['--ta' as string]: t.accent }}>
                <input type="radio" name="task" checked={draft.task === t.task} onChange={() => changeTask(t.task)} />
                <strong>{t.plain}</strong>
                <span className="task-tech">{t.label}</span>
                <span className="muted">{t.example}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="step">
          <h3><span className="step-num">2</span>¿Con qué datos?</h3>
          <div className="field-pair">
            <div className="field">
              <label htmlFor="m-file">Archivo</label>
              <select id="m-file" value={draft.fileId} onChange={(e) => { setStructure(null); setDraft((d) => ({ ...d, fileId: e.target.value, sheet: null, target: null, features: [] })); }}>
                {files.map((f) => (<option key={f.id} value={f.id}>{f.name}</option>))}
              </select>
            </div>
            {hasSheets && structure && (
              <div className="field">
                <label htmlFor="m-sheet">Hoja</label>
                <select id="m-sheet" value={draft.sheet ?? ''} onChange={(e) => changeSheet(e.target.value)}>
                  {structure.map((s) => (<option key={s.name} value={s.name ?? ''}>{s.name}</option>))}
                </select>
              </div>
            )}
          </div>
          {structError && <p className="err">{structError}</p>}
          {!structure && !structError && <p className="muted">Leyendo las columnas de tu archivo…</p>}
          {structure && cols.length === 0 && <p className="err">Esta hoja no tiene columnas con cabecera.</p>}
        </div>

        {stepOneDone && (
          <div className="step">
            <h3><span className="step-num">3</span>{supervised ? '¿Qué quieres predecir y con qué?' : draft.task === 'anomaly' ? '¿Qué columnas revisar?' : '¿Qué columnas usar para agrupar?'}</h3>

            {supervised && (
              <div className="field">
                <label htmlFor="m-target">
                  {draft.task === 'regression' ? 'Número que quieres predecir' : 'Categoría que quieres predecir'}
                </label>
                <select id="m-target" value={draft.target ?? ''} onChange={(e) => changeTarget(e.target.value)}>
                  {targetPool.map((c) => (<option key={c.name} value={c.name}>{c.name} ({KIND_LABEL[c.kind]})</option>))}
                </select>
                {draft.task === 'regression' && targetPool.length === 0 && <span className="err">Esta hoja no tiene columnas numéricas que predecir.</span>}
                <span className="muted">
                  {draft.task === 'regression' ? 'Debe ser una columna con números, como importes, cantidades o costes.' : 'Una columna con pocas opciones distintas, como «Alto/Bajo» o un tipo de cliente.'}
                </span>
              </div>
            )}

            <FeaturePicker
              legend={supervised ? 'Columnas que ayudan a predecirlo' : draft.task === 'anomaly' ? 'Columnas con números' : 'Columnas para comparar filas'}
              help={
                supervised
                  ? 'El modelo aprende de ellas. Marca las que creas relacionadas; las que no sirvan se descartan solas.'
                  : draft.task === 'anomaly'
                    ? 'Se buscarán valores raros en cada una.'
                    : 'Las filas que se parezcan en estas columnas acabarán en el mismo grupo.'
              }
              columns={featurePool}
              selected={draft.features}
              onChange={(features) => setDraft((d) => ({ ...d, features }))}
              max={MAX_FEATURES}
            />
          </div>
        )}

        {stepOneDone && (
          <div className="step">
            <h3><span className="step-num">4</span>Ajustes <span className="muted step-opt">(opcional: ya vienen bien puestos)</span></h3>

            {supervised && (
              <div className="settings-grid">
                <div className="field">
                  <label htmlFor="m-alg">Método</label>
                  <select id="m-alg" value={draft.algorithm} onChange={(e) => setDraft((d) => ({ ...d, algorithm: e.target.value as MlAlgorithm }))}>
                    {(draft.task === 'regression' ? (['auto', 'linear', 'tree', 'forest'] as const) : (['auto', 'tree', 'forest'] as const)).map((a) => (
                      <option key={a} value={a}>{ALGORITHM_LABELS[a]}</option>
                    ))}
                  </select>
                  <span className="muted">{ALGORITHM_HINTS[draft.algorithm]}</span>
                </div>
                <div className="field">
                  <label htmlFor="m-train">Datos para aprender</label>
                  <select id="m-train" value={draft.trainPct} onChange={(e) => setDraft((d) => ({ ...d, trainPct: Number(e.target.value) }))}>
                    {TRAIN_OPTIONS.map((n) => (<option key={n} value={n}>{n} % aprender / {100 - n} % comprobar</option>))}
                  </select>
                  <span className="muted">El resto se aparta para comprobar si acierta con datos que no ha visto.</span>
                </div>
                {draft.algorithm !== 'linear' && (
                  <div className="field">
                    <label htmlFor="m-depth">Complejidad del modelo</label>
                    <select id="m-depth" value={draft.depth} onChange={(e) => setDraft((d) => ({ ...d, depth: Number(e.target.value) }))}>
                      {DEPTH_OPTIONS.map((o) => (<option key={o.value} value={o.value}>{o.label} (profundidad {o.value})</option>))}
                    </select>
                    <span className="muted">Más detalle capta más matices, pero con pocos datos puede «memorizar».</span>
                  </div>
                )}
              </div>
            )}

            {draft.task === 'anomaly' && (
              <div className="settings-grid">
                <div className="field">
                  <label htmlFor="m-am">Cómo se detecta</label>
                  <select id="m-am" value={draft.anomalyMethod} onChange={(e) => setDraft((d) => ({ ...d, anomalyMethod: e.target.value as Draft['anomalyMethod'] }))}>
                    {ANOMALY_METHODS.map((m) => (<option key={m} value={m}>{ANOMALY_METHOD_LABELS[m]}</option>))}
                  </select>
                  <span className="muted">{ANOMALY_METHOD_HINTS[draft.anomalyMethod]}</span>
                </div>
                <div className="field">
                  <label htmlFor="m-sens">Sensibilidad</label>
                  <select id="m-sens" value={draft.sensitivity} onChange={(e) => setDraft((d) => ({ ...d, sensitivity: e.target.value as Draft['sensitivity'] }))}>
                    {SENSITIVITIES.map((s) => (<option key={s} value={s}>{SENSITIVITY_LABELS[s]}</option>))}
                  </select>
                  <span className="muted">Cuanto más alta, más valores se marcan como raros.</span>
                </div>
              </div>
            )}

            {draft.task === 'clustering' && (
              <div className="settings-grid">
                <div className="field">
                  <label htmlFor="m-k">Número de grupos</label>
                  <select id="m-k" value={draft.clusters ?? 'auto'} onChange={(e) => setDraft((d) => ({ ...d, clusters: e.target.value === 'auto' ? null : Number(e.target.value) }))}>
                    <option value="auto">Automático (recomendado)</option>
                    {CLUSTER_OPTIONS.map((k) => (<option key={k} value={k}>{k} grupos</option>))}
                  </select>
                  <span className="muted">Si no lo sabes, deja «Automático»: se prueban varios y se elige el que separa mejor.</span>
                </div>
              </div>
            )}

            <div className="field title-field">
              <label htmlFor="m-title">Título del informe</label>
              <input id="m-title" maxLength={80} value={draft.title} placeholder={autoMlTitle(draft)} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} />
            </div>
          </div>
        )}

        {stepOneDone && (
          <div className="run-row">
            <button className="btn primary big" disabled={!parsed.success || running} onClick={() => parsed.success && run(parsed.data)}>
              <IconSpark size={18} />
              {running ? 'Analizando…' : 'Analizar mis datos'}
            </button>
            {!parsed.success && <span className="muted">{parsed.error.issues[0]?.message}</span>}
            <span className="muted grow privacy-note">Tus datos se leen en el momento (de tu Drive o de tu ordenador, vía el agente) y no se guardan.</span>
          </div>
        )}
      </section>

      <div ref={resultRef} className="result-wrap">
        {running && (
          <div className="running" role="status">
            <div className="chart-skeleton"><span /></div>
            <p className="muted">Entrenando y comprobando el modelo con tus datos… puede tardar unos segundos.</p>
          </div>
        )}
        {runError && !running && <div className="notice notice-error">{runError}</div>}

        {result && resultConfig && !running && (
          <section className="panel report" aria-label="Informe">
            <div className="print-only print-head">
              <strong>Automatización con IA · Informe</strong>
              <span>{new Date().toLocaleString('es-ES')}</span>
            </div>
            <div className="report-top">
              <div className="grow">
                <h2>{reportTitle}</h2>
                <div className="chips">
                  <span className="tag tag-file">{fileName(resultConfig.fileId)}</span>
                  {resultConfig.sheet && <span className="tag tag-sheet">Hoja «{resultConfig.sheet}»</span>}
                </div>
              </div>
              <div className="report-actions no-print">
                <button className="btn primary" onClick={downloadReport}>
                  <IconDownload size={16} />
                  Descargar informe
                </button>
                <button className="btn" onClick={() => window.print()}>
                  <IconPrint size={16} />
                  Imprimir / PDF
                </button>
                {csv && (
                  <button className="btn" onClick={() => downloadText(`${slug(reportTitle)}-${csv.name}.csv`, csv.text)}>
                    <IconDownload size={16} />
                    Datos (CSV)
                  </button>
                )}
              </div>
            </div>
            <p className="muted no-print">
              Este informe se ha generado ahora mismo y solo existe en esta pantalla. Si quieres conservarlo, descárgalo: no
              guardamos ninguna copia.
            </p>
            <ResultPanel result={result} />
          </section>
        )}
      </div>

    </>
  );
}
