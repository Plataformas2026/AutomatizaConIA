import { z } from 'zod';

/* Módulo compartido (cliente y servidor): catálogo de gráficas, agregaciones
   y el esquema de configuración que se guarda en la base de datos. */

export const CHART_TYPES = [
  'bar',
  'hbar',
  'stacked_bar',
  'line',
  'area',
  'stacked_area',
  'pie',
  'donut',
  'radar',
  'scatter',
  'kpi',
  'table',
] as const;
export type ChartType = (typeof CHART_TYPES)[number];

export interface ChartTypeInfo {
  type: ChartType;
  label: string;
  group: 'Comparar' | 'Evolución' | 'Reparto' | 'Relación' | 'Resumen';
  hint: string;
  /** Etiqueta del desplegable del eje X para este tipo. */
  xLabel: string;
}

export const CHART_CATALOG: ChartTypeInfo[] = [
  { type: 'bar', label: 'Barras', group: 'Comparar', hint: 'Compara un valor entre categorías.', xLabel: 'Eje X (categorías)' },
  { type: 'hbar', label: 'Barras horizontales', group: 'Comparar', hint: 'Como las barras, pero mejor con nombres largos.', xLabel: 'Eje X (categorías)' },
  { type: 'stacked_bar', label: 'Barras apiladas', group: 'Comparar', hint: 'Cada barra se divide en partes según otra columna.', xLabel: 'Eje X (categorías)' },
  { type: 'line', label: 'Líneas', group: 'Evolución', hint: 'Muestra cómo cambia un valor (fechas, meses, números).', xLabel: 'Eje X (orden)' },
  { type: 'area', label: 'Área', group: 'Evolución', hint: 'Una línea con el área rellena: destaca el volumen.', xLabel: 'Eje X (orden)' },
  { type: 'stacked_area', label: 'Área apilada', group: 'Evolución', hint: 'Evolución dividida en partes según otra columna.', xLabel: 'Eje X (orden)' },
  { type: 'pie', label: 'Tarta', group: 'Reparto', hint: 'Qué parte del total aporta cada categoría.', xLabel: 'Categorías' },
  { type: 'donut', label: 'Donut', group: 'Reparto', hint: 'Una tarta con hueco: deja sitio para el total.', xLabel: 'Categorías' },
  { type: 'radar', label: 'Radar', group: 'Reparto', hint: 'Compara varias categorías a la vez en forma de red.', xLabel: 'Categorías (ejes)' },
  { type: 'scatter', label: 'Dispersión', group: 'Relación', hint: 'Cada fila es un punto: ver si dos números se relacionan.', xLabel: 'Eje X (número)' },
  { type: 'kpi', label: 'Métrica KPI', group: 'Resumen', hint: 'Un único número destacado (total, media, recuento…).', xLabel: '' },
  { type: 'table', label: 'Tabla resumen', group: 'Resumen', hint: 'Una fila por grupo con su valor y su porcentaje.', xLabel: 'Agrupar por' },
];

export const CHART_GROUPS = ['Comparar', 'Evolución', 'Reparto', 'Relación', 'Resumen'] as const;

export function chartInfo(type: ChartType): ChartTypeInfo {
  return CHART_CATALOG.find((c) => c.type === type) ?? CHART_CATALOG[0];
}

export const AGGS = ['count', 'sum', 'avg', 'median', 'min', 'max', 'distinct'] as const;
export type Agg = (typeof AGGS)[number];

export const AGG_LABELS: Record<Agg, string> = {
  count: 'Contar filas',
  sum: 'Suma',
  avg: 'Promedio',
  median: 'Mediana',
  min: 'Mínimo',
  max: 'Máximo',
  distinct: 'Valores distintos',
};

/** Agregaciones que necesitan una columna numérica. */
export const NUMERIC_AGGS: Agg[] = ['sum', 'avg', 'median', 'min', 'max'];
/** Las que se pueden apilar/sumar entre grupos sin perder sentido. */
export const STACKABLE_AGGS: Agg[] = ['count', 'sum'];

export const STACKED_TYPES: ChartType[] = ['stacked_bar', 'stacked_area'];
export const ORDERED_TYPES: ChartType[] = ['line', 'area', 'stacked_area'];

