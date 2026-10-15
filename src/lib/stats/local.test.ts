import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeCell, decodeTables, pickTable } from './local';
import { computeChart, inferKind, StatsError } from './compute';
import { chartConfigSchema } from './types';

// Formato exacto que entrega el agente en GET /v1/tables
const payload = {
  fileName: 'ventas.xlsx',
  truncated: false,
  sheets: [
    {
      name: 'Enero',
      headers: ['Cliente', 'Importe', 'Alta'],
      truncated: false,
      rows: [
        { n: 2, v: ['Ana', 10, { d: '2026-01-05' }] },
        { n: 3, v: ['Ana', 5.5, { d: '2026-01-20' }] },
        { n: 4, v: ['Luis', 4, { d: '2026-02-02' }] },
        { n: 5, v: ['Luis', null, null] },
      ],
    },
    { name: 'Vacía', headers: ['A'], truncated: false, rows: [] },
  ],
};

test('local: las fechas del agente se convierten en Date (UTC) y lo demás se respeta', () => {
  const d = decodeCell({ d: '2026-03-09' });
  assert.ok(d instanceof Date);
  assert.equal((d as Date).toISOString().slice(0, 10), '2026-03-09');
  assert.equal(decodeCell(null), null);
  assert.equal(decodeCell(3.5), 3.5);
  assert.equal(decodeCell('x'), 'x');
  assert.equal(decodeCell({ d: 'mal' }), null);
});

test('local: las tablas del agente se leen igual que las de Drive (tipos y gráficas)', () => {
  const sheets = decodeTables(payload);
  const t = pickTable(sheets, null);
  assert.equal(t.rows[0].rowNumber, 2);
  assert.equal(inferKind(t, 'Importe'), 'number');
  assert.equal(inferKind(t, 'Alta'), 'date');
  assert.equal(inferKind(t, 'Cliente'), 'text');

  const cfg = chartConfigSchema.parse({
    type: 'bar', title: '', fileId: '0a1b2c3d-0000-4000-8000-0123456789ab', sheet: 'Enero',
    x: 'Cliente', y: 'Importe', agg: 'sum', series: null, limit: 10, size: 'normal',
  });
  const res = computeChart(pickTable(sheets, 'Enero'), cfg);
  assert.deepEqual(JSON.parse(JSON.stringify(res)), JSON.parse(JSON.stringify(computeChart(pickTable(sheets, null), cfg))));
  assert.match(JSON.stringify(res), /Ana/);
  assert.match(JSON.stringify(res), /15\.5/);
});

test('local: hoja inexistente → sheet_not_found', () => {
  assert.throws(() => pickTable(decodeTables(payload), 'Nada'), (e) => e instanceof StatsError && e.code === 'sheet_not_found');
});

test('local: un modelo se entrena con las tablas del agente y da lo mismo que con la misma tabla leída de otro modo', async () => {
  const { runMl } = await import('@/lib/ml/run');
  const { mlConfigSchema } = await import('@/lib/ml/types');
  const rows = Array.from({ length: 80 }, (_, i) => ({ n: i + 2, v: [i % 2 ? 'A' : 'B', i * 2 + (i % 3), 10 + i] }));
  const sheets = decodeTables({
    fileName: 'm.csv', truncated: false,
    sheets: [{ name: null, headers: ['Tipo', 'Horas', 'Coste'], truncated: false, rows }],
  });
  const cfg = mlConfigSchema.parse({
    task: 'regression', fileId: '0a1b2c3d-0000-4000-8000-0123456789ab', sheet: null, title: '',
    target: 'Coste', features: ['Horas'], algorithm: 'linear', trainPct: 80, depth: 5, clusters: null, sensitivity: 'normal', anomalyMethod: 'iqr',
  });
  const a = runMl(pickTable(sheets, null), cfg);
  const b = runMl(pickTable(decodeTables(JSON.parse(JSON.stringify({ fileName: 'm.csv', truncated: false, sheets: [{ name: null, headers: ['Tipo', 'Horas', 'Coste'], truncated: false, rows }] }))), null), cfg);
  assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
  assert.equal(a.task, 'regression');
});
