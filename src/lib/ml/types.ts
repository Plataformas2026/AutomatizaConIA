import { z } from 'zod';

/* Módulo compartido (cliente y servidor): tareas de ML, configuración y resultados. */

export const ML_TASKS = ['regression', 'classification', 'anomaly', 'clustering'] as const;
export type MlTask = (typeof ML_TASKS)[number];

export interface MlTaskInfo {
  task: MlTask;
  label: string;
  /** Cómo lo diría una persona sin formación técnica. */
  plain: string;
  example: string;
  supervised: boolean;
  /** Color de acento de la tarjeta (token CSS). */
  accent: string;
}

export const ML_TASK_INFO: MlTaskInfo[] = [
  {
    task: 'regression',
    label: 'Regresión',
    plain: 'Predecir un número',
    example: 'Ej.: cuánto venderemos, cuánto costará un pedido.',
    supervised: true,
    accent: 'var(--violet)',
  },
  {
    task: 'classification',
    label: 'Clasificación',
    plain: 'Predecir una categoría',
    example: 'Ej.: riesgo alto o bajo, tipo de cliente.',
    supervised: true,
    accent: 'var(--teal)',
  },
  {
    task: 'anomaly',
    label: 'Detección de anomalías',
    plain: 'Encontrar valores raros',
    example: 'Ej.: importes fuera de lo normal, posibles errores.',
    supervised: false,
    accent: 'var(--coral)',
  },
  {
    task: 'clustering',
    label: 'Agrupamiento (clustering)',
    plain: 'Descubrir grupos parecidos',
    example: 'Ej.: segmentos de clientes o de productos.',
    supervised: false,
    accent: 'var(--amber)',
  },
];

export function taskInfo(task: MlTask): MlTaskInfo {
  return ML_TASK_INFO.find((t) => t.task === task) ?? ML_TASK_INFO[0];
}

export const ML_ALGORITHMS = ['auto', 'linear', 'tree', 'forest'] as const;
export type MlAlgorithm = (typeof ML_ALGORITHMS)[number];

export const ALGORITHM_LABELS: Record<MlAlgorithm, string> = {
  auto: 'Automático (recomendado)',
  linear: 'Regresión lineal múltiple',
  tree: 'Árbol de decisión',
  forest: 'Bosque de árboles',
};

export const ALGORITHM_HINTS: Record<MlAlgorithm, string> = {
  auto: 'Prueba los métodos disponibles y se queda con el que mejor acierta.',
  linear: 'Busca una fórmula sencilla (suma ponderada). Rápido y fácil de explicar.',
  tree: 'Hace preguntas encadenadas (¿es mayor que…?). Capta relaciones que no son una recta.',
  forest: 'Muchos árboles votan a la vez. Suele acertar más y es más estable.',
};

export const SENSITIVITIES = ['low', 'normal', 'high'] as const;
export type Sensitivity = (typeof SENSITIVITIES)[number];
export const SENSITIVITY_LABELS: Record<Sensitivity, string> = {
  low: 'Baja: solo lo muy raro',
  normal: 'Normal (recomendada)',
  high: 'Alta: también lo dudoso',
};

export const ANOMALY_METHODS = ['iqr', 'zscore'] as const;
export type AnomalyMethod = (typeof ANOMALY_METHODS)[number];
export const ANOMALY_METHOD_LABELS: Record<AnomalyMethod, string> = {
  iqr: 'Rango entre cuartiles (IQR)',
  zscore: 'Desviación típica (Z-score)',
};
export const ANOMALY_METHOD_HINTS: Record<AnomalyMethod, string> = {
  iqr: 'Marca lo que queda muy lejos del grueso de los datos. Aguanta bien los valores extremos.',
  zscore: 'Marca lo que se aleja mucho de la media. Mejor cuando los datos se reparten de forma pareja.',
};

export const MAX_FEATURES = 30;
export const MIN_ROWS = 30;
export const TRAIN_OPTIONS = [60, 70, 75, 80, 85, 90] as const;
export const DEPTH_OPTIONS = [
  { value: 3, label: 'Simple' },
  { value: 5, label: 'Equilibrado' },
  { value: 8, label: 'Detallado' },
] as const;
export const CLUSTER_OPTIONS = [2, 3, 4, 5, 6, 7, 8] as const;

const col = z.string().trim().min(1).max(200);

