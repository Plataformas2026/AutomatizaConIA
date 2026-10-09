import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ParsedTable } from '@/lib/parsing/parse';
import { cellNumber, computeChart, inferKind, StatsError } from './compute';
import { chartConfigSchema, type ChartConfig } from './types';

const FILE = '11111111-1111-4111-8111-111111111111';

const table: ParsedTable = {
  headers: ['Zona', 'Canal', 'Importe', 'Unidades', 'Fecha'],
  truncated: false,
  rows: [
    ['Norte', 'Web', '1.200,50', 3, new Date('2026-01-05')],
    ['Norte', 'Tienda', '300,00', 1, new Date('2026-02-05')],
    ['Sur', 'Web', 800, 2, new Date('2026-01-20')],
    ['Sur', 'Web', 200, 5, new Date('2026-03-01')],
    ['Este', 'Tienda', null, 4, new Date('2026-02-11')],
  ].map(([zona, canal, importe, uds, fecha], i) => ({
    rowNumber: i + 2,
    values: { Zona: zona, Canal: canal, Importe: importe, Unidades: uds, Fecha: fecha } as never,
  })),
};

const cfg = (over: Partial<ChartConfig>): ChartConfig =>
  chartConfigSchema.parse({ type: 'bar', fileId: FILE, x: 'Zona', y: 'Importe', agg: 'sum', ...over });

test('cellNumber entiende formato español e inglés', () => {
  assert.equal(cellNumber('1.234,56 €'), 1234.56);
  assert.equal(cellNumber('1,234.56'), 1234.56);
  assert.equal(cellNumber('12,5'), 12.5);
  assert.equal(cellNumber('1.234.567'), 1234567);
  assert.equal(cellNumber('hola'), null);
  assert.equal(cellNumber(''), null);
});

test('inferKind distingue número, fecha y texto', () => {
  assert.equal(inferKind(table, 'Importe'), 'number');
  assert.equal(inferKind(table, 'Fecha'), 'date');
  assert.equal(inferKind(table, 'Zona'), 'text');
});

test('barras: suma por zona, ordenada de mayor a menor', () => {
  const r = computeChart(table, cfg({}));
  assert.equal(r.kind, 'series');
  if (r.kind !== 'series') return;
  assert.deepEqual(r.data, [
    { label: 'Norte', value: 1500.5 },
    { label: 'Sur', value: 1000 },
  ]); // «Este» no tiene importe y se omite
});

test('contar filas no necesita columna Y', () => {
  const r = computeChart(table, cfg({ agg: 'count', y: null }));
  assert.equal(r.kind === 'series' && r.data.find((d) => d.label === 'Sur')?.value, 2);
});

test('líneas: las fechas se ordenan de forma natural', () => {
  const r = computeChart(table, cfg({ type: 'line', x: 'Fecha', y: 'Unidades', agg: 'sum' }));
  assert.equal(r.kind === 'series' && r.data.map((d) => d.label).join(), '2026-01-05,2026-01-20,2026-02-05,2026-02-11,2026-03-01');
});

test('apiladas: una clave por cada valor de «dividir por»', () => {
  const r = computeChart(table, cfg({ type: 'stacked_bar', series: 'Canal', agg: 'count', y: null }));
  assert.equal(r.kind, 'multi');
  if (r.kind !== 'multi') return;
  assert.deepEqual([...r.keys].sort(), ['Tienda', 'Web']);
  assert.equal(r.data.find((d) => d.label === 'Sur')?.Web, 2);
});

test('KPI, dispersión y límite con «Otros»', () => {
  const k = computeChart(table, cfg({ type: 'kpi', x: null, agg: 'avg', y: 'Unidades' }));
  assert.deepEqual(k, { kind: 'kpi', value: 3 });

  const s = computeChart(table, cfg({ type: 'scatter', x: 'Unidades', y: 'Importe', agg: 'count' }));
  assert.equal(s.kind === 'points' && s.data.length, 4);

  const p = computeChart(table, cfg({ type: 'pie', x: 'Fecha', y: 'Unidades', limit: 3 }));
  assert.equal(p.kind === 'series' && p.data.at(-1)?.label, 'Otros');
});

test('errores claros: columna inexistente o no numérica', () => {
  assert.throws(() => computeChart(table, cfg({ x: 'Nope' })), (e) => e instanceof StatsError && e.code === 'column_not_found');
  assert.throws(() => computeChart(table, cfg({ y: 'Zona' })), (e) => e instanceof StatsError && e.code === 'y_not_numeric');
});

test('el esquema exige lo necesario según el tipo', () => {
  assert.equal(chartConfigSchema.safeParse({ type: 'bar', fileId: FILE, agg: 'sum', x: 'A' }).success, false);
  assert.equal(chartConfigSchema.safeParse({ type: 'stacked_bar', fileId: FILE, agg: 'avg', x: 'A', y: 'B', series: 'C' }).success, false);
  assert.equal(chartConfigSchema.safeParse({ type: 'kpi', fileId: FILE, agg: 'count' }).success, true);
});
