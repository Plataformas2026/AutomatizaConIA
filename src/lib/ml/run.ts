import type { ParsedTable } from '@/lib/parsing/parse';
import { cellLabel, cellNumber, inferKind, StatsError } from '@/lib/stats/compute';
import { detectAnomalies } from './anomaly';
import { kmeans, pca2, silhouette, standardize } from './cluster';
import { fitLinear } from './linear';
import { buildDesign, type Design } from './prepare';
import { forestModel, treeModel, type Predictor, type TreeOpts } from './tree';
import {
  ALGORITHM_LABELS,
  MIN_ROWS,
  type ClassificationResult,
  type ClusteringResult,
  type ClusterInfo,
  type Importance,
  type Insight,
  type MlAlgorithm,
  type MlConfig,
  type MlResult,
  type Quality,
  type RegressionResult,
} from './types';
import { mean, mulberry32, round, sampleIndices, shuffled, type Rng } from './util';

/**
 * Entrena y evalúa EN MEMORIA con la tabla leída al vuelo de Drive.
 * Todo es determinista (semilla fija): los mismos datos dan el mismo informe.
 */

const MAX_SUPERVISED = 4000;
const MAX_CLUSTER = 8000;
const MAX_POINTS = 300;
const SEED = 20260101;

const pct = (n: number, d = 1) => String(round(n * 100, d)).replace('.', ',');
const num = (n: number) => String(round(n, Math.abs(n) >= 100 ? 0 : 2)).replace('.', ',');
const filas = (n: number) => `${n} ${n === 1 ? 'fila' : 'filas'}`;

/** Si una sola columna lo decide casi todo, avisa: puede que ya contenga la respuesta. */
function leakageWarning(importance: Importance[], good: boolean): Insight | null {
  const top = importance[0];
  if (good && top && top.value >= 85) {
    return {
      tone: 'warn',
      text: `Ojo: «${top.feature}» decide casi todo el resultado (${num(top.value)} %). Si esa columna ya contiene la respuesta (un total, una etiqueta derivada…), el modelo parece mejor de lo que es: prueba a quitarla.`,
    };
  }
  return null;
}

/* ── Importancia de variables (por permutación) ───────────────────────── */

function permutationImportance(
  design: Design,
  Xtest: number[][],
  score: (X: number[][]) => number, // mayor = mejor
  rnd: Rng,
): Importance[] {
  const base = score(Xtest);
  const raw = design.sources.map((src) => {
    let drop = 0;
    const reps = 3;
    for (let r = 0; r < reps; r++) {
      const order = shuffled(Xtest.map((_, i) => i), rnd);
      const Xp = Xtest.map((row, i) => {
        const copy = row.slice();
        for (const c of src.cols) copy[c] = Xtest[order[i]][c];
        return copy;
      });
      drop += base - score(Xp);
    }
    return Math.max(0, drop / reps);
  });
  const total = raw.reduce((a, b) => a + b, 0);
  return design.sources
    .map((src, i) => ({ feature: src.column, value: total > 0 ? round((raw[i] / total) * 100, 1) : 0 }))
    .sort((a, b) => b.value - a.value);
}

/* ── Preparación común de modelos supervisados ────────────────────────── */

function treeOpts(task: 'reg' | 'cls', nClasses: number, depth: number, rnd: Rng): TreeOpts {
  return { task, nClasses, maxDepth: depth, minLeaf: 3, mtry: null, rnd };
}

function split(n: number, trainPct: number, rnd: Rng) {
  const order = shuffled(Array.from({ length: n }, (_, i) => i), rnd);
  const nTrain = Math.min(n - 5, Math.max(10, Math.round((n * trainPct) / 100)));
  return { train: order.slice(0, nTrain), test: order.slice(nTrain) };
}

const pick = <T,>(arr: T[], idx: number[]) => idx.map((i) => arr[i]);

