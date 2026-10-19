import { z } from 'zod';
import { MAX_ELAPSED, OPERATORS, TIME_UNITS, isUnary } from './operators';

/* ── Operandos ─────────────────────────────────────────────── */
const columnOperand = z.object({
  type: z.literal('column'),
  column: z.string().trim().min(1).max(200),
});

const valueOperand = z.object({
  type: z.literal('value'),
  value: z.union([z.string().max(500), z.number()]),
});

export const operandSchema = z.discriminatedUnion('type', [columnOperand, valueOperand]);

/* ── Condición ─────────────────────────────────────────────────
 * Dos formas (el agente y la web las evalúan igual):
 *  · compare: [Columna] [Operador] [Columna | Valor]            (las reglas de siempre)
 *  · group:   AND / OR de varias condiciones, anidables.
 *    Ejemplo A:  X = «y»  Y  ( H está vacía  O  H contiene «K» )
 *       {kind:'group', op:'and', conditions:[ compare(X eq y), {kind:'group', op:'or', conditions:[ compare(H is_empty), compare(H contains K) ]} ]}
 * Límites: 12 condiciones simples y 3 niveles de anidación como máximo.  */
export const MAX_CONDITION_LEAVES = 12;
export const MAX_CONDITION_DEPTH = 3;

const compareSchema = z
  .object({
    kind: z.literal('compare'),
    left: columnOperand,
    operator: z.enum(OPERATORS),
    /** Solo con `elapsed`: días (por defecto), semanas, meses o años. */
    unit: z.enum(TIME_UNITS).optional(),
    right: operandSchema.optional(),
  })
  .superRefine((c, ctx) => {
    if (!isUnary(c.operator) && !c.right) {
      ctx.addIssue({ code: 'custom', path: ['right'], message: 'Falta el segundo operando' });
      return;
    }
    if (c.operator === 'elapsed') {
      const v = c.right?.type === 'value' ? c.right.value : null;
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > MAX_ELAPSED) {
        ctx.addIssue({ code: 'custom', path: ['right'], message: `Indica cuánto tiempo: un número entero entre 0 y ${MAX_ELAPSED}` });
      }
    }
    if (c.operator === 'on_date') {
      const v = c.right?.type === 'value' ? c.right.value : null;
      if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) {
        ctx.addIssue({ code: 'custom', path: ['right'], message: 'Elige una fecha del calendario' });
      }
    }
  });

export type CompareCondition = z.infer<typeof compareSchema>;
export interface GroupCondition {
  kind: 'group';
  op: 'and' | 'or';
  conditions: Condition[];
}
export type Condition = CompareCondition | GroupCondition;

const groupSchema: z.ZodType<GroupCondition> = z.lazy(() =>
  z.object({
    kind: z.literal('group'),
    op: z.enum(['and', 'or']),
    conditions: z.array(looseConditionSchema).min(1).max(MAX_CONDITION_LEAVES),
  }),
);
const looseConditionSchema: z.ZodType<Condition> = z.lazy(() => z.union([compareSchema, groupSchema]));

/** Nº de condiciones simples y profundidad de un árbol. */
export function conditionStats(c: Condition): { leaves: number; depth: number } {
  if (c.kind === 'compare') return { leaves: 1, depth: 1 };
  let leaves = 0;
  let depth = 0;
  for (const k of c.conditions) {
    const s = conditionStats(k);
    leaves += s.leaves;
    depth = Math.max(depth, s.depth);
  }
  return { leaves, depth: depth + 1 };
}

export const conditionSchema = looseConditionSchema.superRefine((c, ctx) => {
  const { leaves, depth } = conditionStats(c);
  if (leaves > MAX_CONDITION_LEAVES) ctx.addIssue({ code: 'custom', message: `Máximo ${MAX_CONDITION_LEAVES} condiciones por regla` });
  if (depth > MAX_CONDITION_DEPTH + 1) ctx.addIssue({ code: 'custom', message: `Máximo ${MAX_CONDITION_DEPTH} niveles de grupos` });
});

/* ── Acciones ──────────────────────────────────────────────────
 * Hoy solo 'alert'. Para añadir (email, webhook, Slack…):
 *  1) nuevo esquema aquí y pasar actionSchema a z.discriminatedUnion
 *  2) nuevo handler en lib/actions/index.ts                         */
export const alertActionSchema = z.object({
  type: z.literal('alert'),
  message: z.string().trim().min(1).max(500),
  severity: z.enum(['info', 'warning', 'critical']).default('info'),
  /** Columna con el nombre/correo de la persona a quien corresponde cada fila (opcional).
   *  Con ella la alerta sabe cuántas filas son de cada persona («3 te corresponden a ti»). */
  assignColumn: z.string().trim().min(1).max(200).optional(),
  /** Plantilla (creada por el administrador) que se rellena con los datos de la fila al pulsar «Rellenar». */
  templateId: z.string().uuid().optional(),
  /** A quién le llega: solo a quien le toque por la columna de responsable, o a todas las personas del proyecto. */
  audience: z.enum(['assigned', 'everyone']).default('assigned'),
});

/** Correo de Outlook. `to`, `subject` y `body` admiten {col:Columna} y las variables de las alertas.
 *  El sistema nunca envía en nombre de nadie sin autorización: si tu ordenador no está configurado
 *  para el envío automático, el correo aparece en tu Dashboard como «pendiente de enviar». */
export const emailActionSchema = z.object({
  type: z.literal('email'),
  /** Cuenta desde la que debe salir (opcional). Sin variables. */
  from: z.union([z.literal(''), z.string().trim().email().max(254)]).default(''),
  /** Destinatarios en copia (opcional). Admite {col:Columna} igual que `to`. */
  cc: z.string().trim().max(500).default(''),
  to: z.string().trim().min(1).max(500),
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(4000),
  /** per_row: un correo por fila que cumple la condición · summary: uno solo con el resumen. */
  mode: z.enum(['per_row', 'summary']).default('per_row'),
  /** Columna con quién tiene que mandar cada correo («Ana» o «Ana / Luis»: el primero lo manda, el resto es reserva). */
  senderColumn: z.string().trim().min(1).max(200).optional(),
  /** A quién le llega: solo a su responsable, o a todas las personas del proyecto. */
  audience: z.enum(['assigned', 'everyone']).default('assigned'),
});

export const actionSchema = z.discriminatedUnion('type', [alertActionSchema, emailActionSchema]);

/* ── Regla ─────────────────────────────────────────────────── */
export const ruleSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(120),
  condition: conditionSchema,
  actions: z.array(actionSchema).max(5),
});

/** Cuerpo de creación (POST /api/rules). */
export const createRuleSchema = z.object({
  fileId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  condition: conditionSchema,
  actions: z.array(actionSchema).min(1).max(5),
});

export const updateRuleSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    enabled: z.boolean().optional(),
    condition: conditionSchema.optional(),
    actions: z.array(actionSchema).min(1).max(5).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nada que actualizar' });

export type Action = z.infer<typeof actionSchema>;
export type AlertAction = z.infer<typeof alertActionSchema>;
export type EmailAction = z.infer<typeof emailActionSchema>;
export type Rule = z.infer<typeof ruleSchema>;
