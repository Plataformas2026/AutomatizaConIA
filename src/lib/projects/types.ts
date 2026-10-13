import { z } from 'zod';

/** Compartido entre cliente y servidor (sin dependencias de servidor). */
export const MAX_PROJECTS = 40;
export const MAX_MOVE_FILES = 200;
export const COVER_MAX_CHARS = 200_000;

export const projectNameSchema = z.string().trim().min(1, 'name').max(60, 'name');

/** Portada: JPEG en data-URL, ya reducido por el navegador. */
export const coverSchema = z
  .string()
  .max(COVER_MAX_CHARS)
  .regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/);

export interface ProjectCard {
  id: string;
  name: string;
  cover: string | null;
  fileCount: number;
}

export interface ProjectOption {
  id: string;
  name: string;
}

export interface FileItem {
  id: string;
  name: string;
  mimeType: string;
  status: string;
  sheetsLabel: string | null; // null en CSV
  checkedLabel: string;
  lastError: string | null;
  projectId: string | null;
  /** 'local' = archivo del ordenador, vigilado por el agente (no está en Drive). */
  source: 'drive' | 'local';
}

/** Tipo MIME del arrastre de archivos (dashboard → tarjeta de proyecto). */
export const DRAG_MIME = 'application/x-aci-files';

export const PROJECT_ERRORS: Record<string, string> = {
  name: 'Escribe un nombre de entre 1 y 60 caracteres.',
  too_many_projects: `Has llegado al máximo de ${MAX_PROJECTS} proyectos.`,
  invalid_cover: 'La imagen de portada no es válida.',
  not_found: 'No se encontró el proyecto.',
  db_error: 'No se pudo guardar. Inténtalo de nuevo.',
};
