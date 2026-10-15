import { localRows, LocalAgentError, LOCAL_ERROR_TEXT } from '@/lib/agents/local-api';

/** Tope de filas y columnas del detalle (el agente y el servidor usan los mismos). */
export const ALERT_ROWS_MAX = 200;
export const ALERT_ROWS_COLS = 40;

export interface AlertRowsData {
  fileName: string;
  sheet: string | null;
  headers: string[];
  rows: { n: number; cells: string[] }[];
  missing: number[];
  moreColumns: boolean;
  /** Filas totales de la alerta (puede haber más de las que se muestran). */
  total: number;
  /** Columnas que usa la regla. */
  highlight: string[];
}

export type AlertRowsResponse =
  | ({ mode: 'data' } & AlertRowsData)
  | { mode: 'local'; fileId: string; sheet: string | null; rows: number[]; total: number; highlight: string[] };

export const ALERT_ROWS_ERRORS: Record<string, string> = {
  not_found: 'Esta alerta ya no está disponible.',
  sheet_not_found: 'La hoja de esta alerta ya no existe en el archivo.',
  google_not_connected: 'Google Drive está desconectado: hay que volver a conectarlo para leer el archivo.',
  file_not_accessible: 'Ya no hay acceso al archivo en Google Drive.',
  file_too_large: 'El archivo es demasiado grande para leerlo.',
  read_error: 'No se pudo leer el archivo. Inténtalo de nuevo.',
};

export class AlertRowsError extends Error {}

/** Carga las filas de una alerta: del servidor (Drive) o, si el archivo es local, del agente de este PC. */
export async function loadAlertRows(alertId: string): Promise<AlertRowsData> {
  const res = await fetch('/api/alerts/rows', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ alertId }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new AlertRowsError(ALERT_ROWS_ERRORS[body.error] ?? ALERT_ROWS_ERRORS.read_error);
  const r = body as AlertRowsResponse;
  if (r.mode === 'data') return r;
  if (!r.rows.length) {
    return { fileName: '', sheet: r.sheet, headers: [], rows: [], missing: [], moreColumns: false, total: r.total, highlight: r.highlight };
  }
  try {
    const d = await localRows(r.fileId, r.sheet, r.rows);
    return { ...d, total: r.total, highlight: r.highlight };
  } catch (e) {
    if (e instanceof LocalAgentError) {
      throw new AlertRowsError(
        e.code === 'not_found'
          ? 'Este archivo está en otro ordenador. El contenido de las filas solo se ve desde el equipo donde está el archivo y su agente.'
          : LOCAL_ERROR_TEXT[e.code],
      );
    }
    throw new AlertRowsError('El agente no pudo leer las filas.');
  }
}

/**
 * Cómo se identifica una fila: los valores de sus primeras columnas con contenido, p. ej. «1042 / Marta Ruiz / ACME».
 * Si la fila no tiene datos, queda «Fila N».
 */
export function rowLabel(headers: string[], cells: string[], n: number, count = 3): string {
  const parts: string[] = [];
  for (let i = 0; i < headers.length && parts.length < count; i++) {
    const v = (cells[i] ?? '').trim();
    if (v) parts.push(v.length > 40 ? `${v.slice(0, 39)}…` : v);
  }
  return parts.length ? parts.join(' / ') : `Fila ${n}`;
}

/** Columnas a mostrar por defecto: las primeras 4 y las que usa la regla (en el orden del archivo). */
export function defaultColumns(headers: string[], highlight: string[], first = 4): number[] {
  const out = new Set<number>();
  for (let i = 0; i < Math.min(first, headers.length); i++) out.add(i);
  headers.forEach((h, i) => highlight.includes(h) && out.add(i));
  return [...out].sort((a, b) => a - b);
}
