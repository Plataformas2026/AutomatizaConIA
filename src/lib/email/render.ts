import { createHash } from 'node:crypto';
import type { Cell } from '@/lib/parsing/parse';
import type { EmailAction } from '@/lib/rules/types';
import { parseRecipients } from './address';

export { parseRecipients };

/**
 * Redacta los correos de una regla a partir de las filas que la cumplen.
 *
 * Módulo PURO (sin I/O). El agente local (agent/email_render.py) implementa lo mismo
 * en Python y comparten una batería de pruebas, para que el correo sea idéntico
 * lo evalúe el servidor o tu ordenador.
 *
 * Variables:
 *   {col:Nombre de columna}  → valor de esa columna en la fila (o valores distintos, en el resumen)
 *   {count} {rows} {column} {sheet} {file} {rule}  → igual que en las alertas
 */

export const MAX_EMAILS_PER_RULE = 25;
export const MAX_DISTINCT_VALUES = 10;
const MAX_TEXT_CELL = 200;
const DAY_MS = 86_400_000;
const TOLERANCE_MS = 5 * 60_000;

/* ── Formato de celdas (idéntico en Python) ───────────────── */

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function groupThousands(int: string): string {
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** 1234.5 → «1234,5» · 12345.678 → «12.345,68» · -0.5 → «-0,5». Agrupa miles solo desde 5 cifras. */
export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return '';
  const abs = Math.abs(n);
  if (abs >= 1e13) return '(número demasiado grande)';
  const scaled = Math.floor(abs * 100 + 0.5);
  const int = Math.floor(scaled / 100);
  const frac = scaled % 100;
  let s = int >= 10000 ? groupThousands(String(int)) : String(int);
  if (frac !== 0) s += ',' + (frac < 10 ? `0${frac}` : String(frac)).replace(/0$/, '');
  return (n < 0 && scaled !== 0 ? '-' : '') + s;
}

export function formatDate(d: Date): string {
  const t = new Date(d.getTime() + TOLERANCE_MS);
  return `${pad2(t.getUTCDate())}/${pad2(t.getUTCMonth() + 1)}/${t.getUTCFullYear()}`;
}

/** Valor de una celda tal como aparecerá en el correo. */
export function formatCell(v: Cell | undefined): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'Sí' : 'No';
  if (typeof v === 'number') return formatNumber(v);
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : formatDate(v);
  // Texto: sin saltos de línea ni tabuladores (evita cabeceras manipuladas) y con tope.
  const s = String(v).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/ {2,}/g, ' ').trim();
  return s.length > MAX_TEXT_CELL ? s.slice(0, MAX_TEXT_CELL) + '…' : s;
}

/* ── Plantillas ─────────────────────────────────────────── */

const TOKEN = /\{(count|rows|column|sheet|file|rule)\}|\{col:([^{}]{1,200})\}/g;

/** Nombres de columna que usan las plantillas. */
export function referencedColumns(templates: string[]): string[] {
  const out: string[] = [];
  for (const t of templates) {
    for (const m of t.matchAll(TOKEN)) {
      const name = m[2]?.trim();
      if (name && !out.includes(name)) out.push(name);
    }
  }
  return out;
}

export interface EmailMeta {
  fileName: string;
  ruleName: string;
  /** null en CSV. */
  sheetName: string | null;
  /** Columna principal de la condición. */
  columnName: string;
  /** Total de filas que cumplen la condición. */
  count: number;
}

export interface MatchedRow {
  rowNumber: number;
  values: Record<string, Cell>;
}

function distinct(values: string[]): string {
  const seen: string[] = [];
  for (const v of values) if (v !== '' && !seen.includes(v)) seen.push(v);
  const shown = seen.slice(0, MAX_DISTINCT_VALUES).join(', ');
  return seen.length > MAX_DISTINCT_VALUES ? `${shown}… (+${seen.length - MAX_DISTINCT_VALUES} más)` : shown;
}

