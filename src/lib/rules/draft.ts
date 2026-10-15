import {
  MAX_ELAPSED,
  OPERATOR_LABELS,
  TIME_UNIT_LABELS,
  isUnary,
  type Operator,
  type TimeUnit,
} from './operators';
import { MAX_CONDITION_DEPTH, MAX_CONDITION_LEAVES, type Condition } from './types';

/**
 * Borrador del editor de condiciones (lo que se ve en pantalla) ↔ condición guardada.
 * Sin dependencias de React: se prueba aparte.
 */
export type Join = 'and' | 'or';
export interface LeafDraft {
  id: string;
  kind: 'leaf';
  /** Conector con la condición anterior del mismo grupo (el de la primera no se usa). */
  join: Join;
  column: string;
  operator: Operator;
  rightType: 'column' | 'value';
  rightColumn: string;
  rightValue: string;
  /** Valor fijo elegido en un calendario (comparadores con columnas de fecha). */
  valueAsDate: boolean;
  elapsedN: string;
  unit: TimeUnit;
  dateValue: string;
}
export interface GroupDraft {
  id: string;
  kind: 'group';
  join: Join;
  children: NodeDraft[];
}
export type NodeDraft = LeafDraft | GroupDraft;

let counter = 0;
export const uid = () => `n${++counter}`;

export function newLeaf(column = '', over: Partial<LeafDraft> = {}): LeafDraft {
  return {
    id: uid(), kind: 'leaf', join: 'and', column, operator: 'eq', rightType: 'value', rightColumn: column, rightValue: '',
    valueAsDate: false, elapsedN: '30', unit: 'days', dateValue: '', ...over,
  };
}
/** `op` fija el conector de todos los hijos (atajo); luego cada uno se puede cambiar por separado. */
export function newGroup(op: Join = 'and', children: NodeDraft[] = [], join: Join = 'and'): GroupDraft {
  return { id: uid(), kind: 'group', join, children: children.map((c) => ({ ...c, join: op })) };
}

export function countLeaves(n: NodeDraft): number {
  return n.kind === 'leaf' ? 1 : n.children.reduce((s, c) => s + countLeaves(c), 0);
}
export function depthOf(n: NodeDraft): number {
  return n.kind === 'leaf' ? 1 : 1 + Math.max(0, ...n.children.map(depthOf));
}

/**
 * Borrador → condición. Los conectores se leen como en una frase: «Y» une más fuerte que «O»
 * (A y B o C = (A y B) o C). Para otro orden se usan grupos (paréntesis).
 * Un grupo con una sola condición se guarda como condición simple.
 */
export function toCondition(n: NodeDraft): Condition {
  if (n.kind === 'group') {
    if (n.children.length === 1) return toCondition(n.children[0]);
    const runs: NodeDraft[][] = [];
    n.children.forEach((c, i) => {
      if (i === 0 || c.join === 'or') runs.push([c]);
      else runs[runs.length - 1].push(c);
    });
    const parts: Condition[] = runs.map((r) =>
      r.length === 1 ? toCondition(r[0]) : { kind: 'group' as const, op: 'and' as const, conditions: r.map(toCondition) },
    );
    if (parts.length === 1) return parts[0];
    return { kind: 'group', op: 'or', conditions: parts };
  }
  const base = { kind: 'compare' as const, left: { type: 'column' as const, column: n.column }, operator: n.operator };
  if (n.operator === 'elapsed') return { ...base, unit: n.unit, right: { type: 'value', value: Number(n.elapsedN) } };
  if (n.operator === 'on_date') return { ...base, right: { type: 'value', value: n.dateValue } };
  if (isUnary(n.operator)) return base;
  return {
    ...base,
    right: n.rightType === 'column' ? { type: 'column', column: n.rightColumn } : { type: 'value', value: n.rightValue },
  };
}

