import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildEmails, formatCell, formatNumber, parseRecipients, referencedColumns, type MatchedRow } from './render';
import { emailActionSchema, type EmailAction } from '../rules/types';

const RULE = '11111111-1111-4111-8111-111111111111';
const META = { fileName: 'Facturas.xlsx', ruleName: 'Vencidas', sheetName: 'Enero', columnName: 'Estado', count: 3 };

const action = (o: Partial<EmailAction> = {}): EmailAction =>
  emailActionSchema.parse({
    type: 'email',
    to: '{col:Email}',
    subject: 'Factura {col:Nº} pendiente',
    body: 'Hola {col:Cliente}, debes {col:Importe} desde {col:Vence}.',
    ...o,
  });

const rows: MatchedRow[] = [
  { rowNumber: 2, values: { Email: 'ana@x.com', 'Nº': 17, Cliente: 'Ana', Importe: 1234.5, Vence: new Date('2026-10-09T00:00:00Z') } },
  { rowNumber: 5, values: { Email: 'luis@y.es', 'Nº': 18, Cliente: 'Luis', Importe: 12345.678, Vence: new Date('2026-11-01T00:00:00Z') } },
  { rowNumber: 9, values: { Email: 'mal', 'Nº': 19, Cliente: 'Eva', Importe: 0.5, Vence: '2026-12-01' } },
];
const HEADERS = ['Email', 'Nº', 'Cliente', 'Importe', 'Vence', 'Estado'];

test('formatNumber: estilo es-ES, miles solo desde 5 cifras', () => {
  assert.equal(formatNumber(12), '12');
  assert.equal(formatNumber(1234.5), '1234,5');
  assert.equal(formatNumber(12345.678), '12.345,68');
  assert.equal(formatNumber(-0.5), '-0,5');
  assert.equal(formatNumber(-0.001), '0');
  assert.equal(formatNumber(1.1), '1,1');
  assert.equal(formatNumber(100), '100');
  assert.equal(formatNumber(1000000), '1.000.000');
  assert.equal(formatNumber(0.125), '0,13');
});

test('formatCell: fechas, booleanos, vacíos y texto con saltos de línea', () => {
  assert.equal(formatCell(new Date('2026-10-09T00:00:00Z')), '09/10/2026');
  assert.equal(formatCell(new Date('2026-10-08T23:58:00Z')), '09/10/2026'); // desfase de segundos de xlsx
  assert.equal(formatCell(true), 'Sí');
  assert.equal(formatCell(null), '');
  assert.equal(formatCell('  Ana\r\nBcc: x@y.com  '), 'Ana Bcc: x@y.com');
  assert.equal(formatCell('x'.repeat(300)).length, 201);
});

test('referencedColumns y destinatarios', () => {
  assert.deepEqual(referencedColumns(['{col:A} {count}', '{col:B}{col:A}']), ['A', 'B']);
  assert.deepEqual(parseRecipients('a@x.com; b@y.es'), ['a@x.com', 'b@y.es']);
  assert.equal(parseRecipients('a@x.com; mal'), null);
  assert.equal(parseRecipients('a@x.com\nbcc:b@y.es'), null);
  assert.equal(parseRecipients(''), null);
});

test('un correo por fila: variables sustituidas y destinatario no válido queda como problema', () => {
  const out = buildEmails(action(), RULE, META, rows, HEADERS);
  assert.equal(out.length, 3);
  assert.equal(out[0].to, 'ana@x.com');
  assert.equal(out[0].subject, 'Factura 17 pendiente');
  assert.equal(out[0].body, 'Hola Ana, debes 1234,5 desde 09/10/2026.');
  assert.equal(out[0].problem, null);
  assert.equal(out[1].body, 'Hola Luis, debes 12.345,68 desde 01/11/2026.');
  assert.match(out[2].problem ?? '', /no es una dirección de correo válida/);
});

test('resumen: valores distintos en un solo correo', () => {
  const out = buildEmails(action({ mode: 'summary', to: 'jefe@x.com', subject: '{count} facturas', body: 'Clientes: {col:Cliente}. Filas {rows}.' }), RULE, META, rows, HEADERS);
  assert.equal(out.length, 1);
  assert.equal(out[0].subject, '3 facturas');
  assert.equal(out[0].body, 'Clientes: Ana, Luis, Eva. Filas 2, 5, 9.');
  assert.equal(out[0].row, null);
});

test('columna que ya no existe → problema, no fallo', () => {
  const out = buildEmails(action(), RULE, META, rows, HEADERS.filter((h) => h !== 'Cliente'));
  assert.ok(out.every((d) => /ya no existe/.test(d.problem ?? '')));
});

test('tope de 25 correos y sin duplicados idénticos', () => {
  const many: MatchedRow[] = Array.from({ length: 60 }, (_, i) => ({ rowNumber: i + 2, values: { Email: `u${i}@x.com`, 'Nº': i, Cliente: 'C', Importe: 1, Vence: null } }));
  assert.equal(buildEmails(action(), RULE, META, many, HEADERS).length, 25);
  const same: MatchedRow[] = [many[0], { ...many[0], rowNumber: 99 }];
  assert.equal(buildEmails(action(), RULE, META, same, HEADERS).length, 1);
});

test('el asunto y el destinatario no pueden llevar saltos de línea (inyección de cabeceras)', () => {
  const evil: MatchedRow[] = [{ rowNumber: 2, values: { Email: 'a@x.com\r\nBcc: z@z.com', 'Nº': 'x\nSubject: hola', Cliente: 'C', Importe: 1, Vence: null } }];
  const out = buildEmails(action(), RULE, META, evil, HEADERS);
  assert.ok(!/[\r\n]/.test(out[0].subject) && !/[\r\n]/.test(out[0].to));
  assert.ok(out[0].problem); // «a@x.com Bcc: z@z.com» no es una dirección válida
});

test('esquema: modo por defecto y remitente opcional', () => {
  const a = emailActionSchema.parse({ type: 'email', to: 'a@x.com', subject: 's', body: 'b' });
  assert.equal(a.mode, 'per_row');
  assert.equal(a.from, '');
  assert.equal(emailActionSchema.safeParse({ type: 'email', from: 'no', to: 'a@x.com', subject: 's', body: 'b' }).success, false);
});

/* Los mismos casos los ejecuta el agente de Python (agent/tests/test_email_render.py). */
test('casos compartidos con el agente local', () => {
  const file = join(__dirname, '../../../agent/tests/email_cases.json');
  const cases = JSON.parse(readFileSync(file, 'utf8')) as {
    name: string;
    action: unknown;
    meta: typeof META;
    headers: string[];
    rows: { rowNumber: number; values: Record<string, unknown> }[];
    expected: unknown[];
  }[];
  assert.ok(cases.length >= 5);
  for (const c of cases) {
    const revive = (v: unknown) => (v && typeof v === 'object' && '$date' in v ? new Date((v as { $date: string }).$date) : v);
    const matched = c.rows.map((r) => ({
      rowNumber: r.rowNumber,
      values: Object.fromEntries(Object.entries(r.values).map(([k, v]) => [k, revive(v)])),
    })) as MatchedRow[];
    const got = buildEmails(emailActionSchema.parse(c.action), RULE, c.meta, matched, c.headers);
    assert.deepEqual(got, c.expected, c.name);
  }
});
