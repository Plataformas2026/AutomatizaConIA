import type { Cell, ParsedTable } from '@/lib/parsing/parse';
import {
  ORDERED_TYPES,
  STACKED_TYPES,
  STACKABLE_AGGS,
  type Agg,
  type ChartConfig,
  type ChartResult,
  type ColumnKind,
} from './types';

/**
 * Agregación EN MEMORIA. Recibe la tabla leída al vuelo y devuelve solo
 * números agregados (por categoría): ninguna fila del archivo sale de aquí.
 */

export class StatsError extends Error {
  constructor(
    public code: string,
    public status = 400,
  ) {
    super(code);
  }
}

const EMPTY_LABEL = '(vacío)';
const MAX_POINTS_LINE = 200;
const MAX_SCATTER = 500;
const MAX_SERIES = 6;
const OTHERS = 'Otros';

/* ── Conversión de celdas ─────────────────────────────────────────────── */

export function cellLabel(cell: Cell | undefined): string {
  if (cell === null || cell === undefined) return EMPTY_LABEL;
  if (cell instanceof Date) return Number.isNaN(cell.getTime()) ? EMPTY_LABEL : cell.toISOString().slice(0, 10);
  if (typeof cell === 'boolean') return cell ? 'Sí' : 'No';
  const s = String(cell).trim();
  return s === '' ? EMPTY_LABEL : s;
}

