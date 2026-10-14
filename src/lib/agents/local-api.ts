/**
 * Comunicación del navegador con el agente de TU ordenador (127.0.0.1). Los datos de la vista previa
 * van del agente a tu navegador: no pasan por Supabase ni por Vercel y no se guardan en ningún sitio.
 */
export const LOCAL_API_PORT = 47821; // el mismo valor que agent/localapi.py (DEFAULT_PORT)
export const LOCAL_API_BASE = `http://127.0.0.1:${LOCAL_API_PORT}`;

export interface PreviewData {
  fileName: string;
  /** Todas las hojas del archivo ([] en CSV). */
  sheets: string[];
  /** Hoja mostrada (null en CSV). */
  sheet: string | null;
  headers: string[];
  rows: { n: number; cells: string[] }[];
  totalRows: number;
  /** Hay más filas o columnas de las que se muestran. */
  truncated: boolean;
}

export type LocalErrorCode = 'unreachable' | 'forbidden' | 'not_found' | 'busy' | 'unreadable' | 'too_big' | 'unsupported' | 'error';

export class LocalAgentError extends Error {
  constructor(public code: LocalErrorCode) {
    super(code);
  }
}

export const LOCAL_ERROR_TEXT: Record<LocalErrorCode, string> = {
  unreachable:
    'No se pudo contactar con el agente de tu ordenador. Comprueba que está en marcha, que usas Chrome o Edge en ese mismo equipo y que has permitido el acceso a dispositivos de la red local si el navegador lo pide.',
  forbidden:
    'El agente no reconoce esta web. Añade a su archivo .env la línea WEB_ORIGIN con la dirección exacta de esta aplicación y reinícialo.',
  not_found: 'El agente todavía no ha localizado este archivo en tu ordenador. Espera unos segundos y vuelve a intentarlo.',
  busy: 'El archivo está abierto o bloqueado por otro programa. Ciérralo o espera un momento.',
  unreadable: 'No se pudo leer el archivo (¿está dañado o protegido con contraseña?).',
  too_big: 'El archivo es demasiado grande para la vista previa.',
  unsupported: 'Esta acción solo está disponible en Windows.',
  error: 'El agente no pudo completar la acción.',
};

const BY_STATUS: Record<number, LocalErrorCode> = {
  403: 'forbidden',
  404: 'not_found',
  413: 'too_big',
  422: 'unreadable',
  423: 'busy',
  501: 'unsupported',
};

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${LOCAL_API_BASE}${path}`, {
      ...init,
      cache: 'no-store',
      headers: { 'X-Automatiza': '1', ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new LocalAgentError('unreachable');
  }
  if (!res.ok) throw new LocalAgentError(BY_STATUS[res.status] ?? 'error');
  return (await res.json()) as T;
}

export function localPreview(fileId: string, sheet?: string): Promise<PreviewData> {
  const q = new URLSearchParams({ file: fileId });
  if (sheet) q.set('sheet', sheet);
  return call<PreviewData>(`/v1/preview?${q.toString()}`);
}

/** Abre la carpeta del archivo (con el archivo seleccionado) o el propio archivo, en tu ordenador. */
export function localOpen(fileId: string, what: 'folder' | 'file'): Promise<{ ok: true }> {
  return call('/v1/open', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file: fileId, what }),
  });
}