export const mlConfigSchema = z
  .object({
    task: z.enum(ML_TASKS),
    title: z.string().trim().max(80).default(''),
    fileId: z.string().uuid(),
    sheet: z.string().min(1).max(200).nullable().default(null),
    target: col.nullable().default(null),
    features: z.array(col).max(MAX_FEATURES).default([]),
    algorithm: z.enum(ML_ALGORITHMS).default('auto'),
    trainPct: z.number().int().min(50).max(95).default(80),
    depth: z.number().int().min(2).max(12).default(5),
    anomalyMethod: z.enum(ANOMALY_METHODS).default('iqr'),
    sensitivity: z.enum(SENSITIVITIES).default('normal'),
    /** null = el sistema elige el número de grupos. */
    clusters: z.number().int().min(2).max(8).nullable().default(null),
  })
  .superRefine((c, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
    const supervised = c.task === 'regression' || c.task === 'classification';
    if (supervised) {
      if (!c.target) issue('target', 'Elige qué quieres predecir.');
      if (c.target && c.features.includes(c.target)) issue('features', 'Lo que predices no puede usarse también como dato de entrada.');
      if (c.features.length < 1) issue('features', 'Marca al menos una columna para predecir.');
    } else if (c.task === 'anomaly') {
      if (c.features.length < 1) issue('features', 'Marca al menos una columna numérica que revisar.');
    } else if (c.features.length < 2) {
      issue('features', 'Marca al menos dos columnas para agrupar.');
    }
  });

export type MlConfig = z.infer<typeof mlConfigSchema>;

export function autoMlTitle(c: Pick<MlConfig, 'task' | 'target' | 'features'>): string {
  switch (c.task) {
    case 'regression':
      return `Predicción de ${c.target ?? '…'}`;
    case 'classification':
      return `Clasificación de ${c.target ?? '…'}`;
    case 'anomaly':
      return 'Valores atípicos';
    case 'clustering':
      return 'Grupos de filas parecidas';
  }
}

export function mlTitle(c: MlConfig): string {
  return c.title.trim() || autoMlTitle(c);
}

/* ── Resultados ───────────────────────────────────────────────────────── */

export type Quality = 'good' | 'ok' | 'weak';
export const QUALITY_LABELS: Record<Quality, string> = { good: 'Fiable', ok: 'Aceptable', weak: 'Poco fiable' };

export interface Insight {
  tone: 'good' | 'warn' | 'info';
  text: string;
}

interface Base {
  rowsTotal: number;
  rowsUsed: number;
  /** Columnas que han intervenido de verdad en el análisis. */
  features: string[];
  notes: string[];
  insights: Insight[];
}

export interface Importance {
  feature: string;
  /** Porcentaje del total (suma 100). */
  value: number;
}

export interface RegressionResult extends Base {
  task: 'regression';
  algorithm: Exclude<MlAlgorithm, 'auto'>;
  algorithmLabel: string;
  target: string;
  trainRows: number;
  testRows: number;
  metrics: { rmse: number; mae: number; r2: number; baselineRmse: number; targetMean: number };
  quality: Quality;
  importance: Importance[];
  points: { actual: number; predicted: number }[];
}

export interface ClassificationResult extends Base {
  task: 'classification';
  algorithm: Exclude<MlAlgorithm, 'auto'>;
  algorithmLabel: string;
  target: string;
  trainRows: number;
  testRows: number;
  metrics: { accuracy: number; baseline: number };
  quality: Quality;
  classes: string[];
  /** confusion[real][predicho] */
  confusion: number[][];
  perClass: { label: string; precision: number; recall: number; support: number }[];
  importance: Importance[];
}

export interface AnomalyItem {
  row: number;
  column: string;
  /** null si el valor no está disponible. */
  value: number | null;
  score: number;
  direction: 'alto' | 'bajo';
}

export interface AnomalyResult extends Base {
  task: 'anomaly';
  method: AnomalyMethod;
  sensitivity: Sensitivity;
  flagged: number;
  pct: number;
  columns: { column: string; low: number; high: number; flagged: number; method: AnomalyMethod }[];
  items: AnomalyItem[];
  flaggedRows: number[];
  series: { column: string; low: number; high: number; points: { x: number; y: number; flagged: boolean }[] }[];
}

export interface ClusterInfo {
  id: number;
  size: number;
  pct: number;
  name: string;
  description: string;
  traits: { feature: string; mean: number | null; overall: number | null; level: 'alto' | 'bajo'; text: string }[];
}

export interface ClusteringResult extends Base {
  task: 'clustering';
  k: number;
  auto: boolean;
  silhouette: number;
  quality: Quality;
  clusters: ClusterInfo[];
  projection: { x: number; y: number; cluster: number }[];
  explained: number;
  assignments: { row: number; cluster: number }[];
  kScores: { k: number; silhouette: number }[];
}

export type MlResult = RegressionResult | ClassificationResult | AnomalyResult | ClusteringResult;

export const ML_ERROR_MESSAGES: Record<string, string> = {
  target_not_numeric: 'La columna que quieres predecir no contiene números. Prueba con «Clasificación» o elige otra columna.',
  target_too_many_classes: 'Esa columna tiene demasiados valores distintos para usarla como categoría. Prueba con «Regresión» o elige otra.',
  single_class: 'Esa columna casi siempre tiene el mismo valor: no hay nada que distinguir.',
  too_few_rows: 'Hacen falta al menos 30 filas con datos completos para entrenar con fiabilidad.',
  no_usable_features: 'Ninguna de las columnas elegidas sirve para el análisis (están vacías, son constantes o son identificadores).',
  no_numeric_columns: 'Para buscar valores raros hacen falta columnas con números.',
  invalid_config: 'La configuración del análisis no es válida.',
};