export function allowedAggs(type: ChartType): readonly Agg[] {
  if (type === 'scatter') return [];
  return STACKED_TYPES.includes(type) ? STACKABLE_AGGS : AGGS;
}

export const MAX_CHARTS = 20;
export const LIMIT_OPTIONS = [5, 8, 10, 15, 20, 30, 50] as const;

const columnName = z.string().trim().min(1).max(200);

export const chartConfigSchema = z
  .object({
    type: z.enum(CHART_TYPES),
    title: z.string().trim().max(80).default(''),
    fileId: z.string().uuid(),
    /** null en CSV (no tienen hojas). */
    sheet: z.string().min(1).max(200).nullable().default(null),
    x: columnName.nullable().default(null),
    y: columnName.nullable().default(null),
    agg: z.enum(AGGS).default('count'),
    /** «Dividir por»: solo en las gráficas apiladas. */
    series: columnName.nullable().default(null),
    limit: z.number().int().min(3).max(50).default(10),
    size: z.enum(['normal', 'wide']).default('normal'),
  })
  .superRefine((c, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });

    if (c.type === 'kpi') {
      if (c.agg !== 'count' && !c.y) issue('y', 'Elige la columna del valor.');
      return;
    }
    if (c.type === 'scatter') {
      if (!c.x) issue('x', 'Elige la columna del eje X.');
      if (!c.y) issue('y', 'Elige la columna del eje Y.');
      return;
    }
    if (!c.x) issue('x', 'Elige la columna del eje X.');
    if (c.agg !== 'count' && !c.y) issue('y', 'Elige la columna del eje Y.');
    if (STACKED_TYPES.includes(c.type)) {
      if (!c.series) issue('series', 'Elige por qué columna dividir.');
      if (!STACKABLE_AGGS.includes(c.agg)) issue('agg', 'Las gráficas apiladas admiten Contar filas o Suma.');
    }
  });

export type ChartConfig = z.infer<typeof chartConfigSchema>;

/** Título automático cuando el usuario no escribe uno. */
export function autoTitle(c: Pick<ChartConfig, 'type' | 'x' | 'y' | 'agg' | 'series'>): string {
  const what =
    c.agg === 'count' ? 'Filas' : `${AGG_LABELS[c.agg]} de ${c.y ?? '…'}`;
  if (c.type === 'kpi') return what;
  if (c.type === 'scatter') return `${c.y ?? '…'} según ${c.x ?? '…'}`;
  const split = c.series && STACKED_TYPES.includes(c.type) ? ` y ${c.series}` : '';
  return `${what} por ${c.x ?? '…'}${split}`;
}

export function displayTitle(c: ChartConfig): string {
  return c.title.trim() || autoTitle(c);
}

/* ── Resultados (ya agregados: nunca contienen filas del archivo) ─────── */

export type ChartResult =
  | { kind: 'series'; data: { label: string; value: number }[]; folded: boolean }
  | { kind: 'multi'; keys: string[]; data: Record<string, string | number>[]; folded: boolean }
  | { kind: 'points'; data: { x: number; y: number }[]; total: number; sampled: boolean }
  | { kind: 'kpi'; value: number | null };

export type ColumnKind = 'number' | 'date' | 'text';

export interface StructureSheet {
  name: string | null;
  rows: number;
  columns: { name: string; kind: ColumnKind }[];
}

export interface QueryItemResult {
  result?: ChartResult;
  error?: string;
}

export const ERROR_MESSAGES: Record<string, string> = {
  file_not_found: 'El archivo ya no está compartido.',
  file_not_accessible: 'No tenemos acceso a este archivo en tu Drive.',
  file_too_large: 'El archivo es demasiado grande para leerlo.',
  google_not_connected: 'Tu Google Drive está desconectado. Reconéctalo desde el Dashboard.',
  google_error: 'Google no respondió. Inténtalo de nuevo en unos segundos.',
  sheet_not_found: 'La hoja elegida ya no existe en el archivo.',
  column_not_found: 'Alguna de las columnas elegidas ya no existe en el archivo.',
  y_not_numeric: 'La columna del eje Y no contiene números.',
  x_not_numeric: 'La columna del eje X no contiene números.',
  no_data: 'No hay datos para mostrar con esta configuración.',
  invalid_config: 'La configuración de la gráfica no es válida.',
  read_error: 'No se pudo leer el archivo.',
};
