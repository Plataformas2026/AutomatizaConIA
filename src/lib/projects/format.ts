import type { FileItem } from './types';

export interface FileRowDb {
  id: string;
  name: string;
  mime_type: string;
  sheet_mode: string;
  sheet_names: string[] | null;
  status: string;
  last_checked_at: string | null;
  last_error: string | null;
  project_id: string | null;
  source: string | null;
}

export const FILE_COLUMNS = 'id, name, mime_type, sheet_mode, sheet_names, status, last_checked_at, last_error, project_id, source';

function sheetsLabel(mode: string, names: string[] | null): string {
  if (mode === 'all') return 'Todas las hojas';
  if (mode === 'selected' && names?.length) {
    return names.length === 1 ? `Hoja «${names[0]}»` : `${names.length} hojas`;
  }
  return 'Primera hoja';
}

/** Filas de BD → datos listos para la lista (fechas ya formateadas en el servidor). */
export function toFileItem(f: FileRowDb): FileItem {
  return {
    id: f.id,
    name: f.name,
    mimeType: f.mime_type,
    status: f.status,
    sheetsLabel: f.mime_type === 'text/csv' ? null : sheetsLabel(f.sheet_mode, f.sheet_names),
    checkedLabel: f.last_checked_at
      ? `Última comprobación: ${new Date(f.last_checked_at).toLocaleString('es-ES')}`
      : f.source === 'local'
        ? 'Esperando al agente de tu ordenador…'
        : 'Aún sin comprobar',
    lastError: f.last_error,
    projectId: f.project_id,
    source: f.source === 'local' ? 'local' : 'drive',
  };
}
