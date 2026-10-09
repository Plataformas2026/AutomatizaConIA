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
};

/** Operadores que no necesitan segundo operando. */
export const UNARY_OPERATORS: readonly Operator[] = ['is_empty', 'is_not_empty'];

export function isUnary(op: Operator): boolean {
  return UNARY_OPERATORS.includes(op);
}
