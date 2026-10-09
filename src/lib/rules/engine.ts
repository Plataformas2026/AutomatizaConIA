import type { Operator } from './operators';
import type { Condition } from './types';
import type { ParsedTable } from '../parsing/parse';

/** Evaluador PURO: recibe la tabla en memoria y devuelve solo nº de fila.
 *  No hace I/O, no registra nada. */

export interface RuleEvaluation {
  ruleId: string;
  /** Todos los nº de fila que cumplen la condición (para la huella). */
  matchedRows: number[];
  matchedCount: number;
  /** Problema de configuración (p. ej. la columna ya no existe). */
  error?: string;
}

/* ── Conversión de valores ─────────────────────────────────── */

export function isEmpty(v: unknown): boolean {
  return v == null || (typeof v === 'string' && v.trim() === '');
}

/** Acepta 1234.56 · 1.234,56 · 1,234.56 · 1234,56 · "12 €" · "15%".
 *  Ambigüedad conocida: "1.234" se interpreta como 1,234 (decimal). */
export function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (v == null || typeof v === 'boolean' || v instanceof Date) return null;

  let s = String(v).trim().replace(/[\s€$£%]/g, '');
  if (!s) return null;

  const hasComma = s.includes(',');
  const hasDot = s.includes('.');

  if (hasComma && hasDot) {
    const decimal = s.lastIndexOf(',') > s.lastIndexOf('.') ? ',' : '.';
    const thousands = decimal === ',' ? '.' : ',';
    s = s.split(thousands).join('').replace(decimal, '.');
  } else if (hasComma) {
    s = (s.match(/,/g) ?? []).length > 1 ? s.replace(/,/g, '') : s.replace(',', '.');
  } else if (hasDot && (s.match(/\./g) ?? []).length > 1) {
    s = s.replace(/\./g, '');
  }
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : null;
}

const DAY_MS = 86_400_000;
// Tolerancia para el desfase de segundos que algunas lecturas de xlsx introducen.
const DAY_TOLERANCE_MS = 5 * 60_000;

function toDay(ms: number): number {
  return Math.floor((ms + DAY_TOLERANCE_MS) / DAY_MS);
}

/** Fechas: objetos Date (xlsx), ISO (2026-10-09) o dd/mm/aaaa. Se comparan por día. */
export function toDate(v: unknown): number | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : toDay(v.getTime());
  if (typeof v !== 'string') return null;
  const s = v.trim();

  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const ms = Date.parse(s.length === 10 ? `${s}T00:00:00Z` : s);
    return Number.isNaN(ms) ? null : toDay(ms);
  }
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) {
    const [, d, mo, y] = m;
    const ms = Date.UTC(Number(y), Number(mo) - 1, Number(d));
    return Number.isNaN(ms) ? null : toDay(ms);
  }
  return null;
}

function text(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v ?? '').trim().toLowerCase();
}

/** Orden numérico → fecha → null (no comparables). */
function order(a: unknown, b: unknown): number | null {
  const na = toNumber(a);
  const nb = toNumber(b);
  if (na !== null && nb !== null) return na === nb ? 0 : na < nb ? -1 : 1;

  const da = toDate(a);
  const db = toDate(b);
  if (da !== null && db !== null) return da === db ? 0 : da < db ? -1 : 1;

  return null;
}

/* ── Comparación ───────────────────────────────────────────── */

export function compare(left: unknown, op: Operator, right: unknown): boolean {
  switch (op) {
    case 'is_empty':
      return isEmpty(left);
    case 'is_not_empty':
      return !isEmpty(left);
    case 'contains':
    case 'not_contains':
    case 'starts_with': {
      if (isEmpty(right)) return false; // regla mal configurada: nunca dispara
      const l = text(left);
      const r = text(right);
      if (op === 'contains') return l.includes(r);
      if (op === 'not_contains') return !l.includes(r);
      return l.startsWith(r);
    }
  }

  const o = order(left, right);
  switch (op) {
    case 'gt':
      return o !== null && o > 0;
    case 'gte':
      return o !== null && o >= 0;
    case 'lt':
      return o !== null && o < 0;
    case 'lte':
      return o !== null && o <= 0;
    case 'eq':
      return o !== null ? o === 0 : text(left) === text(right);
    case 'neq':
      return o !== null ? o !== 0 : text(left) !== text(right);
  }
}

/* ── Evaluación de una regla sobre una tabla ───────────────── */

export function evaluateRule(
  rule: { id: string; condition: Condition },
  table: Pick<ParsedTable, 'headers' | 'rows'>,
): RuleEvaluation {
  const { condition } = rule;
  const headers = new Set(table.headers);

  const missing = [
    condition.left.column,
    condition.right?.type === 'column' ? condition.right.column : null,
  ].find((c) => c !== null && !headers.has(c));

  if (missing) {
    return {
      ruleId: rule.id,
      matchedRows: [],
      matchedCount: 0,
      error: `La columna «${missing}» ya no existe en el archivo`,
    };
  }

  const matched: number[] = [];
  for (const row of table.rows) {
    const l = row.values[condition.left.column];
    const r = !condition.right
      ? undefined
      : condition.right.type === 'column'
        ? row.values[condition.right.column]
        : condition.right.value;
    if (compare(l, condition.operator, r)) matched.push(row.rowNumber);
  }
  return { ruleId: rule.id, matchedRows: matched, matchedCount: matched.length };
}
