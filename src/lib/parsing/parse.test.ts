import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { listSheets, parseWorkbook, parseMimeFor, resolveSheets, GOOGLE_SHEET_MIME, XLSX_MIME } from './parse';

function workbook(): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Producto', 'Stock'], ['A', 3], ['B', 50]]), 'Enero');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[], ['Producto', 'Stock'], ['C', 1]]), 'Febrero');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Nota'], ['hola']]), 'Notas');
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

test('listSheets devuelve los nombres sin leer el contenido', () => {
  assert.deepEqual(listSheets(workbook(), XLSX_MIME), ['Enero', 'Febrero', 'Notas']);
  assert.deepEqual(listSheets(new ArrayBuffer(0), 'text/csv'), []);
});

test('parseWorkbook: first / selected / all', () => {
  const buf = workbook();
  const first = parseWorkbook(buf, XLSX_MIME, { mode: 'first', names: [] });
  assert.deepEqual(first.sheets.map((s) => s.sheetName), ['Enero']);

  const some = parseWorkbook(buf, XLSX_MIME, { mode: 'selected', names: ['Notas', 'Febrero', 'Inexistente'] });
  assert.deepEqual(some.sheets.map((s) => s.sheetName), ['Febrero', 'Notas']); // orden del libro; ignora la que no existe

  const all = parseWorkbook(buf, XLSX_MIME, { mode: 'all', names: [] });
  assert.deepEqual(all.sheets.map((s) => s.sheetName), ['Enero', 'Febrero', 'Notas']);
  assert.deepEqual(all.available, ['Enero', 'Febrero', 'Notas']);
});

test('parseWorkbook: nº de fila real aunque la tabla no empiece en la fila 1', () => {
  const feb = parseWorkbook(workbook(), XLSX_MIME, { mode: 'selected', names: ['Febrero'] }).sheets[0].table;
  assert.deepEqual(feb.headers, ['Producto', 'Stock']);
  assert.deepEqual(feb.rows.map((r) => r.rowNumber), [3]); // cabecera en la fila 2 → dato en la 3
});

test('parseWorkbook: selección que ya no existe → sin hojas', () => {
  const r = parseWorkbook(workbook(), XLSX_MIME, { mode: 'selected', names: ['Borrada'] });
  assert.equal(r.sheets.length, 0);
});

test('CSV: una sola "hoja" sin nombre; Google Sheets se trata como xlsx', () => {
  const csv = new TextEncoder().encode('a;b\n1;2\n').buffer as ArrayBuffer;
  const r = parseWorkbook(csv, 'text/csv', { mode: 'all', names: [] });
  assert.equal(r.sheets.length, 1);
  assert.equal(r.sheets[0].sheetName, null);
  assert.equal(parseMimeFor(GOOGLE_SHEET_MIME), XLSX_MIME);
  assert.deepEqual(resolveSheets(['x', 'y'], { mode: 'first', names: [] }), ['x']);
});
