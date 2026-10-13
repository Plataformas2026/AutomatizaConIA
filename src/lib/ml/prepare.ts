import type { Cell, ParsedTable } from '@/lib/parsing/parse';
import { cellLabel, cellNumber, inferKind, StatsError } from '@/lib/stats/compute';
import { median } from './util';

/**
 * Convierte columnas de la hoja en una matriz numérica:
 *  - números y fechas → una columna (los huecos se rellenan con la mediana)
 *  - texto → una columna 0/1 por categoría frecuente (máx. 8)
 * Todo en memoria: nada de esto se guarda.
 */

export interface SourceCol {
  column: string;
  kind: 'number' | 'date' | 'text';
  /** Índices de la matriz expandida que salen de esta columna. */
  cols: number[];
}

export interface Design {
  sources: SourceCol[];
  names: string[];
  isDummy: boolean[];
  /** Fila × columna expandida. */
  X: number[][];
  /** Nº de fila en la hoja del usuario. */
  rows: number[];
}

const MAX_CATEGORIES = 8;
const DAY = 86_400_000;

function numeric(cell: Cell | undefined, kind: 'number' | 'date'): number | null {
  if (kind === 'date') return cell instanceof Date && !Number.isNaN(cell.getTime()) ? cell.getTime() / DAY : null;
  return cellNumber(cell);
}

export function buildDesign(
  table: ParsedTable,
  columns: string[],
  rowIdx: number[],
  notes: string[],
  opts: { numericOnly?: boolean } = {},
): Design {
  const sources: SourceCol[] = [];
  const names: string[] = [];
  const isDummy: boolean[] = [];
  const colsData: number[][] = []; // columna expandida → valores por fila usada

  for (const column of columns) {
    if (!table.headers.includes(column)) continue;
    const kind = inferKind(table, column);

    if (kind === 'number' || kind === 'date') {
      const raw = rowIdx.map((i) => numeric(table.rows[i].values[column], kind));
      const present = raw.filter((v): v is number => v !== null);
      if (present.length === 0) {
        notes.push(`«${column}» se ha omitido: no tiene valores.`);
        continue;
      }
      const fill = median(present);
      const values = raw.map((v) => v ?? fill);
      if (values.every((v) => v === values[0])) {
        notes.push(`«${column}» se ha omitido: tiene siempre el mismo valor.`);
        continue;
      }
      sources.push({ column, kind, cols: [names.length] });
      names.push(column);
      isDummy.push(false);
      colsData.push(values);
      continue;
    }

    if (opts.numericOnly) {
      notes.push(`«${column}» se ha omitido: aquí solo se revisan columnas con números.`);
      continue;
    }

    const labels = rowIdx.map((i) => cellLabel(table.rows[i].values[column]));
    const counts = new Map<string, number>();
    for (const l of labels) counts.set(l, (counts.get(l) ?? 0) + 1);
    const distinct = counts.size;
    if (distinct < 2) {
      notes.push(`«${column}» se ha omitido: tiene siempre el mismo valor.`);
      continue;
    }
    if (distinct > 20 && distinct / labels.length > 0.9) {
      notes.push(`«${column}» se ha omitido: parece un identificador (casi todos sus valores son distintos).`);
      continue;
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_CATEGORIES).map(([l]) => l);
    const cols: number[] = [];
    for (const category of top) {
      cols.push(names.length);
      names.push(`${column} = ${category}`);
      isDummy.push(true);
      colsData.push(labels.map((l) => (l === category ? 1 : 0)));
    }
    sources.push({ column, kind: 'text', cols });
  }

  if (!sources.length) throw new StatsError('no_usable_features', 422);

  const X = rowIdx.map((_, r) => colsData.map((c) => c[r]));
  return { sources, names, isDummy, X, rows: rowIdx.map((i) => table.rows[i].rowNumber) };
}