const rmse = (a: number[], b: number[]) => Math.sqrt(mean(a.map((v, i) => (v - b[i]) ** 2)));

function qualityReg(r2: number): Quality {
  return r2 >= 0.7 ? 'good' : r2 >= 0.4 ? 'ok' : 'weak';
}

/* ── Regresión ────────────────────────────────────────────────────────── */

function runRegression(table: ParsedTable, c: MlConfig): RegressionResult {
  const notes: string[] = [];
  const target = c.target as string;
  if (!table.headers.includes(target)) throw new StatsError('column_not_found', 404);

  const valid: number[] = [];
  const yAll: number[] = [];
  table.rows.forEach((r, i) => {
    const v = cellNumber(r.values[target]);
    if (v !== null) { valid.push(i); yAll.push(v); }
  });
  if (valid.length < table.rows.length * 0.5 || !valid.length) throw new StatsError('target_not_numeric', 422);
  if (valid.length < table.rows.length) notes.push(`Se han dejado fuera ${table.rows.length - valid.length} filas sin valor en «${target}».`);

  const rnd = mulberry32(SEED);
  const keep = sampleIndices(valid.length, MAX_SUPERVISED, rnd);
  if (keep.length < valid.length) notes.push(`Para ir rápido se ha entrenado con una muestra de ${keep.length} filas.`);
  const rowIdx = keep.map((k) => valid[k]);
  const y = keep.map((k) => yAll[k]);
  if (rowIdx.length < MIN_ROWS) throw new StatsError('too_few_rows', 422);

  const design = buildDesign(table, c.features.filter((f) => f !== target), rowIdx, notes);
  const { train, test } = split(rowIdx.length, c.trainPct, rnd);
  const Xtr = pick(design.X, train), ytr = pick(y, train);
  const Xte = pick(design.X, test), yte = pick(y, test);

  const fit = (alg: Exclude<MlAlgorithm, 'auto'>, X: number[][], yy: number[]): Predictor =>
    alg === 'linear'
      ? fitLinear(X, yy, design.isDummy)
      : alg === 'tree'
        ? treeModel(X, yy, treeOpts('reg', 0, c.depth, mulberry32(SEED + 1)))
        : forestModel(X, yy, treeOpts('reg', 0, c.depth, mulberry32(SEED + 2)));

  let algorithm: Exclude<MlAlgorithm, 'auto'>;
  if (c.algorithm === 'auto') {
    // Se elige con una parte del entrenamiento; el test queda intacto para medir de verdad.
    const cut = Math.max(10, Math.floor(Xtr.length * 0.8));
    const cands: Exclude<MlAlgorithm, 'auto'>[] = ['linear', 'tree', 'forest'];
    let bestErr = Infinity;
    algorithm = 'linear';
    for (const alg of cands) {
      const err = rmse(ytr.slice(cut), fit(alg, Xtr.slice(0, cut), ytr.slice(0, cut)).predict(Xtr.slice(cut)));
      if (err < bestErr) { bestErr = err; algorithm = alg; }
    }
  } else {
    algorithm = c.algorithm;
  }
  const model = fit(algorithm, Xtr, ytr);
  const pred = model.predict(Xte);

  const err = rmse(yte, pred);
  const mae = mean(yte.map((v, i) => Math.abs(v - pred[i])));
  const trainMean = mean(ytr);
  const baselineRmse = rmse(yte, yte.map(() => trainMean));
  const yMean = mean(yte);
  const sst = yte.reduce((s, v) => s + (v - yMean) ** 2, 0);
  const sse = yte.reduce((s, v, i) => s + (v - pred[i]) ** 2, 0);
  const r2 = sst > 0 ? 1 - sse / sst : 0;

  const importance = permutationImportance(design, Xte, (X) => -rmse(yte, model.predict(X)), mulberry32(SEED + 3));
  const step = Math.max(1, Math.ceil(test.length / MAX_POINTS));
  const points = test.map((_, i) => ({ actual: round(yte[i], 3), predicted: round(pred[i], 3) })).filter((_, i) => i % step === 0);

  const quality = qualityReg(r2);
  const label = c.algorithm === 'auto' ? `${ALGORITHM_LABELS[algorithm]} (elegido automáticamente)` : ALGORITHM_LABELS[algorithm];
  const result: RegressionResult = {
    task: 'regression',
    algorithm,
    algorithmLabel: label,
    target,
    trainRows: train.length,
    testRows: test.length,
    metrics: { rmse: round(err, 3), mae: round(mae, 3), r2: round(r2, 3), baselineRmse: round(baselineRmse, 3), targetMean: round(yMean, 3) },
    quality,
    importance,
    points,
    rowsTotal: table.rows.length,
    rowsUsed: rowIdx.length,
    features: design.sources.map((s) => s.column),
    notes,
    insights: [],
  };
  result.insights = regressionInsights(result);
  return result;
}

