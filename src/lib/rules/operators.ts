// Sin dependencias: se importa tanto desde el servidor como desde el cliente.

export const OPERATORS = [
  'gt',
  'gte',
  'lt',
  'lte',
  'eq',
  'neq',
  'contains',
  'not_contains',
  'starts_with',
  'is_empty',
  'is_not_empty',
  // Solo para columnas de fecha:
  'elapsed',
  'on_date',
] as const;

export type Operator = (typeof OPERATORS)[number];

export const OPERATOR_LABELS: Record<Operator, string> = {
  gt: 'es mayor que',
  gte: 'es mayor o igual que',
  lt: 'es menor que',
  lte: 'es menor o igual que',
  eq: 'es igual a',
  neq: 'es distinto de',
  contains: 'contiene',
  not_contains: 'no contiene',
  starts_with: 'empieza por',
  is_empty: 'está vacío',
  is_not_empty: 'no está vacío',
  elapsed: 'ha pasado al menos…',
  on_date: 'ya llegó la fecha elegida',
};

/** Operadores que no necesitan segundo operando. */
export const UNARY_OPERATORS: readonly Operator[] = ['is_empty', 'is_not_empty'];

export function isUnary(op: Operator): boolean {
  return UNARY_OPERATORS.includes(op);
}

/** Operadores que solo tienen sentido en columnas de fecha (dependen del día de hoy). */
export const DATE_OPERATORS: readonly Operator[] = ['elapsed', 'on_date'];

export function isDateOperator(op: Operator): boolean {
  return DATE_OPERATORS.includes(op);
}

/** Unidad del operador «ha pasado al menos…». */
export const TIME_UNITS = ['days', 'weeks', 'months', 'years'] as const;
export type TimeUnit = (typeof TIME_UNITS)[number];
export const TIME_UNIT_LABELS: Record<TimeUnit, string> = {
  days: 'días',
  weeks: 'semanas',
  months: 'meses',
  years: 'años',
};
export const MAX_ELAPSED = 3650;
