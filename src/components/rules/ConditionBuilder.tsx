'use client';

import {
  DATE_OPERATORS,
  MAX_ELAPSED,
  OPERATORS,
  OPERATOR_LABELS,
  TIME_UNITS,
  TIME_UNIT_LABELS,
  isDateOperator,
  isUnary,
  type Operator,
  type TimeUnit,
} from '@/lib/rules/operators';
import { MAX_CONDITION_DEPTH, MAX_CONDITION_LEAVES } from '@/lib/rules/types';
import { countLeaves, newGroup, newLeaf, type GroupDraft, type LeafDraft, type NodeDraft } from '@/lib/rules/draft';

export interface BuilderColumn {
  name: string;
  sheets: string[];
  isDate?: boolean;
}

const COMPARATORS: readonly Operator[] = ['gt', 'gte', 'lt', 'lte', 'eq', 'neq'];

interface Ctx {
  columns: BuilderColumn[];
  active: string[];
  update: (id: string, patch: Partial<LeafDraft> | Partial<GroupDraft>) => void;
  add: (groupId: string, node: NodeDraft) => void;
  remove: (id: string) => void;
}

function columnLabel(c: BuilderColumn, active: string[]): string {
  const base = c.isDate ? `${c.name} · fecha` : c.name;
  if (active.length > 1 && c.sheets.length > 0 && c.sheets.length < active.length) return `${base} (solo en ${c.sheets.join(', ')})`;
  return base;
}

