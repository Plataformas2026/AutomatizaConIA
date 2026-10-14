import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compare, evaluateRule, toNumber, toDate } from './engine';
import type { Condition } from './types';

test('toNumber: formatos es-ES y en-US', () => {
  assert.equal(toNumber('1.234,56'), 1234.56);
  assert.equal(toNumber('1,234.56'), 1234.56);
  assert.equal(toNumber('12,5'), 12.5);
  assert.equal(toNumber('1.234.567'), 1234567);
  assert.equal(toNumber('15 %'), 15);
  assert.equal(toNumber('abc'), null);
  assert.equal(toNumber(''), null);
});

test('toDate: ISO y dd/mm/aaaa dan el mismo día', () => {
  assert.equal(toDate('2026-10-09'), toDate('09/10/2026'));
  assert.equal(toDate('hola'), null);
});

test('compare: numérico, fecha y texto', () => {
  assert.equal(compare('5', 'lt', '10'), true); // numérico, no lexicográfico
  assert.equal(compare('2026-01-01', 'lt', '2026-02-01'), true);
  assert.equal(compare('Pedro', 'eq', ' pedro '), true);
  assert.equal(compare('abc', 'gt', 'abb'), false); // no comparables → no dispara
  assert.equal(compare(null, 'is_empty', undefined), true);
  assert.equal(compare('Hola mundo', 'contains', 'MUN'), true);
});

const table = {
  headers: ['Producto', 'Stock', 'Mínimo'],
  rows: [
    { rowNumber: 2, values: { Producto: 'A', Stock: 3, Mínimo: 10 } },
    { rowNumber: 3, values: { Producto: 'B', Stock: 50, Mínimo: 10 } },
    { rowNumber: 4, values: { Producto: 'C', Stock: '7', Mínimo: '10' } },
  ],
};

test('evaluateRule: columna vs columna', () => {
  const condition: Condition = {
    kind: 'compare',
    left: { type: 'column', column: 'Stock' },
    operator: 'lt',
    right: { type: 'column', column: 'Mínimo' },
  };
  const r = evaluateRule({ id: 'r1', condition }, table);
  assert.deepEqual(r.matchedRows, [2, 4]);
  assert.equal(r.matchedCount, 2);
});

test('evaluateRule: columna vs valor fijo', () => {
  const condition: Condition = {
    kind: 'compare',
    left: { type: 'column', column: 'Stock' },
    operator: 'gt',
    right: { type: 'value', value: '20' },
  };
  assert.deepEqual(evaluateRule({ id: 'r2', condition }, table).matchedRows, [3]);
});

test('evaluateRule: columna inexistente devuelve error, no excepción', () => {
  const condition: Condition = {
    kind: 'compare',
    left: { type: 'column', column: 'Precio' },
    operator: 'gt',
    right: { type: 'value', value: 1 },
  };
  const r = evaluateRule({ id: 'r3', condition }, table);
  assert.match(r.error ?? '', /Precio/);
  assert.equal(r.matchedCount, 0);
});

/* ── Varias hojas ─────────────────────────────────────────── */
import { evaluateRuleAcrossSheets } from './engine';

const sheetA = {
  sheetName: 'Enero',
  table: { headers: ['Producto', 'Stock'], truncated: false, rows: [
    { rowNumber: 2, values: { Producto: 'A', Stock: 1 } },
    { rowNumber: 3, values: { Producto: 'B', Stock: 99 } },
  ] },
};
const sheetB = {
  sheetName: 'Febrero',
  table: { headers: ['Producto', 'Stock'], truncated: false, rows: [
    { rowNumber: 2, values: { Producto: 'C', Stock: 2 } },
    { rowNumber: 3, values: { Producto: 'D', Stock: 3 } },
  ] },
};
const sheetNoCol = { sheetName: 'Notas', table: { headers: ['Texto'], truncated: false, rows: [] } };

const lowStock: Condition = {
  kind: 'compare',
  left: { type: 'column', column: 'Stock' },
  operator: 'lt',
  right: { type: 'value', value: '10' },
};

test('evaluateRuleAcrossSheets: resultado por hoja y se omite la hoja sin la columna', () => {
  const r = evaluateRuleAcrossSheets({ id: 'm1', condition: lowStock }, [sheetA, sheetB, sheetNoCol]);
  assert.equal(r.error, undefined);
  assert.deepEqual(r.sheets.map((s) => [s.sheetName, s.matchedRows]), [
    ['Enero', [2]],
    ['Febrero', [2, 3]],
  ]);
});

test('evaluateRuleAcrossSheets: error solo si ninguna hoja tiene las columnas', () => {
  const r = evaluateRuleAcrossSheets({ id: 'm2', condition: lowStock }, [sheetNoCol, { ...sheetNoCol, sheetName: 'Otra' }]);
  assert.match(r.error ?? '', /ninguna de las hojas/);
  const none = evaluateRuleAcrossSheets({ id: 'm3', condition: lowStock }, []);
  assert.match(none.error ?? '', /No hay hojas/);
});

