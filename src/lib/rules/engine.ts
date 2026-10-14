import { MAX_ELAPSED, type Operator, type TimeUnit } from './operators';
import type { Condition } from './types';
import type { ParsedTable, SheetTable } from '../parsing/parse';

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

const MONTHS: Record<string, number> = {
  ene: 1, jan: 1, feb: 2, mar: 3, abr: 4, apr: 4, may: 5, jun: 6, jul: 7, ago: 8, aug: 8,
  sep: 9, set: 9, oct: 10, nov: 11, dic: 12, dec: 12,
};
// Sufijo opcional de hora: «14/10/2026 10:30», «2026-10-14T10:30:00Z», «14/10/2026 0:00:00».
const TIME_TAIL = '(?:[ T,]+\\d{1,2}:\\d{2}(?::\\d{2}(?:[.,]\\d+)?)?(?:\\s?[ap]\\.?m\\.?)?(?:Z|[+-]\\d{2}:?\\d{2})?)?';

function ymd(y: number, mo: number, d: number): number | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const ms = Date.UTC(y, mo - 1, d);
  const check = new Date(ms);
  return check.getUTCMonth() === mo - 1 ? toDay(ms) : null; // 31/04 no existe
}

function fullYear(yy: string): number {
  if (yy.length === 4) return Number(yy);
  const n = Number(yy);
  return n <= 69 ? 2000 + n : 1900 + n;
}

/** Fechas en texto: ISO (2026-10-09, 2026/10/09), dd/mm/aaaa y dd/mm/aa (también con - o .), con hora opcional,
 *  y con el mes escrito («15 oct 2026», «15-oct-26», «15 de octubre de 2026»). Se asume día/mes/año (España). */
function parseDateText(raw: string): number | null {
  const s = raw.trim().replace(/\s+/g, ' ');
  if (!s) return null;

  let m = s.match(new RegExp(`^(\\d{4})[-/.](\\d{1,2})[-/.](\\d{1,2})${TIME_TAIL}$`));
  if (m) {
    // ISO con hora y zona («…Z» / «+02:00»): respeta el instante, como siempre.
    if (/^\d{4}-\d{2}-\d{2}[T ]\d/.test(s) && /(Z|[+-]\d{2}:?\d{2})$/.test(s)) {
      const ms = Date.parse(s.replace(' ', 'T'));
      return Number.isNaN(ms) ? null : toDay(ms);
    }
    return ymd(Number(m[1]), Number(m[2]), Number(m[3]));
  }

  m = s.match(new RegExp(`^(\\d{1,2})[/.-](\\d{1,2})[/.-](\\d{4}|\\d{2})${TIME_TAIL}$`));
  if (m) {
    const y = fullYear(m[3]);
    const mo = Number(m[2]);
    // Compatibilidad: con año de 4 cifras, un día/mes fuera de rango «desborda» (31/02 → 3 mar), como antes.
    if (m[3].length === 4) {
      const ms = Date.UTC(y, mo - 1, Number(m[1]));
      return Number.isNaN(ms) ? null : toDay(ms);
    }
    return ymd(y, mo, Number(m[1]));
  }

  m = s.match(new RegExp(`^(\\d{1,2})º?[ /.-]*(?:de )?([a-záéíóúñ]{3,12})\\.?[ /.,-]*(?:de )?(\\d{4}|\\d{2})${TIME_TAIL}$`, 'i'));
  if (m) {
    const mo = MONTHS[m[2].toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').slice(0, 3)];
    return mo ? ymd(fullYear(m[3]), mo, Number(m[1])) : null;
  }
  return null;
}

/** Número de serie de Excel (días desde 1899-12-30) → nº de días desde 1970. Solo 1927–2118, para no confundir números normales. */
function fromExcelSerial(n: number): number | null {
  return Number.isFinite(n) && n >= 10_000 && n <= 80_000 ? Math.floor(n) - 25_569 : null;
}

/** Fechas: objetos Date (xlsx) o texto en los formatos de arriba. Se comparan por día. */
export function toDate(v: unknown): number | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : toDay(v.getTime());
  if (typeof v !== 'string') return null;
  return parseDateText(v);
}

/** Como `toDate`, pero además acepta el número de serie de Excel (45123 = 16/07/2023): para columnas que el
 *  usuario ha marcado como fecha en «ha pasado al menos…» y «ya llegó la fecha». */
export function toDateLoose(v: unknown): number | null {
  const d = toDate(v);
  if (d !== null) return d;
  if (typeof v === 'number') return fromExcelSerial(v);
  if (typeof v === 'string' && /^\d{5}(\.\d+)?$/.test(v.trim())) return fromExcelSerial(Number(v));
  return null;
}

/** Día de hoy (nº de días desde 1970) en la zona horaria de la aplicación. */
export function todayDay(timeZone = process.env.APP_TIME_ZONE || 'Europe/Madrid', now = new Date()): number {
  const iso = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  return Math.floor(Date.parse(`${iso}T00:00:00Z`) / DAY_MS);
}

