import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fillDocx, listFields, makeResolver, partXml, TemplateError } from './docx';

const DIR = join(__dirname, '../../../agent/tests');
const DATA = new Uint8Array(readFileSync(join(DIR, 'fixtures/plantilla.docx')));
const EXP = JSON.parse(readFileSync(join(DIR, 'fill_expected.json'), 'utf8')) as {
  fields: string[]; headers: string[]; values: Record<string, string | number | null>; mapping: Record<string, string>;
  row: number; today: string; file: string; sheet: string; rule: string; document: string; header: string;
};
const resolver = () => makeResolver(EXP.headers, EXP.values, EXP.mapping, { row: EXP.row, today: EXP.today, fileName: EXP.file, sheet: EXP.sheet, rule: EXP.rule });

test('plantilla: mismos campos y mismo documento rellenado que el agente', async () => {
  assert.deepEqual(await listFields(DATA), EXP.fields);
  const out = await fillDocx(DATA, resolver());
  assert.equal(await partXml(out), EXP.document);
  assert.equal(await partXml(out, 'word/header1.xml'), EXP.header);
  assert.deepEqual(await listFields(out), []);
});

test('plantilla: orden de resolución y errores', async () => {
  const r = makeResolver(['Nombre', 'Importe'], { Nombre: 'Ana', Importe: 3 }, { Titular: 'Nombre' }, { row: 9, today: '01/01/2027' });
  assert.deepEqual([r('titular'), r(' NOMBRE '), r('importe'), r('fila'), r('hoy'), r('nada')], ['Ana', 'Ana', '3', '9', '01/01/2027', '']);
  await assert.rejects(() => listFields(new TextEncoder().encode('esto no es un zip')), TemplateError);
});
