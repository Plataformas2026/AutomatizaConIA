import JSZip from 'jszip';
import { formatCell } from '@/lib/email/render';
import { normalize } from '@/lib/assign/assign';

/**
 * Rellena una plantilla Word (.docx) con los datos de UNA fila. Campos: {{así}}.
 * Mismo algoritmo que agent/docxfill.py (los dos ejecutan agent/tests/fixtures y fill_expected.json).
 * Todo en memoria: ni la plantilla rellenada ni la fila se guardan.
 */
type CellValue = Parameters<typeof formatCell>[0];
export const MAX_TEMPLATE_BYTES = 1_300_000;
const PLACEHOLDER = /\{\{\s*([^{}\n]{1,80}?)\s*\}\}/g;
const PART = /^word\/(document|header\d*|footer\d*)\.xml$/;
const PARA = /<w:p[ >][\s\S]*?<\/w:p>/g;
const RUN = /(<w:t(?:\s[^>]*)?>)([\s\S]*?)(<\/w:t>)/g;

export class TemplateError extends Error {}

const unescapeXml = (s: string) => s.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&apos;', "'").replaceAll('&amp;', '&');
const escapeXml = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

async function open(data: Uint8Array): Promise<JSZip> {
  if (data.byteLength > MAX_TEMPLATE_BYTES) throw new TemplateError('La plantilla es demasiado grande');
  try {
    const z = await JSZip.loadAsync(data);
    if (!z.file('word/document.xml')) throw new TemplateError('No es un documento Word (.docx)');
    return z;
  } catch (e) {
    if (e instanceof TemplateError) throw e;
    throw new TemplateError('No es un documento Word (.docx)');
  }
}

function paragraphText(para: string): string {
  return [...para.matchAll(RUN)].map((m) => unescapeXml(m[2])).join('');
}

function hasPlaceholder(text: string): boolean {
  return text.includes('{{') && new RegExp(PLACEHOLDER.source).test(text);
}

/** Campos {{así}} de la plantilla, sin repetir y en orden de aparición. */
export async function listFields(data: Uint8Array): Promise<string[]> {
  const z = await open(data);
  const out: string[] = [];
  for (const name of Object.keys(z.files).filter((n) => PART.test(n))) {
    const xml = await z.file(name)!.async('string');
    for (const para of xml.match(PARA) ?? []) {
      for (const m of paragraphText(para).matchAll(PLACEHOLDER)) if (!out.includes(m[1])) out.push(m[1]);
    }
  }
  return out.slice(0, 200);
}

export function fillXml(xml: string, resolve: (field: string) => string): string {
  return xml.replace(PARA, (para) => {
    const text = paragraphText(para);
    if (!hasPlaceholder(text)) return para;
    const next = text.replace(PLACEHOLDER, (_, f: string) => resolve(f));
    let i = 0;
    return para.replace(RUN, (_m, open: string, _t: string, close: string) => {
      if (i++ > 0) return open + close;
      const tag = open.includes('xml:space') ? open : `${open.slice(0, -1)} xml:space="preserve">`;
      return tag + escapeXml(next) + close;
    });
  });
}

/** Devuelve el .docx con todos los {{campos}} sustituidos por resolve(campo). */
export async function fillDocx(data: Uint8Array, resolve: (field: string) => string): Promise<Uint8Array> {
  const zin = await open(data);
  const zout = new JSZip();
  for (const name of Object.keys(zin.files)) {
    const entry = zin.files[name];
    if (entry.dir) continue;
    if (PART.test(name)) zout.file(name, fillXml(await entry.async('string'), resolve));
    else zout.file(name, await entry.async('uint8array'));
  }
  return zout.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

export async function partXml(data: Uint8Array, name = 'word/document.xml'): Promise<string> {
  const z = await open(data);
  return z.file(name)!.async('string');
}

/* ── Qué dato va en cada campo ───────────────────────────── */
const SPECIAL: Record<string, 'today' | 'row' | 'file' | 'sheet' | 'rule'> = {
  hoy: 'today', fecha: 'today', 'fecha hoy': 'today', 'fecha de hoy': 'today',
  fila: 'row', 'numero de fila': 'row', archivo: 'file', hoja: 'sheet', regla: 'rule',
};

export function makeResolver(
  headers: string[],
  values: Record<string, CellValue>,
  mapping: Record<string, string> | null | undefined,
  info: { row: number; today: string; fileName?: string; sheet?: string | null; rule?: string },
): (field: string) => string {
  const byNorm = new Map(headers.map((h) => [normalize(h), h]));
  const mapped = new Map(Object.entries(mapping ?? {}).filter(([, v]) => typeof v === 'string').map(([k, v]) => [normalize(k), v]));
  const special = { today: info.today, row: String(info.row), file: info.fileName ?? '', sheet: info.sheet ?? '', rule: info.rule ?? '' };
  return (field) => {
    const key = normalize(field);
    const col = mapped.get(key);
    if (col && headers.includes(col)) return formatCell(values[col]);
    const same = byNorm.get(key);
    if (same !== undefined) return formatCell(values[same]);
    if (key in SPECIAL) return special[SPECIAL[key]];
    return '';
  };
}

export function todayText(d = new Date(), timeZone = process.env.APP_TIME_ZONE || 'Europe/Madrid'): string {
  return new Intl.DateTimeFormat('es-ES', { timeZone, day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
}
