import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describeCondition, fromCondition, newGroup, newLeaf, toCondition, validateDraft } from './draft';
import { conditionSchema } from './types';

const CASES = JSON.parse(readFileSync(join(__dirname, '../../../agent/tests/compound_cases.json'), 'utf8')) as {
  cases: { name: string; condition: unknown }[];
  valid: unknown[];
};

test('editor: guardar y volver a abrir una regla no la cambia', () => {
  for (const c of [...CASES.cases.map((x) => x.condition), ...CASES.valid]) {
    const draft = fromCondition(c, ['X', 'Y', 'H']);
    const back = toCondition(draft);
    assert.ok(conditionSchema.safeParse(back).success, JSON.stringify(back));
    // «grupo de una condición» se simplifica al guardarse; el resto debe ser idéntico.
    // (el editor guarda los valores fijos como texto: «3» y 3 se comparan igual en el motor)
    const norm = (v: unknown): unknown =>
      v && typeof v === 'object' && (v as { kind?: string }).kind === 'compare'
        ? (() => {
            const k = v as { operator: string; right?: { type: string; value?: unknown } };
            return k.right?.type === 'value' && k.operator !== 'elapsed' ? { ...k, right: { ...k.right, value: String(k.right.value) } } : v;
          })()
        : v && typeof v === 'object' && (v as { kind?: string }).kind === 'group' && (v as { conditions: unknown[] }).conditions.length === 1
        ? norm((v as { conditions: unknown[] }).conditions[0])
        : v && typeof v === 'object' && (v as { kind?: string }).kind === 'group'
          ? { ...(v as object), conditions: (v as { conditions: unknown[] }).conditions.map(norm) }
          : v;
    assert.deepEqual(JSON.parse(JSON.stringify(back)), JSON.parse(JSON.stringify(norm(c))));
  }
});

test('editor: ejemplo A construido a mano', () => {
  const a = newGroup('and', [
    newLeaf('X', { operator: 'eq', rightValue: 'y' }),
    newGroup('or', [newLeaf('H', { operator: 'is_empty' }), newLeaf('H', { operator: 'contains', rightValue: 'K' })]),
  ]);
  assert.equal(validateDraft(a, ['X', 'H']), null);
  assert.equal(describeCondition(toCondition(a)), '«X» es igual a "y" y («H» está vacío o «H» contiene "K")');
  assert.ok(conditionSchema.safeParse(toCondition(a)).success);
});

test('editor: validaciones', () => {
  const cols = ['X', 'H'];
  assert.match(validateDraft(newGroup('and', []), cols) ?? '', /sin condiciones/);
  assert.match(validateDraft(newLeaf('Z'), cols) ?? '', /columna/);
  assert.match(validateDraft(newLeaf('X', { operator: 'contains', rightValue: ' ' }), cols) ?? '', /texto/);
  assert.match(validateDraft(newLeaf('X', { operator: 'elapsed', elapsedN: '-1' }), cols) ?? '', /número entero/);
  assert.match(validateDraft(newLeaf('X', { operator: 'on_date' }), cols) ?? '', /calendario/);
  assert.equal(validateDraft(newLeaf('X', { operator: 'is_not_empty' }), cols), null);
  assert.equal(describeCondition(toCondition(newLeaf('X', { operator: 'is_not_empty' }))), '«X» no está vacío');
});