function regressionInsights(r: RegressionResult): Insight[] {
  const out: Insight[] = [];
  const { rmse: e, mae, r2, baselineRmse, targetMean } = r.metrics;
  const rel = Math.abs(targetMean) > 0 ? ` (un ${pct(mae / Math.abs(targetMean), 0)} % del valor medio)` : '';
  out.push({
    tone: r.quality === 'weak' ? 'warn' : 'good',
    text: `Al predecir «${r.target}», el modelo se equivoca de media en ${num(mae)}${rel}. Un fallo típico ronda ${num(e)}.`,
  });
  if (baselineRmse > 0 && e < baselineRmse) {
    out.push({ tone: 'info', text: `Es un ${pct(1 - e / baselineRmse, 0)} % mejor que dar siempre la media como respuesta.` });
  }
  const top = r.importance.filter((i) => i.value > 0).slice(0, 3);
  if (top.length) out.push({ tone: 'info', text: `Lo que más influye: ${top.map((t) => `«${t.feature}» (${pct(t.value / 100, 0)} %)`).join(', ')}.` });
  if (r.quality === 'weak') {
    out.push({ tone: 'warn', text: r2 <= 0 ? 'Con estas columnas el modelo no mejora a la media: probablemente no hay relación clara. Prueba a añadir otras columnas.' : 'El modelo acierta poco todavía. Añade más columnas relevantes o más filas para mejorarlo.' });
  } else if (r.quality === 'ok') {
    out.push({ tone: 'info', text: 'Sirve como orientación, pero no te fíes de una predicción concreta. Más columnas relevantes lo mejorarían.' });
  } else {
    out.push({ tone: 'good', text: `Explica el ${pct(r2, 0)} % de las variaciones de «${r.target}»: es un modelo fiable para estimar.` });
  }
  const leak = leakageWarning(r.importance, r.quality === 'good');
  if (leak) out.push(leak);
  if (r.trainRows < 100) out.push({ tone: 'warn', text: `Solo hay ${r.trainRows} filas para aprender: con tan pocos datos el resultado puede cambiar mucho.` });
  return out;
}

/* ── Clasificación ────────────────────────────────────────────────────── */