/** Suma `n` unidades a un día. Los meses/años respetan el calendario (31 ene + 1 mes = 28/29 feb). */
export function addUnits(day: number, n: number, unit: TimeUnit): number {
  if (unit === 'days') return day + n;
  if (unit === 'weeks') return day + 7 * n;
  const d = new Date(day * DAY_MS);
  const months = d.getUTCFullYear() * 12 + d.getUTCMonth() + (unit === 'years' ? 12 * n : n);
  const y = Math.floor(months / 12);
  const m = months % 12;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return Math.floor(Date.UTC(y, m, Math.min(d.getUTCDate(), last)) / DAY_MS);
}

const DATE_HEADER = /fecha|date|\balta\b|\bbaja\b|venc|caduc|nacim|inicio|fin\b|plazo|expir|entrega|emisi|cita|renov/i;

/** ¿Parece una columna de fecha? Basta con que el 60 % de los valores con contenido lo sean (30 % si el
 *  nombre de la columna lo sugiere: «Fecha alta», «Vencimiento»…). Es solo una pista: el calendario se ofrece siempre. */
export function looksLikeDates(values: unknown[], header = ''): boolean {
  let filled = 0;
  let dates = 0;
  for (const v of values) {
    if (isEmpty(v)) continue;
    filled++;
    if (toDate(v) !== null) dates++;
    if (filled >= 200) break;
  }
  if (filled === 0) return false;
  return dates / filled >= (DATE_HEADER.test(header) ? 0.3 : 0.6);
}

/** Nº de celdas con contenido de la columna que NO se reconocen como fecha (para avisar sin enseñar datos). */
export function countUnreadableDates(values: unknown[]): number {
  let n = 0;
  for (const v of values) if (!isEmpty(v) && toDateLoose(v) === null) n++;
  return n;
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

export interface CompareContext {
  /** Día de hoy (por defecto, el real). Inyectable para las pruebas. */
  today?: number;
  /** Unidad de `elapsed` (por defecto, días). */
  unit?: TimeUnit;
}

export function compare(left: unknown, op: Operator, right: unknown, ctx: CompareContext = {}): boolean {
  switch (op) {
    case 'elapsed': {
      // «Han pasado al menos N días/semanas/meses/años desde la fecha de la celda».
      const day = toDateLoose(left);
      const n = toNumber(right);
      if (day === null || n === null || !Number.isInteger(n) || n < 0 || n > MAX_ELAPSED) return false;
      return (ctx.today ?? todayDay()) >= addUnits(day, n, ctx.unit ?? 'days');
    }
    case 'on_date': {
      // «Ya llegó la fecha elegida»: desde ese día, avisa de las filas que tienen una fecha.
      const day = toDateLoose(left);
      const target = toDate(right);
      return day !== null && target !== null && (ctx.today ?? todayDay()) >= target;
    }
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
  opts: { today?: number } = {},
): RuleEvaluation {
  const { condition } = rule;
  const today = opts.today ?? todayDay();
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
    if (compare(l, condition.operator, r, { today, unit: condition.unit })) matched.push(row.rowNumber);
  }
  return { ruleId: rule.id, matchedRows: matched, matchedCount: matched.length };
}

/* ── Evaluación sobre varias hojas ─────────────────────────── */

export interface SheetEvaluation {
  /** null en CSV (sin hojas). */
  sheetName: string | null;
  matchedRows: number[];
  matchedCount: number;
}

export interface MultiSheetEvaluation {
  ruleId: string;
  /** Solo las hojas donde la regla se pudo evaluar (tienen las columnas). */
  sheets: SheetEvaluation[];
  error?: string;
}

/**
 * Evalúa la regla en cada hoja. Una hoja que no tiene las columnas de la regla
 * se omite sin más; solo hay error si NINGUNA hoja puede evaluarla.
 */
export function evaluateRuleAcrossSheets(
  rule: { id: string; condition: Condition },
  sheets: SheetTable[],
  opts: { today?: number } = {},
): MultiSheetEvaluation {
  if (sheets.length === 0) {
    return { ruleId: rule.id, sheets: [], error: 'No hay hojas que vigilar: revisa la selección de hojas' };
  }

  const results: SheetEvaluation[] = [];
  let firstError: string | undefined;

  for (const s of sheets) {
    const ev = evaluateRule(rule, s.table, opts);
    if (ev.error) {
      firstError ??= ev.error;
      continue;
    }
    results.push({ sheetName: s.sheetName, matchedRows: ev.matchedRows, matchedCount: ev.matchedCount });
  }

  if (results.length === 0) {
    return {
      ruleId: rule.id,
      sheets: [],
      error:
        sheets.length === 1
          ? firstError
          : 'Las columnas de la regla no existen en ninguna de las hojas vigiladas',
    };
  }
  return { ruleId: rule.id, sheets: results };
}
