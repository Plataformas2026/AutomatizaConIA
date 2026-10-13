import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ParsedTable } from '@/lib/parsing/parse';
import { mulberry32 } from './util';
import { runMl } from './run';
import { mlConfigSchema, type MlConfig } from './types';

const FILE = '11111111-1111-4111-8111-111111111111';
const rnd = mulberry32(42);
const noise = (s: number) => (rnd() - 0.5) * s;

function table(headers: string[], rows: Record<string, unknown>[]): ParsedTable {
  return { headers, truncated: false, rows: rows.map((values, i) => ({ rowNumber: i + 2, values: values as never })) };
}

const cfg = (over: Record<string, unknown>): MlConfig => mlConfigSchema.parse({ fileId: FILE, ...over });

/* ventas = 3·unidades + 50·(zona Norte) + ruido; «ruido_col» no influye */
const sales = table(
  ['Unidades', 'Zona', 'Ruido', 'Ventas', 'Riesgo'],
  Array.from({ length: 300 }, (_, i) => {
    const unidades = 5 + (i % 40);
    const zona = i % 3 === 0 ? 'Norte' : 'Sur';
    const ventas = 3 * unidades + (zona === 'Norte' ? 50 : 0) + noise(4);
    return { Unidades: unidades, Zona: zona, Ruido: rnd() * 100, Ventas: ventas, Riesgo: ventas > 100 ? 'Alto' : 'Bajo' };
  }),
);

test('regresión: recupera una relación lineal y señala las variables que importan', () => {
  const r = runMl(sales, cfg({ task: 'regression', target: 'Ventas', features: ['Unidades', 'Zona', 'Ruido'], algorithm: 'linear' }));
  assert.equal(r.task, 'regression');
  if (r.task !== 'regression') return;
  assert.ok(r.metrics.r2 > 0.95, `r2=${r.metrics.r2}`);
  assert.equal(r.quality, 'good');
  assert.ok(r.metrics.rmse < r.metrics.baselineRmse / 3);
  assert.equal(r.importance[0].feature, 'Unidades');
  assert.ok(r.importance.find((i) => i.feature === 'Ruido')!.value < 5);
  assert.equal(r.trainRows + r.testRows, 300);
});

test('regresión automática: árboles y bosque también funcionan', () => {
  for (const algorithm of ['auto', 'tree', 'forest']) {
    const r = runMl(sales, cfg({ task: 'regression', target: 'Ventas', features: ['Unidades', 'Zona'], algorithm }));
    assert.ok(r.task === 'regression' && r.metrics.r2 > 0.85, `${algorithm}: ${r.task === 'regression' ? r.metrics.r2 : ''}`);
  }
});

test('clasificación: acierta y supera a responder siempre lo más habitual', () => {
  const r = runMl(sales, cfg({ task: 'classification', target: 'Riesgo', features: ['Unidades', 'Zona', 'Ruido'] }));
  assert.equal(r.task, 'classification');
  if (r.task !== 'classification') return;
  assert.ok(r.metrics.accuracy > 0.9, `acc=${r.metrics.accuracy}`);
  assert.ok(r.metrics.accuracy > r.metrics.baseline);
  assert.deepEqual([...r.classes].sort(), ['Alto', 'Bajo']);
  assert.equal(r.confusion.flat().reduce((a, b) => a + b, 0), r.testRows);
  assert.equal(r.importance[0].feature, 'Unidades');
});

test('anomalías: detecta los valores raros plantados', () => {
  const rows = Array.from({ length: 200 }, (_, i) => ({ Importe: 100 + (i % 20) + noise(3), Otro: 5 + (i % 7) }));
  (rows[10] as Record<string, number>).Importe = 5000;
  (rows[77] as Record<string, number>).Importe = -900;
  const t = table(['Importe', 'Otro'], rows);
  for (const method of ['iqr', 'zscore']) {
    const r = runMl(t, cfg({ task: 'anomaly', features: ['Importe', 'Otro'], anomalyMethod: method }));
    assert.equal(r.task, 'anomaly');
    if (r.task !== 'anomaly') return;
    // filas de hoja = índice + 2. Con Z-score, un extremo enorme infla la desviación y puede «tapar» al otro.
    const found = r.flaggedRows.slice().sort((a, b) => a - b);
    assert.deepEqual(found, method === 'iqr' ? [12, 79] : [12], method);
    assert.equal(r.items[0].row, 12);
    assert.equal(r.items[0].direction, 'alto');
  }
});

test('clustering: encuentra 3 grupos bien separados', () => {
  const centers = [[0, 0], [10, 10], [-10, 10]];
  const rows = Array.from({ length: 240 }, (_, i) => {
    const c = centers[i % 3];
    return { A: c[0] + noise(2), B: c[1] + noise(2) };
  });
  const t = table(['A', 'B'], rows);
  const auto = runMl(t, cfg({ task: 'clustering', features: ['A', 'B'] }));
  assert.ok(auto.task === 'clustering' && auto.k === 3 && auto.auto && auto.silhouette > 0.6);
  const fixed = runMl(t, cfg({ task: 'clustering', features: ['A', 'B'], clusters: 3 }));
  if (fixed.task !== 'clustering') return;
  assert.deepEqual(fixed.clusters.map((c) => c.size), [80, 80, 80]);
  assert.equal(fixed.quality, 'good');
  assert.ok(fixed.projection.length > 0 && fixed.assignments.length === 240);
});

test('clustering: un valor extremo no crea un grupo de una sola fila', () => {
  const centers = [[0, 0], [10, 10], [-10, 10]];
  const rows = Array.from({ length: 240 }, (_, i) => {
    const c = centers[i % 3];
    return { A: c[0] + noise(2), B: c[1] + noise(2) };
  });
  (rows[5] as Record<string, number>).A = 5000;
  const r = runMl(table(['A', 'B'], rows), cfg({ task: 'clustering', features: ['A', 'B'] }));
  assert.ok(r.task === 'clustering' && r.k === 3 && Math.min(...r.clusters.map((c) => c.size)) >= 70, r.task === 'clustering' ? JSON.stringify(r.clusters.map((c) => c.size)) : '');
});

test('avisa cuando una columna decide casi todo (posible fuga de la respuesta)', () => {
  const r = runMl(sales, cfg({ task: 'classification', target: 'Riesgo', features: ['Ventas', 'Ruido'] }));
  assert.ok(r.task === 'classification' && r.insights.some((i) => i.tone === 'warn' && i.text.includes('«Ventas»')));
});

test('errores claros y esquema', () => {
  assert.throws(() => runMl(sales, cfg({ task: 'regression', target: 'Zona', features: ['Unidades'] })), (e: Error) => e.message === 'target_not_numeric');
  assert.throws(() => runMl(sales, cfg({ task: 'anomaly', features: ['Zona'] })), (e: Error) => e.message === 'no_numeric_columns');
  assert.equal(mlConfigSchema.safeParse({ fileId: FILE, task: 'regression', features: ['A'] }).success, false);
  assert.equal(mlConfigSchema.safeParse({ fileId: FILE, task: 'regression', target: 'A', features: ['A'] }).success, false);
  assert.equal(mlConfigSchema.safeParse({ fileId: FILE, task: 'clustering', features: ['A'] }).success, false);
});