/* ── Operadores de fecha (casos compartidos con el agente de Python) ── */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { addUnits, countUnreadableDates, looksLikeDates, todayDay, toDateLoose } from './engine';
import { conditionSchema } from './types';

const DATE_CASES = JSON.parse(readFileSync(join(__dirname, '../../../agent/tests/date_cases.json'), 'utf8')) as {
  today: string;
  cases: { left: unknown; op: 'elapsed' | 'on_date'; right: unknown; unit: 'days' | 'weeks' | 'months' | 'years'; expected: boolean }[];
};
const TODAY = Math.floor(Date.parse(`${DATE_CASES.today}T00:00:00Z`) / 86_400_000);

test('operadores de fecha: mismos resultados que el agente', () => {
  for (const c of DATE_CASES.cases) {
    assert.equal(compare(c.left, c.op, c.right, { today: TODAY, unit: c.unit }), c.expected, JSON.stringify(c));
  }
});

test('addUnits respeta el calendario', () => {
  const day = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86_400_000);
  assert.equal(addUnits(day('2026-01-31'), 1, 'months'), day('2026-02-28'));
  assert.equal(addUnits(day('2024-02-29'), 1, 'years'), day('2025-02-28'));
  assert.equal(addUnits(day('2026-11-30'), 3, 'months'), day('2027-02-28'));
  assert.equal(addUnits(day('2026-10-14'), 2, 'weeks'), day('2026-10-28'));
});

test('todayDay usa la zona horaria indicada', () => {
  const late = new Date('2026-10-14T22:30:00Z'); // ya es 15 en Madrid (UTC+2) y aún 14 en Canarias (UTC+1)
  assert.equal(todayDay('Europe/Madrid', late) - todayDay('Atlantic/Canary', late), 1);
});

test('looksLikeDates detecta columnas de fecha', () => {
  assert.equal(looksLikeDates(['2026-01-01', '15/02/2026', null, new Date('2026-03-01')]), true);
  assert.equal(looksLikeDates(['Ana', 'Luis', '2026-01-01']), false);
  assert.equal(looksLikeDates([1, 2, 3]), false);
  assert.equal(looksLikeDates([]), false);
});

test('evaluateRule con elapsed y la validación de la condición', () => {
  const condition: Condition = {
    kind: 'compare',
    left: { type: 'column', column: 'Alta' },
    operator: 'elapsed',
    unit: 'days',
    right: { type: 'value', value: 30 },
  };
  assert.equal(conditionSchema.safeParse(condition).success, true);
  const table = {
    headers: ['Alta'],
    rows: [
      { rowNumber: 2, values: { Alta: '2026-08-01' } },
      { rowNumber: 3, values: { Alta: '2026-10-10' } },
      { rowNumber: 4, values: { Alta: null } },
    ],
  };
  assert.deepEqual(evaluateRule({ id: 'e', condition }, table as never, { today: TODAY }).matchedRows, [2]);
  assert.equal(conditionSchema.safeParse({ ...condition, right: { type: 'value', value: '30' } }).success, false);
  assert.equal(conditionSchema.safeParse({ ...condition, right: { type: 'value', value: 5000 } }).success, false);
  const onDate = { ...condition, operator: 'on_date' as const, unit: undefined, right: { type: 'value' as const, value: '2026-12-01' } };
  assert.equal(conditionSchema.safeParse(onDate).success, true);
  assert.equal(conditionSchema.safeParse({ ...onDate, right: { type: 'value', value: '01/12/2026' } }).success, false);
});

test('lector de fechas: mismos formatos y resultados que el agente', () => {
  const iso = (n: number | null) => (n === null ? 'null' : new Date(n * 86_400_000).toISOString().slice(0, 10));
  const parse = DATE_CASES as unknown as { parse: [string, string][]; loose: [unknown, string][] };
  for (const [text, expected] of parse.parse) assert.equal(iso(toDate(text)), expected, `toDate(${JSON.stringify(text)})`);
  for (const [value, expected] of parse.loose) assert.equal(iso(toDateLoose(value)), expected, `toDateLoose(${JSON.stringify(value)})`);
});

test('countUnreadableDates y pista por nombre de columna', () => {
  assert.equal(countUnreadableDates(['15/10/2026', 'pronto', null, 45123, '']), 1);
  assert.equal(looksLikeDates(['pronto', '15/10/2026', 'n/a'], 'Fecha de alta'), true); // 1 de 3 = 33 % basta con pista
  assert.equal(looksLikeDates(['pronto', '15/10/2026', 'n/a'], 'Notas'), false);
});