function runClassification(table: ParsedTable, c: MlConfig): ClassificationResult {
  const notes: string[] = [];
  const target = c.target as string;
  if (!table.headers.includes(target)) throw new StatsError('column_not_found', 404);

  const labelsAll: string[] = [];
  const valid: number[] = [];
  table.rows.forEach((r, i) => {
    const raw = r.values[target];
    if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) return;
    valid.push(i);
    labelsAll.push(cellLabel(raw));
  });
  if (valid.length < MIN_ROWS) throw new StatsError('too_few_rows', 422);
  if (valid.length < table.rows.length) notes.push(`Se han dejado fuera ${table.rows.length - valid.length} filas sin valor en «${target}».`);

  const counts = new Map<string, number>();
  for (const l of labelsAll) counts.set(l, (counts.get(l) ?? 0) + 1);
  if (counts.size < 2) throw new StatsError('single_class', 422);
  if (counts.size > 50 && inferKind(table, target) === 'number') throw new StatsError('target_too_many_classes', 422);
  if (counts.size > 50) throw new StatsError('target_too_many_classes', 422);

  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([l]) => l);
  const MAXC = 8;
  const classes = ranked.length > MAXC ? [...ranked.slice(0, MAXC - 1), 'Otros'] : ranked;
  if (ranked.length > MAXC) notes.push(`Las categorías menos frecuentes de «${target}» se han agrupado como «Otros».`);
  const classOf = (l: string) => { const i = classes.indexOf(l); return i >= 0 ? i : classes.length - 1; };
  const yAll = labelsAll.map(classOf);

  const rnd = mulberry32(SEED);
  const keep = sampleIndices(valid.length, MAX_SUPERVISED, rnd);
  if (keep.length < valid.length) notes.push(`Para ir rápido se ha entrenado con una muestra de ${keep.length} filas.`);
  const rowIdx = keep.map((k) => valid[k]);
  const y = keep.map((k) => yAll[k]);

  const design = buildDesign(table, c.features.filter((f) => f !== target), rowIdx, notes);
  const { train, test } = split(rowIdx.length, c.trainPct, rnd);
  const Xtr = pick(design.X, train), ytr = pick(y, train);
  const Xte = pick(design.X, test), yte = pick(y, test);
  const K = classes.length;

  const fit = (alg: 'tree' | 'forest', X: number[][], yy: number[]): Predictor =>
    alg === 'tree'
      ? treeModel(X, yy, treeOpts('cls', K, c.depth, mulberry32(SEED + 1)))
      : forestModel(X, yy, treeOpts('cls', K, c.depth, mulberry32(SEED + 2)));
  const acc = (a: number[], b: number[]) => (a.length ? a.filter((v, i) => v === b[i]).length / a.length : 0);

  let algorithm: 'tree' | 'forest';
  if (c.algorithm === 'auto' || c.algorithm === 'linear') {
    const cut = Math.max(10, Math.floor(Xtr.length * 0.8));
    algorithm = acc(ytr.slice(cut), fit('forest', Xtr.slice(0, cut), ytr.slice(0, cut)).predict(Xtr.slice(cut))) >=
      acc(ytr.slice(cut), fit('tree', Xtr.slice(0, cut), ytr.slice(0, cut)).predict(Xtr.slice(cut)))
      ? 'forest'
      : 'tree';
  } else {
    algorithm = c.algorithm;
  }
  const model = fit(algorithm, Xtr, ytr);
  const pred = model.predict(Xte);

  const accuracy = acc(yte, pred);
  const trainCounts = new Array<number>(K).fill(0);
  ytr.forEach((v) => { trainCounts[v]++; });
  const majority = trainCounts.indexOf(Math.max(...trainCounts));
  const baseline = acc(yte, yte.map(() => majority));

  const confusion = Array.from({ length: K }, () => new Array<number>(K).fill(0));
  yte.forEach((real, i) => { confusion[real][pred[i]]++; });
  const perClass = classes.map((label, k) => {
    const tp = confusion[k][k];
    const predicted = confusion.reduce((s, row) => s + row[k], 0);
    const support = confusion[k].reduce((a, b) => a + b, 0);
    return { label, precision: predicted ? round(tp / predicted, 3) : 0, recall: support ? round(tp / support, 3) : 0, support };
  });

  const importance = permutationImportance(design, Xte, (X) => acc(yte, model.predict(X)), mulberry32(SEED + 3));
  const gain = accuracy - baseline;
  const quality: Quality = accuracy >= 0.8 && gain >= 0.15 ? 'good' : gain >= 0.07 ? 'ok' : 'weak';
  const result: ClassificationResult = {
    task: 'classification',
    algorithm,
    algorithmLabel: c.algorithm === 'auto' || c.algorithm === 'linear' ? `${ALGORITHM_LABELS[algorithm]} (elegido automáticamente)` : ALGORITHM_LABELS[algorithm],
    target,
    trainRows: train.length,
    testRows: test.length,
    metrics: { accuracy: round(accuracy, 3), baseline: round(baseline, 3) },
    quality,
    classes,
    confusion,
    perClass,
    importance,
    rowsTotal: table.rows.length,
    rowsUsed: rowIdx.length,
    features: design.sources.map((s) => s.column),
    notes,
    insights: [],
  };
  if (c.algorithm === 'linear') notes.push('La regresión lineal no sirve para categorías: se ha usado un método de árboles.');
  result.insights = classificationInsights(result);
  return result;
}