/** Condición guardada → borrador (para editar una regla). */
export function fromCondition(c: unknown, columns: string[] = []): NodeDraft {
  const o = (c ?? {}) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (o.kind === 'group' && Array.isArray(o.conditions)) {
    const children: NodeDraft[] = [];
    for (const k of o.conditions as unknown[]) {
      const ko = (k ?? {}) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
      if (o.op === 'or' && ko.kind === 'group' && ko.op === 'and' && Array.isArray(ko.conditions) && ko.conditions.length > 1) {
        // «(A y B) o C» se muestra como la cadena plana A y B o C.
        (ko.conditions as unknown[]).forEach((g, gi) =>
          children.push({ ...fromCondition(g, columns), join: gi === 0 ? 'or' : 'and' }),
        );
      } else {
        children.push({ ...fromCondition(k, columns), join: o.op === 'or' ? 'or' : 'and' });
      }
    }
    return { id: uid(), kind: 'group', join: 'and', children };
  }
  const column = String(o.left?.column ?? columns[0] ?? '');
  const op = (o.operator ?? 'eq') as Operator;
  const r = o.right ?? {};
  const isDateValue = typeof r.value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.value);
  return newLeaf(column, {
    operator: op,
    unit: (o.unit ?? 'days') as TimeUnit,
    rightType: r.type === 'column' ? 'column' : 'value',
    rightColumn: r.type === 'column' ? String(r.column ?? '') : (columns[1] ?? column),
    rightValue: op === 'elapsed' || op === 'on_date' || r.value === undefined ? '' : String(r.value),
    elapsedN: op === 'elapsed' ? String(r.value ?? '30') : '30',
    dateValue: op === 'on_date' ? String(r.value ?? '') : '',
    valueAsDate: isDateValue && op !== 'on_date',
  });
}

/** Devuelve el primer problema del borrador (texto para el usuario) o null si es válido. */
export function validateDraft(n: NodeDraft, columns: string[]): string | null {
  if (countLeaves(n) > MAX_CONDITION_LEAVES) return `Máximo ${MAX_CONDITION_LEAVES} condiciones por regla.`;
  if (depthOf(n) > MAX_CONDITION_DEPTH + 1) return `Máximo ${MAX_CONDITION_DEPTH} niveles de grupos.`;
  if (n.kind === 'group') {
    if (n.children.length === 0) return 'Hay un grupo sin condiciones: añade una o quítalo.';
    for (const k of n.children) {
      const e = validateDraft(k, columns);
      if (e) return e;
    }
    return null;
  }
  if (!n.column || !columns.includes(n.column)) return 'Elige la columna de cada condición.';
  if (n.operator === 'elapsed') {
    const v = Number(n.elapsedN);
    if (!n.elapsedN.trim() || !Number.isInteger(v) || v < 0 || v > MAX_ELAPSED) {
      return `Indica cuánto tiempo debe pasar: un número entero entre 0 y ${MAX_ELAPSED}.`;
    }
  }
  if (n.operator === 'on_date' && !n.dateValue) return 'Elige en el calendario la fecha en la que quieres el aviso.';
  if (!isUnary(n.operator) && n.operator !== 'elapsed' && n.operator !== 'on_date') {
    if (n.rightType === 'column' && !columns.includes(n.rightColumn)) return 'Elige la segunda columna de la comparación.';
    if (n.rightType === 'value' && !n.rightValue.trim() && ['contains', 'not_contains', 'starts_with'].includes(n.operator)) {
      return 'Escribe el texto a buscar en cada condición «contiene».';
    }
  }
  return null;
}

function formatIso(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

/** Frase legible de una condición guardada (para la lista de reglas). */
export function describeCondition(c: unknown, top = true): string {
  const o = (c ?? {}) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (o.kind === 'group' && Array.isArray(o.conditions)) {
    const joiner = o.op === 'or' ? ' o ' : ' y ';
    const text = o.conditions.map((k: unknown) => describeCondition(k, false)).join(joiner);
    return top ? text : `(${text})`;
  }
  const col = `«${o.left?.column}»`;
  const op: Operator | undefined = o.operator;
  const label = op ? OPERATOR_LABELS[op] : '?';
  if (op && isUnary(op)) return `${col} ${label}`;
  if (op === 'elapsed') return `${col} ha pasado al menos ${o.right?.value} ${TIME_UNIT_LABELS[(o.unit as TimeUnit) ?? 'days']} desde esa fecha`;
  if (op === 'on_date') return `${col} tiene fecha y ya llegó el ${formatIso(String(o.right?.value ?? ''))}`;
  const right = o.right?.type === 'column' ? `«${o.right.column}»` : `"${o.right?.value}"`;
  return `${col} ${label} ${right}`;
}