function renderTemplate(template: string, meta: EmailMeta, rows: MatchedRow[], perRow: boolean): string {
  const rowNumbers = rows.map((r) => r.rowNumber);
  const rowsText = perRow
    ? rowNumbers.join(', ')
    : rowNumbers.slice(0, 10).join(', ') + (meta.count > 10 ? '…' : '');
  return template.replace(TOKEN, (_all, key: string | undefined, col: string | undefined) => {
    if (col !== undefined) {
      const name = col.trim();
      const values = rows.map((r) => formatCell(r.values[name]));
      return perRow ? (values[0] ?? '') : distinct(values);
    }
    switch (key) {
      case 'count':
        return String(meta.count);
      case 'rows':
        return rowsText;
      case 'column':
        return meta.columnName;
      case 'sheet':
        return meta.sheetName ?? meta.fileName;
      case 'file':
        return meta.fileName;
      default:
        return meta.ruleName;
    }
  });
}

/* ── Correos ────────────────────────────────────────────── */

export interface EmailDraft {
  sheet: string | null;
  /** Nº de fila (modo «uno por fila»); null en el resumen. */
  row: number | null;
  key: string;
  from: string;
  to: string;
  /** Destinatarios en copia ('' si no hay). */
  cc: string;
  subject: string;
  body: string;
  /** Por qué no se puede enviar solo (destinatario no válido, columna desaparecida…). */
  problem: string | null;
}

function oneLine(s: string): string {
  return s.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/ {2,}/g, ' ').trim();
}

export function dedupeKey(ruleId: string, sheet: string | null, subject: string, to: string, body: string): string {
  return createHash('sha256')
    .update([ruleId, sheet ?? '', subject, to, body].join('\u0001'))
    .digest('hex')
    .slice(0, 40);
}

/**
 * @param matched filas que cumplen la regla (con SOLO las columnas que usa la plantilla)
 * @param headers columnas que existen en la hoja
 */
export function buildEmails(
  action: EmailAction,
  ruleId: string,
  meta: EmailMeta,
  matched: MatchedRow[],
  headers: string[],
): EmailDraft[] {
  if (matched.length === 0) return [];
  const used = referencedColumns([action.to, action.cc, action.subject, action.body]);
  const missing = used.filter((c) => !headers.includes(c));

  const make = (rows: MatchedRow[], perRow: boolean): EmailDraft => {
    const to = oneLine(renderTemplate(action.to, meta, rows, perRow));
    const cc = oneLine(renderTemplate(action.cc ?? '', meta, rows, perRow));
    const subject = oneLine(renderTemplate(action.subject, meta, rows, perRow)).slice(0, 200);
    const body = renderTemplate(action.body, meta, rows, perRow).replace(/\r\n?/g, '\n').slice(0, 6000);
    let problem: string | null = null;
    if (missing.length) problem = `La columna «${missing[0]}» ya no existe en el archivo.`;
    else if (!to) problem = 'El destinatario está vacío en esta fila.';
    else if (!parseRecipients(to)) problem = `El destinatario «${to.slice(0, 80)}» no es una dirección de correo válida.`;
    else if (cc && !parseRecipients(cc)) problem = `La copia «${cc.slice(0, 80)}» no es una dirección de correo válida.`;
    return {
      sheet: meta.sheetName,
      row: perRow ? rows[0].rowNumber : null,
      key: dedupeKey(ruleId, meta.sheetName, subject, to, body),
      from: action.from,
      to,
      cc,
      subject,
      body,
      problem,
    };
  };

  if (action.mode === 'summary') return [make(matched, false)];

  const seen = new Set<string>();
  const drafts: EmailDraft[] = [];
  for (const row of matched) {
    const d = make([row], true);
    if (seen.has(d.key)) continue; // dos filas que dan exactamente el mismo correo → uno solo
    seen.add(d.key);
    drafts.push(d);
    if (drafts.length >= MAX_EMAILS_PER_RULE) break;
  }
  return drafts;
}
