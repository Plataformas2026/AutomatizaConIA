const full = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 });
const compact = new Intl.NumberFormat('es-ES', { notation: 'compact', maximumFractionDigits: 1 });

export function fmt(n: number | string | undefined | null): string {
  return typeof n === 'number' && Number.isFinite(n) ? full.format(n) : String(n ?? '');
}

export function fmtCompact(n: number | string): string {
  return typeof n === 'number' ? compact.format(n) : String(n);
}

export function truncate(s: string | number, max = 14): string {
  const t = String(s);
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** Colores de serie, en orden fijo (paleta validada); se definen en globals.css. */
export const SERIES = [
  'var(--c1)',
  'var(--c2)',
  'var(--c3)',
  'var(--c4)',
  'var(--c5)',
  'var(--c6)',
  'var(--c7)',
  'var(--c8)',
] as const;