function classificationInsights(r: ClassificationResult): Insight[] {
  const out: Insight[] = [];
  const { accuracy, baseline } = r.metrics;
  out.push({
    tone: r.quality === 'weak' ? 'warn' : 'good',
    text: `Acierta la categoría de «${r.target}» en ${pct(accuracy, 0)} de cada 100 filas que no había visto antes.`,
  });
  out.push({
    tone: 'info',
    text: `Sin modelo, responder siempre «${r.classes[r.perClass.reduce((b, p, i, a) => (p.support > a[b].support ? i : b), 0)]}» acertaría ${pct(baseline, 0)} de cada 100: el modelo aporta ${pct(Math.max(0, accuracy - baseline), 0)} puntos más.`,
  });
  const top = r.importance.filter((i) => i.value > 0).slice(0, 3);
  if (top.length) out.push({ tone: 'info', text: `Lo que más influye: ${top.map((t) => `«${t.feature}» (${pct(t.value / 100, 0)} %)`).join(', ')}.` });
  const worst = [...r.perClass].filter((p) => p.support >= 3).sort((a, b) => a.recall - b.recall)[0];
  if (worst && worst.recall < 0.5) out.push({ tone: 'warn', text: `Le cuesta reconocer «${worst.label}»: solo detecta ${pct(worst.recall, 0)} de cada 100 casos reales.` });
  const leak = leakageWarning(r.importance, r.metrics.accuracy >= 0.95);
  if (leak) out.push(leak);
  if (r.quality === 'weak') out.push({ tone: 'warn', text: 'Apenas mejora a responder siempre lo más habitual. Prueba con otras columnas más relacionadas con lo que quieres clasificar.' });
  if (r.trainRows < 100) out.push({ tone: 'warn', text: `Solo hay ${r.trainRows} filas para aprender: con tan pocos datos el resultado puede cambiar mucho.` });
  return out;
}

/* ── Agrupamiento ─────────────────────────────────────────────────────── */

