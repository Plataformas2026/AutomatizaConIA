/**
 * Reparto de filas por persona. Mismo algoritmo que agent/assign.py (los dos ejecutan agent/tests/assign_cases.json).
 * Sin dependencias de servidor: lo usan el pipeline (Drive) y el navegador (para saber «cuáles son mías»).
 *
 * Solo se guardan HUELLAS de nombres/correos y números de fila, nunca el nombre o correo de la celda.
 */
export const UNASSIGNED = '-';
export const MAX_PEOPLE = 150;
export const MAX_ROWS_PER_PERSON = 20;

export type Assignees = Record<string, { n: number; rows: number[] }>;

const SPLIT = /[;\n\r/|]+/;
const EMAIL = /[^\s<>,;()[\]]+@[^\s<>,;()[\]]+/g;

export function normalize(v: unknown): string {
  return String(v ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export async function digest(ruleId: string, key: string): Promise<string> {
  const buf = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${ruleId}|${key}`));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

/** Nombres/correos que contiene una celda. Con correo, el correo identifica a la persona. */
export function cellKeys(cell: unknown): string[] {
  let raw = cell == null ? '' : String(cell);
  if (raw.includes('@')) raw = raw.replaceAll(',', ';');
  const keys: string[] = [];
  for (const part of raw.split(SPLIT)) {
    const p = normalize(part);
    if (!p) continue;
    const emails = (p.match(EMAIL) ?? []).map(normalize);
    for (const k of emails.length ? emails : [p]) if (k && !keys.includes(k)) keys.push(k);
  }
  return keys;
}

export async function buildAssignees(ruleId: string, rows: Iterable<[number, unknown]>): Promise<Assignees> {
  let out: Assignees = {};
  const add = (h: string, n: number) => {
    const e = (out[h] ??= { n: 0, rows: [] });
    e.n++;
    if (e.rows.length < MAX_ROWS_PER_PERSON) e.rows.push(n);
  };
  for (const [number, cell] of rows) {
    const keys = cellKeys(cell);
    if (!keys.length) {
      add(await digest(ruleId, UNASSIGNED), number);
      continue;
    }
    add(await digest(ruleId, keys[0]), number); // «Ana / Luis»: la tarea es de Ana; Luis queda de reserva (ver buildChains)
  }
  const entries = Object.entries(out);
  if (entries.length > MAX_PEOPLE) out = Object.fromEntries(entries.sort((a, b) => b[1].n - a[1].n).slice(0, MAX_PEOPLE));
  return out;
}

export const MAX_CHAIN_ROWS = 200;
export const MAX_CHAIN = 5;
/** fila → huellas de [responsable, 2.º, 3.º…]. */
export type Chains = Record<string, string[]>;
/** fila → posición actual en la cadena (0 = el primero). Solo hay entradas de las filas que se han traspasado. */
export type Handoffs = Record<number, number>;

/** Filas con VARIOS nombres («Ana / Luis»). El primero es el responsable; la tarea puede pasarse al siguiente. */
export async function buildChains(ruleId: string, rows: Iterable<[number, unknown]>): Promise<Chains> {
  const out: Chains = {};
  for (const [number, cell] of rows) {
    const keys = cellKeys(cell).slice(0, MAX_CHAIN);
    if (keys.length >= 2 && Object.keys(out).length < MAX_CHAIN_ROWS) out[String(number)] = await Promise.all(keys.map((k) => digest(ruleId, k)));
  }
  return out;
}

/** Con qué nombres puede aparecer una persona en la columna de reparto. */
export function identifiers(email: string, aliases: string[] = []): string[] {
  const e = normalize(email);
  const ids = e.includes('@') ? [e, e.split('@')[0]] : [e];
  return [...new Set([...ids, ...aliases.map(normalize)].filter(Boolean))];
}

export interface MyShare {
  /** Filas que cumplen la regla y te corresponden (la tarea es del primer nombre de la celda, salvo que se haya pasado). */
  mine: number;
  /** Primeras filas tuyas (para elegir cuál rellenar). */
  rows: number[];
  /** Filas sin responsable. */
  unassigned: number;
}

export async function myShare(
  assignees: Assignees | null | undefined,
  ruleId: string,
  ids: string[],
  chains?: Chains | null,
  handoffs?: Handoffs | null,
): Promise<MyShare> {
  const res: MyShare = { mine: 0, rows: [], unassigned: 0 };
  if (!assignees) return res;
  const wanted = new Set(await Promise.all(ids.map((i) => digest(ruleId, i))));
  for (const [h, v] of Object.entries(assignees)) {
    if (wanted.has(h)) {
      res.mine += v.n;
      for (const r of v.rows) if (!res.rows.includes(r)) res.rows.push(r);
    }
  }
  // Tareas traspasadas: la fila deja de ser del primer nombre y pasa a quien la tiene ahora.
  for (const [row, chain] of Object.entries(chains ?? {})) {
    const level = Math.min(handoffs?.[Number(row)] ?? 0, chain.length - 1);
    if (level <= 0) continue;
    const n = Number(row);
    if (wanted.has(chain[0])) {
      res.mine = Math.max(0, res.mine - 1);
      res.rows = res.rows.filter((r) => r !== n);
    }
    if (wanted.has(chain[level])) {
      res.mine += 1;
      if (!res.rows.includes(n)) res.rows.push(n);
    }
  }
  res.rows.sort((a, b) => a - b);
  res.unassigned = assignees[await digest(ruleId, UNASSIGNED)]?.n ?? 0;
  return res;
}

/** «Quedan 7 informes sin completar» + «, 3 te corresponden a ti». */
export function personalize(message: string, share: MyShare): string {
  const base = message.replace(/[.\s]+$/, '');
  if (share.mine === 0) return `${base}, ninguno te corresponde`;
  return `${base}, ${share.mine} te ${share.mine === 1 ? 'corresponde' : 'corresponden'} a ti`;
}
