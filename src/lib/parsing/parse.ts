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

export const GOOGLE_SHEET_MIME = 'application/vnd.google-apps.spreadsheet';
const MAX_ROWS = 50_000;

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

export function parseTable(buf: ArrayBuffer, mimeType: string): ParsedTable {
  // Las hojas nativas de Google se exportan como CSV (primera pestaña).
  if (mimeType === 'text/csv' || mimeType === GOOGLE_SHEET_MIME) {
    const text = decodeText(buf);
    const result = Papa.parse<string[]>(text, { header: false, skipEmptyLines: false });
    return buildTable(result.data as unknown[][], 1);
  }

  const wb = XLSX.read(buf, { type: 'array', cellDates: true });
  const sheetName = wb.SheetNames[0];
  const ws = sheetName ? wb.Sheets[sheetName] : undefined;
  if (!ws || !ws['!ref']) return { headers: [], rows: [], truncated: false };

  const startRow = XLSX.utils.decode_range(ws['!ref']).s.r; // 0-based
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: true,
  });
  return buildTable(matrix, startRow + 1);
}
