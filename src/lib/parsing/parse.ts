import Papa from 'papaparse';
import * as XLSX from 'xlsx';

/**
 * Parseo EN MEMORIA. Estas estructuras viven solo durante la petición:
 * nunca se serializan a base de datos, ni a logs, ni a caché.
 */
export type Cell = string | number | boolean | Date | null;

export interface ParsedRow {
  /** Nº de fila tal como lo ve el usuario en su hoja (la cabecera es la 1). */
  rowNumber: number;
  values: Record<string, Cell>;
}

export interface ParsedTable {
  headers: string[];
  rows: ParsedRow[];
  truncated: boolean;
}

/** Qué hojas de un libro Excel / Google Sheet se vigilan. */
export interface SheetSelection {
  mode: 'first' | 'selected' | 'all';
  names: string[];
}

export interface SheetTable {
  /** null en archivos CSV (no tienen hojas). */
  sheetName: string | null;
  table: ParsedTable;
}

export interface ParsedWorkbook {
  /** Todas las hojas que existen en el archivo ([] en CSV). */
  available: string[];
  /** Solo las hojas que toca evaluar según la selección. */
  sheets: SheetTable[];
}

export const GOOGLE_SHEET_MIME = 'application/vnd.google-apps.spreadsheet';
export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const MAX_ROWS = 50_000;
/** Tope de hojas evaluadas por archivo, para acotar tiempo y memoria. */
const MAX_SHEETS = 50;

const EMPTY_TABLE: ParsedTable = { headers: [], rows: [], truncated: false };

/** Las Hojas de Google se descargan exportadas a .xlsx (así llegan todas las pestañas). */
export function parseMimeFor(driveMime: string): string {
  return driveMime === GOOGLE_SHEET_MIME ? XLSX_MIME : driveMime;
}

const isCsv = (mime: string) => mime === 'text/csv';

function decodeText(buf: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^﻿/, '');
  } catch {
    // CSV exportado desde Excel en Windows suele venir en Windows-1252.
    return new TextDecoder('windows-1252').decode(buf);
  }
}

function normalizeHeaders(raw: unknown[]): string[] {
  let last = raw.length - 1;
  while (last >= 0 && (raw[last] == null || String(raw[last]).trim() === '')) last--;
  const seen = new Map<string, number>();
  return raw.slice(0, last + 1).map((h, i) => {
    const base = h == null || String(h).trim() === '' ? `Columna ${i + 1}` : String(h).trim();
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base} (${n})`;
  });
}

function isBlank(v: unknown): boolean {
  return v == null || (typeof v === 'string' && v.trim() === '');
}

function buildTable(matrix: unknown[][], firstRowNumber: number): ParsedTable {
  if (matrix.length === 0) return { headers: [], rows: [], truncated: false };

  const headers = normalizeHeaders(matrix[0] ?? []);
  const rows: ParsedRow[] = [];
  let truncated = false;

  for (let i = 1; i < matrix.length; i++) {
    const arr = matrix[i] ?? [];
    if (arr.every(isBlank)) continue;
    if (rows.length >= MAX_ROWS) {
      truncated = true;
      break;
    }
    const values: Record<string, Cell> = {};
    headers.forEach((h, j) => {
      const v = arr[j];
      values[h] = v === undefined || v === '' ? null : (v as Cell);
    });
    rows.push({ rowNumber: firstRowNumber + i, values });
  }
  return { headers, rows, truncated };
}

function csvToTable(buf: ArrayBuffer): ParsedTable {
  const result = Papa.parse<string[]>(decodeText(buf), { header: false, skipEmptyLines: false });
  return buildTable(result.data as unknown[][], 1);
}

function sheetToTable(ws: XLSX.WorkSheet | undefined): ParsedTable {
  if (!ws || !ws['!ref']) return EMPTY_TABLE;
  const startRow = XLSX.utils.decode_range(ws['!ref']).s.r; // 0-based
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: true,
  });
  return buildTable(matrix, startRow + 1);
}

/** Nombres de las hojas de un libro, sin leer su contenido (rápido). */
export function listSheets(buf: ArrayBuffer, mimeType: string): string[] {
  if (isCsv(mimeType)) return [];
  return XLSX.read(buf, { type: 'array', bookSheets: true }).SheetNames;
}

/** Aplica la selección del usuario a las hojas que existen ahora mismo. */
export function resolveSheets(available: string[], selection: SheetSelection): string[] {
  let chosen: string[];
  if (selection.mode === 'all') chosen = available;
  else if (selection.mode === 'selected') chosen = available.filter((n) => selection.names.includes(n));
  else chosen = available.slice(0, 1);
  return chosen.slice(0, MAX_SHEETS);
}

/** Lee solo las hojas seleccionadas. `mimeType` ya debe pasar por parseMimeFor(). */
export function parseWorkbook(buf: ArrayBuffer, mimeType: string, selection: SheetSelection): ParsedWorkbook {
  if (isCsv(mimeType)) {
    return { available: [], sheets: [{ sheetName: null, table: csvToTable(buf) }] };
  }

  const available = listSheets(buf, mimeType);
  const wanted = resolveSheets(available, selection);
  if (wanted.length === 0) return { available, sheets: [] };

  const wb = XLSX.read(buf, { type: 'array', cellDates: true, sheets: wanted });
  return {
    available,
    sheets: wanted.map((name) => ({ sheetName: name, table: sheetToTable(wb.Sheets[name]) })),
  };
}

/** Compatibilidad: primera hoja (o el CSV completo). */
export function parseTable(buf: ArrayBuffer, mimeType: string): ParsedTable {
  return parseWorkbook(buf, mimeType, { mode: 'first', names: [] }).sheets[0]?.table ?? EMPTY_TABLE;
}
