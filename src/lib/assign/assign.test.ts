import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildAssignees, buildChains, cellKeys, digest, identifiers, myShare, personalize } from './assign';

const C = JSON.parse(readFileSync(join(__dirname, '../../../agent/tests/assign_cases.json'), 'utf8')) as {
  ruleId: string;
  cells: { cell: unknown; keys: string[] }[];
  rows: [number, unknown][];
  assignees: Record<string, { n: number; rows: number[] }>;
  identifiers: { email: string; aliases: string[]; expected: string[] };
  people: { email: string; aliases: string[]; mine: number }[];
  chains: Record<string, string[]>;
  handoff: { handoffs: Record<string, number>; people: { email: string; aliases: string[]; mine: number; rows?: number[] }[] };
  unassigned: string;
  unassignedCount: number;
};

test('reparto: las claves de cada celda coinciden con el agente', () => {
  for (const c of C.cells) assert.deepEqual(cellKeys(c.cell), c.keys, JSON.stringify(c.cell));
});

test('reparto: mismas huellas y recuentos que el agente', async () => {
  assert.deepEqual(await buildAssignees(C.ruleId, C.rows), C.assignees);
  assert.equal(await digest(C.ruleId, '-'), C.unassigned);
  assert.deepEqual(identifiers(C.identifiers.email, C.identifiers.aliases), C.identifiers.expected);
});

test('reparto: «cuántas me corresponden»', async () => {
  for (const p of C.people) {
    const s = await myShare(C.assignees, C.ruleId, identifiers(p.email, p.aliases));
    assert.equal(s.mine, p.mine, p.email);
    assert.equal(s.unassigned, C.unassignedCount);
  }
});

test('reparto: frase personalizada', () => {
  const m = 'Quedan 7 informes sin completar';
  assert.equal(personalize(m, { mine: 3, rows: [], unassigned: 0 }), 'Quedan 7 informes sin completar, 3 te corresponden a ti');
  assert.equal(personalize(m, { mine: 1, rows: [], unassigned: 0 }), 'Quedan 7 informes sin completar, 1 te corresponde a ti');
  assert.equal(personalize(m + '.', { mine: 0, rows: [], unassigned: 0 }), 'Quedan 7 informes sin completar, ninguno te corresponde');
});

test('reparto: cadenas «nombre1 / nombre2» iguales que en el agente', async () => {
  assert.deepEqual(await buildChains(C.ruleId, C.rows), C.chains);
});

test('reparto: tras pasar la tarea cambia quién la tiene', async () => {
  const handoffs = Object.fromEntries(Object.entries(C.handoff.handoffs).map(([k, v]) => [Number(k), v]));
  for (const p of C.handoff.people) {
    const s = await myShare(C.assignees, C.ruleId, identifiers(p.email, p.aliases), C.chains, handoffs);
    assert.equal(s.mine, p.mine, p.email);
    if (p.rows) assert.deepEqual(s.rows, p.rows, p.email);
  }
});