function runClustering(table: ParsedTable, c: MlConfig): ClusteringResult {
  const notes: string[] = [];
  const rnd = mulberry32(SEED);
  const keep = sampleIndices(table.rows.length, MAX_CLUSTER, rnd);
  if (keep.length < table.rows.length) notes.push(`Para ir rápido se han agrupado ${keep.length} filas elegidas al azar.`);
  if (keep.length < MIN_ROWS) throw new StatsError('too_few_rows', 422);

  const design = buildDesign(table, c.features, keep, notes);
  const std = standardize(design.X, design.isDummy);
  // Los valores extremos se «recortan» para que un solo dato raro no deforme los grupos.
  let clipped = 0;
  const Z = std.Z.map((row) => row.map((v) => { const c = Math.max(-3.5, Math.min(3.5, v)); if (c !== v) clipped++; return c; }));
  if (clipped > 0) notes.push('Los valores extremos se han suavizado para que no deformen los grupos (los verás aparte en «Valores raros»).');
  const n = Z.length;
  const sil = sampleIndices(n, 600, mulberry32(SEED + 5));

  let k = c.clusters ?? 0;
  const kScores: { k: number; silhouette: number }[] = [];
  let fit = null as ReturnType<typeof kmeans> | null;
  if (c.clusters === null) {
    let best = -2;
    let fallback: { k: number; fit: ReturnType<typeof kmeans>; s: number } | null = null;
    for (let kk = 2; kk <= Math.min(8, Math.floor(n / 10)); kk++) {
      const f = kmeans(Z, kk, mulberry32(SEED + kk), 3);
      const s = silhouette(Z, f.labels, kk, sil);
      kScores.push({ k: kk, silhouette: round(s, 3) });
      if (!fallback || s > fallback.s) fallback = { k: kk, fit: f, s };
      // Se descartan las opciones con un grupo diminuto (suelen ser un solo dato raro).
      const sizes = new Array<number>(kk).fill(0);
      f.labels.forEach((l) => { sizes[l]++; });
      if (Math.min(...sizes) < Math.max(3, n * 0.015)) continue;
      if (s > best) { best = s; k = kk; fit = f; }
    }
    if (!fit && fallback) { k = fallback.k; fit = fallback.fit; }
  } else {
    fit = kmeans(Z, k, mulberry32(SEED + k), 4);
  }
  if (!fit || !k) throw new StatsError('too_few_rows', 422);
  const silhouetteScore = silhouette(Z, fit.labels, k, sil);

  // Orden: grupo 1 = el más grande.
  const sizes = new Array<number>(k).fill(0);
  fit.labels.forEach((l) => { sizes[l]++; });
  const order = sizes.map((s, i) => [s, i]).sort((a, b) => b[0] - a[0]).map(([, i]) => i);
  const rename = new Map(order.map((old, idx) => [old, idx]));
  const labels = fit.labels.map((l) => rename.get(l) as number);

  const clusters: ClusterInfo[] = Array.from({ length: k }, (_, id) => {
    const members = labels.map((l, i) => (l === id ? i : -1)).filter((i) => i >= 0);
    const traits: ClusterInfo['traits'] = [];
    const scored: { z: number; t: ClusterInfo['traits'][number] }[] = [];
    for (const src of design.sources) {
      for (const col of src.cols) {
        const overall = mean(design.X.map((r) => r[col]));
        const inCluster = mean(members.map((i) => design.X[i][col]));
        if (design.isDummy[col]) {
          const p = overall;
          if (p <= 0 || p >= 1) continue;
          const z = (inCluster - p) / Math.sqrt(p * (1 - p));
          if (Math.abs(z) < 0.6) continue;
          const cat = design.names[col].slice(src.column.length + 3);
          scored.push({
            z,
            t: {
              feature: src.column,
              mean: null,
              overall: null,
              level: z > 0 ? 'alto' : 'bajo',
              text: z > 0 ? `${src.column} suele ser «${cat}» (${pct(inCluster, 0)} % frente a ${pct(p, 0)} % en total)` : `casi nunca ${src.column} = «${cat}»`,
            },
          });
        } else {
          const sd = Math.sqrt(mean(design.X.map((r) => (r[col] - overall) ** 2))) || 1;
          const z = (inCluster - overall) / sd;
          if (Math.abs(z) < 0.5) continue;
          scored.push({
            z,
            t: {
              feature: src.column,
              mean: round(inCluster, 2),
              overall: round(overall, 2),
              level: z > 0 ? 'alto' : 'bajo',
              text: `${src.column} ${z > 0 ? 'alto' : 'bajo'}: ${num(inCluster)} de media (en total, ${num(overall)})`,
            },
          });
        }
      }
    }
    scored.sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
    traits.push(...scored.slice(0, 4).map((s) => s.t));
    const brief = scored.slice(0, 2).map((s) => (s.t.mean !== null ? `${s.t.feature} ${s.t.level}` : s.t.level === 'alto' ? `${s.t.feature}: ${s.t.text.match(/«(.+?)»/)?.[1] ?? ''}` : '')).filter(Boolean);
    return {
      id,
      size: members.length,
      pct: round((members.length / n) * 100, 1),
      name: `Grupo ${id + 1}`,
      description: brief.length ? `Se distingue por: ${brief.join(' y ')}.` : 'Se parece mucho al conjunto: no tiene rasgos diferenciales claros.',
      traits,
    };
  });

  const { coords, explained } = pca2(Z);
  const projIdx = sampleIndices(n, 500, mulberry32(SEED + 6));
  const projection = projIdx.map((i) => ({ x: round(coords[i][0], 3), y: round(coords[i][1], 3), cluster: labels[i] }));
  const quality: Quality = silhouetteScore >= 0.5 ? 'good' : silhouetteScore >= 0.25 ? 'ok' : 'weak';

  const result: ClusteringResult = {
    task: 'clustering',
    k,
    auto: c.clusters === null,
    silhouette: round(silhouetteScore, 3),
    quality,
    clusters,
    projection,
    explained: round(explained, 3),
    assignments: design.rows.map((row, i) => ({ row, cluster: labels[i] })),
    kScores,
    rowsTotal: table.rows.length,
    rowsUsed: n,
    features: design.sources.map((s) => s.column),
    notes,
    insights: [],
  };
  result.insights = clusteringInsights(result);
  return result;
}

