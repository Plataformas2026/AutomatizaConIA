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
