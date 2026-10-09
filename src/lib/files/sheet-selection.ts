import { z } from 'zod';

/** Campos Zod compartidos por el alta (POST) y la edición (PATCH) de archivos. */
export const sheetModeSchema = z.enum(['first', 'selected', 'all']);

export const sheetNamesSchema = z.array(z.string().trim().min(1).max(200)).max(100);

/** Regla común: "selected" exige al menos una hoja. */
export function checkSheetSelection(
  v: { sheetMode: 'first' | 'selected' | 'all'; sheetNames: string[] },
  ctx: z.RefinementCtx,
) {
  if (v.sheetMode === 'selected' && v.sheetNames.length === 0) {
    ctx.addIssue({ code: 'custom', path: ['sheetNames'], message: 'Elige al menos una hoja' });
  }
}

/** Lo que se guarda en BD: con "todas" no hace falta lista de nombres. */
export function normalizeSelection(mode: 'first' | 'selected' | 'all', names: string[]) {
  return {
    sheet_mode: mode,
    sheet_names: mode === 'selected' ? Array.from(new Set(names)) : [],
  };
}
