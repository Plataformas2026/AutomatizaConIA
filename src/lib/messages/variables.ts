/**
 * Variables que se pueden insertar en el texto de un aviso.
 * Sin dependencias de servidor: lo usan tanto el constructor visual (cliente)
 * como el generador de alertas (servidor).
 *
 * PRIVACIDAD: ninguna variable devuelve valores de celdas del archivo.
 */

export type VariableKey = 'count' | 'rows' | 'column' | 'sheet' | 'file' | 'rule';

export interface MessageVariable {
  key: VariableKey;
  /** Texto corto que se ve en la etiqueta. */
  label: string;
  /** Explicación en lenguaje llano. */
  description: string;
  /** Solo tiene sentido en archivos con hojas (Excel / Google Sheets). */
  needsSheets?: boolean;
}

export const MESSAGE_VARIABLES: MessageVariable[] = [
  { key: 'count', label: 'Nº de filas', description: 'Cuántas filas cumplen la condición.' },
  { key: 'rows', label: 'Qué filas', description: 'Los números de fila que la cumplen (hasta 10).' },
  { key: 'column', label: 'Columna', description: 'El nombre de la columna que revisa la regla.' },
  {
    key: 'sheet',
    label: 'Hoja',
    description: 'La hoja donde se ha detectado. Si vigilas varias hojas, recibes un aviso por cada una.',
    needsSheets: true,
  },
  { key: 'file', label: 'Archivo', description: 'El nombre del archivo de Drive.' },
  { key: 'rule', label: 'Regla', description: 'El nombre que le has dado a esta regla.' },
];

export const VARIABLE_KEYS: VariableKey[] = MESSAGE_VARIABLES.map((v) => v.key);

const LABELS = Object.fromEntries(MESSAGE_VARIABLES.map((v) => [v.key, v.label])) as Record<VariableKey, string>;

export function variableLabel(key: VariableKey): string {
  return LABELS[key];
}

/** Se crea nueva cada vez: una RegExp global con estado compartido da errores sutiles. */
export function variablePattern(): RegExp {
  return new RegExp(`\\{(${VARIABLE_KEYS.join('|')})\\}`, 'g');
}

export type Segment = { type: 'text'; text: string } | { type: 'var'; key: VariableKey };

/** "Hay {count} filas" → [texto, variable, texto] */
export function templateToSegments(template: string): Segment[] {
  const segments: Segment[] = [];
  let last = 0;
  for (const m of template.matchAll(variablePattern())) {
    const index = m.index ?? 0;
    if (index > last) segments.push({ type: 'text', text: template.slice(last, index) });
    segments.push({ type: 'var', key: m[1] as VariableKey });
    last = index + m[0].length;
  }
  if (last < template.length) segments.push({ type: 'text', text: template.slice(last) });
  return segments;
}

/** Texto legible para listados: "Hay «Nº de filas» filas…" (sin llaves). */
export function humanizeTemplate(template: string): string {
  return templateToSegments(template)
    .map((s) => (s.type === 'text' ? s.text : `«${variableLabel(s.key)}»`))
    .join('');
}

export interface SampleContext {
  fileName?: string;
  ruleName?: string;
  columnName?: string;
  sheetName?: string;
}

/** Valores de ejemplo con los datos reales de la regla que se está creando. */
export function sampleValues(ctx: SampleContext): Record<VariableKey, string> {
  return {
    count: '3',
    rows: '4, 9, 15',
    column: ctx.columnName || 'Stock',
    sheet: ctx.sheetName || 'Hoja1',
    file: ctx.fileName || 'Inventario.xlsx',
    rule: ctx.ruleName?.trim() || 'Stock bajo',
  };
}