/** Interpreta números escritos a la española ("1.234,56 €") o a la inglesa ("1,234.56"). */
export function cellNumber(cell: Cell | undefined): number | null {
  if (cell === null || cell === undefined || cell instanceof Date || typeof cell === 'boolean') return null;
  if (typeof cell === 'number') return Number.isFinite(cell) ? cell : null;

  let s = cell.trim().replace(/[\s €$£%]/g, '');
  if (!s || !/^[-+]?[\d.,]+$/.test(s)) return null;

  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    // Gana como decimal el separador que aparece el último.
    s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (lastComma >= 0) {
    s = (s.match(/,/g) ?? []).length === 1 ? s.replace(',', '.') : s.replace(/,/g, '');
  } else if ((s.match(/\./g) ?? []).length > 1) {
    s = s.replace(/\./g, '');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function isEmpty(cell: Cell | undefined): boolean {
  return cell === null || cell === undefined || (typeof cell === 'string' && cell.trim() === '');
}

/** Tipo de cada columna, mirando una muestra (solo se devuelve el tipo, no valores). */
export function inferKind(table: ParsedTable, column: string): ColumnKind {
  let seen = 0;
  let numbers = 0;
  let dates = 0;
  for (const row of table.rows) {
    const cell = row.values[column];
    if (isEmpty(cell)) continue;
    seen += 1;
    if (cell instanceof Date) dates += 1;
    else if (cellNumber(cell) !== null) numbers += 1;
    if (seen >= 300) break;
  }
  if (seen === 0) return 'text';
  if (dates / seen >= 0.8) return 'date';
  if (numbers / seen >= 0.8) return 'number';
  return 'text';
}

/* ── Agregación ───────────────────────────────────────────────────────── */

interface Acc {
  rows: number;
  nums: number[];
  distinct: Set<string>;
}

function newAcc(): Acc {
  return { rows: 0, nums: [], distinct: new Set() };
}

function feed(acc: Acc, agg: Agg, yCell: Cell | undefined) {
  acc.rows += 1;
  if (agg === 'count') return;
  if (agg === 'distinct') {
    if (!isEmpty(yCell)) acc.distinct.add(cellLabel(yCell));
    return;
  }
  const n = cellNumber(yCell);
  if (n !== null) acc.nums.push(n);
}

function finish(acc: Acc, agg: Agg): number | null {
  switch (agg) {
    case 'count':
      return acc.rows;
    case 'distinct':
      return acc.distinct.size;
    case 'sum':
      return acc.nums.length ? acc.nums.reduce((a, b) => a + b, 0) : null;
    case 'avg':
      return acc.nums.length ? acc.nums.reduce((a, b) => a + b, 0) / acc.nums.length : null;
    case 'min':
      return acc.nums.length ? Math.min(...acc.nums) : null;
    case 'max':
      return acc.nums.length ? Math.max(...acc.nums) : null;
    case 'median': {
      if (!acc.nums.length) return null;
      const s = [...acc.nums].sort((a, b) => a - b);
      const mid = Math.floor(s.length / 2);
      return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
    }
  }
}

const round = (n: number) => Math.round(n * 100) / 100;

function requireColumn(table: ParsedTable, name: string | null): string {
  if (!name || !table.headers.includes(name)) throw new StatsError('column_not_found', 404);
  return name;
}

/** ¿Todas las etiquetas son números o fechas? Entonces se ordenan de forma natural. */
function naturalOrder(labels: string[]): ((a: string, b: string) => number) | null {
  const real = labels.filter((l) => l !== EMPTY_LABEL);
  if (real.length === 0) return null;
  if (real.every((l) => /^\d{4}-\d{2}-\d{2}$/.test(l))) return (a, b) => a.localeCompare(b);
  if (real.every((l) => cellNumber(l) !== null)) return (a, b) => (cellNumber(a) ?? 0) - (cellNumber(b) ?? 0);
  return null;
}

function checkNumericY(table: ParsedTable, y: string) {
  let any = false;
  for (const row of table.rows) {
    if (cellNumber(row.values[y]) !== null) {
      any = true;
      break;
    }
  }
  if (!any) throw new StatsError('y_not_numeric', 422);
}

export function computeChart(table: ParsedTable, config: ChartConfig): ChartResult {
  const { type, agg } = config;
  const needsY = agg !== 'count';
  const y = needsY ? requireColumn(table, config.y) : null;
  if (y && agg !== 'distinct') checkNumericY(table, y);

  /* KPI: un único número sobre todas las filas. */
  if (type === 'kpi') {
    const acc = newAcc();
    for (const row of table.rows) feed(acc, agg, y ? row.values[y] : undefined);
    const v = finish(acc, agg);
    return { kind: 'kpi', value: v === null ? null : round(v) };
  }

  /* Dispersión: pares numéricos, sin agregar. */
  if (type === 'scatter') {
    const xCol = requireColumn(table, config.x);
    const yCol = requireColumn(table, config.y);
    const points: { x: number; y: number }[] = [];
    for (const row of table.rows) {
      const px = cellNumber(row.values[xCol]);
      const py = cellNumber(row.values[yCol]);
      if (px !== null && py !== null) points.push({ x: px, y: py });
    }
    if (!points.length) {
      let xAny = false;
      for (const row of table.rows) if (cellNumber(row.values[xCol]) !== null) { xAny = true; break; }
      throw new StatsError(xAny ? 'y_not_numeric' : 'x_not_numeric', 422);
    }
    const step = Math.ceil(points.length / MAX_SCATTER);
    const data = step > 1 ? points.filter((_, i) => i % step === 0) : points;
    return { kind: 'points', data, total: points.length, sampled: step > 1 };
  }

  const xCol = requireColumn(table, config.x);

  /* Apiladas: una serie por cada valor de «dividir por». */
  if (STACKED_TYPES.includes(type)) {
    const sCol = requireColumn(table, config.series);
    const cells = new Map<string, Map<string, Acc>>(); // etiqueta → serie → acumulador
    for (const row of table.rows) {
      const label = cellLabel(row.values[xCol]);
      const serie = cellLabel(row.values[sCol]);
      let bySerie = cells.get(label);
      if (!bySerie) cells.set(label, (bySerie = new Map()));
      let acc = bySerie.get(serie);
      if (!acc) bySerie.set(serie, (acc = newAcc()));
      feed(acc, agg, y ? row.values[y] : undefined);
    }

    const value = (label: string, serie: string) => {
      const acc = cells.get(label)?.get(serie);
      return acc ? (finish(acc, agg) ?? 0) : 0;
    };
    const serieTotals = new Map<string, number>();
    for (const [label, bySerie] of cells) {
      for (const serie of bySerie.keys()) serieTotals.set(serie, (serieTotals.get(serie) ?? 0) + Math.abs(value(label, serie)));
    }
    const rankedSeries = [...serieTotals.entries()].sort((a, b) => b[1] - a[1]).map(([s]) => s);
    const keys = rankedSeries.slice(0, MAX_SERIES);
    const hasOthers = rankedSeries.length > MAX_SERIES && STACKABLE_AGGS.includes(agg);
    const restKeys = rankedSeries.slice(MAX_SERIES);

    let labels = [...cells.keys()];
    const natural = naturalOrder(labels);
    const rowTotal = (l: string) => keys.reduce((s, k) => s + value(l, k), 0) + (hasOthers ? restKeys.reduce((s, k) => s + value(l, k), 0) : 0);
    if (ORDERED_TYPES.includes(type)) {
      if (natural) labels.sort(natural);
      labels = labels.slice(0, MAX_POINTS_LINE);
    } else {
      labels.sort((a, b) => rowTotal(b) - rowTotal(a));
      labels = labels.slice(0, config.limit);
    }

    const allKeys = hasOthers ? [...keys, OTHERS] : keys;
    const data = labels.map((label) => {
      const rec: Record<string, string | number> = { label };
      for (const k of keys) rec[k] = round(value(label, k));
      if (hasOthers) rec[OTHERS] = round(restKeys.reduce((s, k) => s + value(label, k), 0));
      return rec;
    });
    if (!data.length) throw new StatsError('no_data', 422);
    return { kind: 'multi', keys: allKeys, data, folded: hasOthers || cells.size > labels.length };
  }

  /* Resto: una serie de pares etiqueta → valor. */
  const groups = new Map<string, Acc>();
  for (const row of table.rows) {
    const label = cellLabel(row.values[xCol]);
    let acc = groups.get(label);
    if (!acc) groups.set(label, (acc = newAcc()));
    feed(acc, agg, y ? row.values[y] : undefined);
  }

  let entries = [...groups.entries()]
    .map(([label, acc]) => ({ label, value: finish(acc, agg) }))
    .filter((e): e is { label: string; value: number } => e.value !== null)
    .map((e) => ({ label: e.label, value: round(e.value) }));
  if (!entries.length) throw new StatsError('no_data', 422);

  const total = entries.length;
  let folded = false;

  if (ORDERED_TYPES.includes(type)) {
    const natural = naturalOrder(entries.map((e) => e.label));
    if (natural) entries.sort((a, b) => natural(a.label, b.label));
    entries = entries.slice(0, MAX_POINTS_LINE);
    folded = total > entries.length;
  } else {
    entries.sort((a, b) => b.value - a.value);
    // Colores sin repetir: como mucho 8 trozos en tarta/donut (7 + «Otros» si se suma).
    const additive = STACKABLE_AGGS.includes(agg);
    const cap =
      type === 'radar'
        ? Math.min(config.limit, 12)
        : type === 'pie' || type === 'donut'
          ? Math.min(config.limit, additive ? 7 : 8)
          : config.limit;
    if (entries.length > cap) {
      const rest = entries.slice(cap);
      entries = entries.slice(0, cap);
      folded = true;
      // «Otros» solo tiene sentido en cifras que se pueden sumar y en repartos.
      if (STACKABLE_AGGS.includes(agg) && ['pie', 'donut', 'bar', 'hbar'].includes(type)) {
        entries.push({ label: OTHERS, value: round(rest.reduce((s, e) => s + e.value, 0)) });
      }
    }
  }
  return { kind: 'series', data: entries, folded };
}
