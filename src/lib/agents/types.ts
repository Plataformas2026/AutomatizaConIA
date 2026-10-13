import { z } from 'zod';

/** Compartido entre cliente y servidor. */
export const MAX_AGENTS = 5;
export const MAX_LOCAL_FILES_PER_REQUEST = 50;
/** Un agente cuenta como «conectado» si ha dado señales en los últimos 2 minutos. */
export const ONLINE_WINDOW_MS = 2 * 60 * 1000;

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
/** Extensiones que sabe leer el agente → tipo MIME que se guarda. */
export const LOCAL_MIME_BY_EXT: Record<string, string> = {
  xlsx: XLSX_MIME,
  xlsm: XLSX_MIME,
  xls: 'application/vnd.ms-excel',
  csv: 'text/csv',
};

export function extensionOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i < 0 ? '' : name.slice(i + 1).toLowerCase();
}

/** Último tramo de una ruta de Windows o Linux. */
export function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? '';
}

export const agentNameSchema = z.string().trim().min(1).max(60);

/** Ruta opcional: sin caracteres de control y con el mismo nombre de archivo. */
export const localPathSchema = z
  .string()
  .trim()
  .max(500)
  // eslint-disable-next-line no-control-regex
  .refine((p) => !/[\u0000-\u001f]/.test(p), 'control');

export const localFilesSchema = z.object({
  agentId: z.string().uuid(),
  projectId: z.string().uuid().nullable().optional(),
  files: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(200),
        path: localPathSchema.nullable().optional(),
      }),
    )
    .min(1)
    .max(MAX_LOCAL_FILES_PER_REQUEST),
});

export interface AgentCard {
  id: string;
  name: string;
  online: boolean;
  lastSeenLabel: string;
  version: string | null;
  fileCount: number;
}

export const AGENT_ERRORS: Record<string, string> = {
  name: 'Escribe un nombre de entre 1 y 60 caracteres.',
  too_many_agents: `Has llegado al máximo de ${MAX_AGENTS} agentes.`,
  db_error: 'No se pudo guardar. Inténtalo de nuevo.',
  agent_not_found: 'Ese agente ya no existe.',
  project_not_found: 'El proyecto de destino ya no existe.',
  invalid_body: 'Revisa los datos: alguno no es válido.',
};

/** Hace «hace 3 min», «hace 2 h»… a partir de una fecha ISO. */
export function relativeTimeEs(iso: string | null, now = Date.now()): string {
  if (!iso) return 'nunca';
  const diff = Math.max(0, now - new Date(iso).getTime());
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'hace unos segundos';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'hace 1 día' : `hace ${d} días`;
}
