import { LocalAgentError, localTables, type TablesData } from '@/lib/agents/local-api';
import type { Cell, ParsedTable } from '@/lib/parsing/parse';
import { computeChart, inferKind, StatsError } from './compute';
import type { ChartConfig, ChartResult, QueryItemResult, StructureSheet } from './types';

/**
 * Estadísticas de archivos LOCALES. El servidor no puede leerlos (no salen del PC), así que el agente de este
 * ordenador entrega las tablas al navegador y las gráficas se calculan aquí con exactamente el mismo código
 * que usa el servidor para Drive (`computeChart`). Nada de esto pasa por Supabase ni por Vercel ni se guarda:
 * la caché vive solo en la memoria de la pestaña y caduca en un minuto.
 */
const TTL_MS = 60_000;

export interface LocalSheet {
  name: string | null;
  table: ParsedTable;
}
const cache = new Map<string, { at: number; promise: Promise<LocalSheet[]> }>();

export function clearLocalCache(fileId?: string): void {
  if (fileId) cache.delete(fileId);
  else cache.clear();
}

const AGENT_ERROR_TO_STATS: Record<string, string> = {
  unreachable: 'local_unreachable',
  forbidden: 'local_forbidden',
  not_found: 'local_not_found',
  busy: 'local_busy',
  unreadable: 'local_unreadable',
  too_big: 'local_too_big',
  unsupported: 'local_unsupported',
};

/** Convierte un valor del JSON del agente en una celda: {d:'AAAA-MM-DD'} → Date (UTC). */
export function decodeCell(v: unknown): Cell {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
  if (typeof v === 'object' && typeof (v as { d?: unknown }).d === 'string') {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec((v as { d: string }).d);
    if (m) return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  }
  return null;
}

export function decodeTables(data: TablesData): LocalSheet[] {
  return data.sheets.map((s) => ({
    name: s.name,
    table: {
      headers: s.headers,
      truncated: s.truncated,
      rows: s.rows.map((r) => ({
        rowNumber: r.n,
        values: Object.fromEntries(s.headers.map((h, i) => [h, decodeCell(r.v[i])])) as Record<string, Cell>,
      })),
    },
  }));
}

export function sheetsOf(fileId: string): Promise<LocalSheet[]> {
  const hit = cache.get(fileId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.promise;
  const promise = localTables(fileId)
    .then(decodeTables)
    .catch((e: unknown) => {
      cache.delete(fileId);
      if (e instanceof LocalAgentError) throw new StatsError(AGENT_ERROR_TO_STATS[e.code] ?? 'read_error', 502);
      throw new StatsError('read_error', 502);
    });
  cache.set(fileId, { at: Date.now(), promise });
  return promise;
}

/** Misma regla que el servidor: sin hoja → la primera; con hoja → esa hoja o error. */
export function pickTable(sheets: LocalSheet[], sheet: string | null): ParsedTable {
  const found = sheet ? sheets.find((s) => s.name === sheet) : sheets[0];
  if (!found) throw new StatsError('sheet_not_found', 404);
  return found.table;
}

/** Hojas y columnas (con su tipo) para los desplegables del creador de gráficas. */
export async function localStructure(fileId: string): Promise<StructureSheet[]> {
  const sheets = await sheetsOf(fileId);
  return sheets.map(({ name, table }) => ({
    name,
    rows: table.rows.length,
    columns: table.headers.map((c) => ({ name: c, kind: inferKind(table, c) })),
  }));
}

export async function localChart(config: ChartConfig): Promise<ChartResult> {
  const sheets = await sheetsOf(config.fileId);
  return computeChart(pickTable(sheets, config.sheet), config);
}

/** Calcula varias gráficas de archivos locales con una sola lectura por archivo. */
export async function localQuery(charts: { id: string; config: ChartConfig }[]): Promise<Record<string, QueryItemResult>> {
  const out: Record<string, QueryItemResult> = {};
  const byFile = new Map<string, typeof charts>();
  for (const c of charts) byFile.set(c.config.fileId, [...(byFile.get(c.config.fileId) ?? []), c]);
  await Promise.all(
    [...byFile].map(async ([fileId, list]) => {
      let sheets: LocalSheet[] | null = null;
      let fileError = 'read_error';
      try {
        sheets = await sheetsOf(fileId);
      } catch (e) {
        fileError = e instanceof StatsError ? e.code : 'read_error';
      }
      for (const { id, config } of list) {
        if (!sheets) {
          out[id] = { error: fileError };
          continue;
        }
        try {
          out[id] = { result: computeChart(pickTable(sheets, config.sheet), config) };
        } catch (e) {
          out[id] = { error: e instanceof StatsError ? e.code : 'read_error' };
        }
      }
    }),
  );
  return out;
}