function Leaf({ leaf, ctx, canRemove }: { leaf: LeafDraft; ctx: Ctx; canRemove: boolean }) {
  const set = (p: Partial<LeafDraft>) => ctx.update(leaf.id, p);
  const col = ctx.columns.find((c) => c.name === leaf.column);
  const leftIsDate = !!col?.isDate;
  const valueIsDate = leaf.valueAsDate && COMPARATORS.includes(leaf.operator);
  const id = leaf.id;
  return (
    <div className="cond-leaf">
      <div className="grid3">
        <div className="field">
          <label htmlFor={`${id}-col`}>Si la columna…</label>
          <select id={`${id}-col`} value={leaf.column} onChange={(e) => set({ column: e.target.value, valueAsDate: !!ctx.columns.find((c) => c.name === e.target.value)?.isDate, rightValue: '' })}>
            {ctx.columns.map((c) => (
              <option key={c.name} value={c.name}>
                {columnLabel(c, ctx.active)}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor={`${id}-op`}>…cumple</label>
          <select id={`${id}-op`} value={leaf.operator} onChange={(e) => set({ operator: e.target.value as Operator })}>
            {OPERATORS.filter((o) => !isDateOperator(o)).map((o) => (
              <option key={o} value={o}>
                {OPERATOR_LABELS[o]}
              </option>
            ))}
            <optgroup label="Para fechas (con calendario)">
              {DATE_OPERATORS.map((o) => (
                <option key={o} value={o}>
                  {OPERATOR_LABELS[o]}
                </option>
              ))}
            </optgroup>
          </select>
        </div>

        {leaf.operator === 'elapsed' && (
          <div className="field">
            <label htmlFor={`${id}-n`}>Tiempo transcurrido</label>
            <div className="inline-pair">
              <input id={`${id}-n`} type="number" min={0} max={MAX_ELAPSED} step={1} required value={leaf.elapsedN} onChange={(e) => set({ elapsedN: e.target.value })} aria-label="Cantidad" />
              <select value={leaf.unit} onChange={(e) => set({ unit: e.target.value as TimeUnit })} aria-label="Unidad de tiempo">
                {TIME_UNITS.map((u) => (
                  <option key={u} value={u}>
                    {TIME_UNIT_LABELS[u]}
                  </option>
                ))}
              </select>
            </div>
            <span className="muted">Avisa cuando hayan pasado al menos esos días (semanas, meses…) desde la fecha de cada fila. Ejemplo: 6 meses.</span>
            {!leftIsDate && <span className="muted">Esta columna no parece de fechas, pero puedes usar la opción igualmente. Las celdas que no se lean como fecha se ignoran.</span>}
          </div>
        )}

        {leaf.operator === 'on_date' && (
          <div className="field">
            <label htmlFor={`${id}-d`}>Fecha del aviso</label>
            <input id={`${id}-d`} type="date" required value={leaf.dateValue} onChange={(e) => set({ dateValue: e.target.value })} />
            <span className="muted">Desde ese día avisa de las filas que tengan una fecha en esta columna. Se repite cada día.</span>
            {!leftIsDate && <span className="muted">Esta columna no parece de fechas, pero puedes usar la opción igualmente.</span>}
          </div>
        )}

        {!isUnary(leaf.operator) && !isDateOperator(leaf.operator) && (
          <div className="field">
            <label htmlFor={`${id}-rt`}>Comparar con</label>
            <div className="inline-pair">
              <select id={`${id}-rt`} value={leaf.rightType} onChange={(e) => set({ rightType: e.target.value as 'column' | 'value' })} aria-label="Tipo de comparación">
                <option value="value">Valor fijo</option>
                <option value="column">Otra columna</option>
              </select>
              {leaf.rightType === 'column' ? (
                <select value={leaf.rightColumn} onChange={(e) => set({ rightColumn: e.target.value })} aria-label="Columna con la que comparar">
                  {ctx.columns.map((c) => (
                    <option key={c.name} value={c.name}>
                      {columnLabel(c, ctx.active)}
                    </option>
                  ))}
                </select>
              ) : (
                <input type={valueIsDate ? 'date' : 'text'} maxLength={500} value={leaf.rightValue} onChange={(e) => set({ rightValue: e.target.value })} aria-label="Valor fijo" />
              )}
            </div>
            {leaf.rightType === 'value' && COMPARATORS.includes(leaf.operator) && (
              <label className="choice" style={{ marginTop: 6 }}>
                <input type="checkbox" checked={leaf.valueAsDate} onChange={(e) => set({ valueAsDate: e.target.checked, rightValue: '' })} />
                <span>Elegir el valor en un calendario</span>
              </label>
            )}
          </div>
        )}
      </div>
      {canRemove && (
        <button type="button" className="btn ghost-line cond-remove" onClick={() => ctx.remove(leaf.id)}>
          Quitar condición
        </button>
      )}
    </div>
  );
}

function Group({ group, ctx, depth, root, total }: { group: GroupDraft; ctx: Ctx; depth: number; root: boolean; total: number }) {
  const canNest = depth <= MAX_CONDITION_DEPTH;
  const canAdd = total < MAX_CONDITION_LEAVES;
  const first = ctx.columns[0]?.name ?? '';
  const single = group.children.length <= 1;
  return (
    <div className={`cond-group ${root ? 'is-root' : ''}`} role="group" aria-label={root ? 'Condiciones de la regla' : 'Grupo de condiciones'}>
      <div className="cond-head">
        {single ? (
          <span className="field-title">{root ? 'La regla avisa cuando se cumple…' : 'Grupo'}</span>
        ) : (
          <label className="cond-join">
            <span className="field-title">{root ? 'La regla avisa cuando se cumplan' : 'Dentro de este grupo, se cumplan'}</span>
            <select value={group.op} onChange={(e) => ctx.update(group.id, { op: e.target.value as 'and' | 'or' })}>
              <option value="and">TODAS estas condiciones (y)</option>
              <option value="or">ALGUNA de estas condiciones (o)</option>
            </select>
          </label>
        )}
        {!root && (
          <button type="button" className="btn ghost-line" onClick={() => ctx.remove(group.id)}>
            Quitar grupo
          </button>
        )}
      </div>
      <ul className="cond-list">
        {group.children.map((k, i) => (
          <li key={k.id}>
            {i > 0 && <span className="cond-op" aria-hidden="true">{group.op === 'and' ? 'Y' : 'O'}</span>}
            {k.kind === 'leaf' ? (
              <Leaf leaf={k} ctx={ctx} canRemove={group.children.length > 1 || !root} />
            ) : (
              <Group group={k} ctx={ctx} depth={depth + 1} root={false} total={total} />
            )}
          </li>
        ))}
      </ul>
      <div className="cond-add">
        <button type="button" className="btn" disabled={!canAdd} onClick={() => ctx.add(group.id, newLeaf(first, { operator: 'eq', rightColumn: ctx.columns[1]?.name ?? first }))}>
          + Añadir condición
        </button>
        {canNest && (
          <button type="button" className="btn" disabled={!canAdd} onClick={() => ctx.add(group.id, newGroup(group.op === 'and' ? 'or' : 'and', [newLeaf(first)]))}>
            + Añadir grupo ({group.op === 'and' ? 'alguna de…' : 'todas las de…'})
          </button>
        )}
        {!canAdd && <span className="muted">Máximo {MAX_CONDITION_LEAVES} condiciones.</span>}
      </div>
    </div>
  );
}

/** Editor de condiciones: varias condiciones unidas con «y» / «o», con grupos anidados. */
export function ConditionBuilder({
  tree,
  onChange,
  columns,
  active,
}: {
  tree: GroupDraft;
  onChange: (t: GroupDraft) => void;
  columns: BuilderColumn[];
  active: string[];
}) {
  const edit = (node: NodeDraft, fn: (n: NodeDraft) => NodeDraft | null): NodeDraft | null => {
    const r = fn(node);
    if (r === null) return null;
    if (r.kind === 'group') return { ...r, children: r.children.map((c) => edit(c, fn)).filter((c): c is NodeDraft => c !== null) };
    return r;
  };
  const ctx: Ctx = {
    columns,
    active,
    update: (id, patch) => onChange(edit(tree, (n) => (n.id === id ? ({ ...n, ...patch } as NodeDraft) : n)) as GroupDraft),
    add: (groupId, node) =>
      onChange(edit(tree, (n) => (n.kind === 'group' && n.id === groupId ? { ...n, children: [...n.children, node] } : n)) as GroupDraft),
    remove: (id) => onChange(edit(tree, (n) => (n.id === id ? null : n)) as GroupDraft),
  };
  return <Group group={tree} ctx={ctx} depth={1} root total={countLeaves(tree)} />;
}