function clusteringInsights(r: ClusteringResult): Insight[] {
  const out: Insight[] = [];
  out.push({ tone: 'info', text: `Se han encontrado ${r.k} grupos${r.auto ? ' (el número se ha elegido automáticamente)' : ''}. El mayor reúne al ${String(r.clusters[0].pct).replace('.', ',')} % de las filas.` });
  if (r.quality === 'good') out.push({ tone: 'good', text: 'Los grupos están bien diferenciados entre sí: la separación es clara.' });
  else if (r.quality === 'ok') out.push({ tone: 'info', text: 'Los grupos se distinguen, aunque se solapan un poco. Úsalos como orientación.' });
  else out.push({ tone: 'warn', text: 'Los grupos se solapan mucho: los datos no forman bloques claros. Prueba con otras columnas o con otro número de grupos.' });
  const small = r.clusters.filter((c) => c.pct < 5);
  if (small.length) out.push({ tone: 'info', text: `${small.map((s) => s.name).join(' y ')} ${small.length > 1 ? 'son muy pequeños' : 'es muy pequeño'}: podría tratarse de casos poco habituales.` });
  return out;
}

/* ── Punto de entrada ─────────────────────────────────────────────────── */

export function runMl(table: ParsedTable, config: MlConfig): MlResult {
  if (table.rows.length < MIN_ROWS && config.task !== 'anomaly') throw new StatsError('too_few_rows', 422);
  switch (config.task) {
    case 'regression':
      return runRegression(table, config);
    case 'classification':
      return runClassification(table, config);
    case 'clustering':
      return runClustering(table, config);
    case 'anomaly':
      return detectAnomalies(table, config.features, config.anomalyMethod, config.sensitivity, [], (col) => {
        const kind = inferKind(table, col);
        return kind === 'number';
      });
  }
}

/** Quita de un resultado todo lo que sean valores o puntos de tus datos: es lo único que se guarda. */
export function toSavedSummary(r: MlResult): MlResult {
  switch (r.task) {
    case 'regression':
      return { ...r, points: [] };
    case 'classification':
      return r;
    case 'anomaly':
      return {
        ...r,
        items: r.items.slice(0, 100).map((i) => ({ ...i, value: null })),
        flaggedRows: r.flaggedRows.slice(0, 200),
        series: [],
      };
    case 'clustering':
      return { ...r, projection: [], assignments: [] };
  }
}
