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
 * Hoy: una comparación [Variable 1] [Operador] [Variable 2 | Valor].
 * `kind` deja abierta la puerta a grupos AND/OR en el futuro sin migrar
 * la tabla: {kind:'group', op:'and'|'or', conditions:[...]}.            */
export const conditionSchema = z
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

/* ── Acciones ──────────────────────────────────────────────────
 * Hoy solo 'alert'. Para añadir (email, webhook, Slack…):
 *  1) nuevo esquema aquí y pasar actionSchema a z.discriminatedUnion
 *  2) nuevo handler en lib/actions/index.ts                         */
export const alertActionSchema = z.object({
  type: z.literal('alert'),
  message: z.string().trim().min(1).max(500),
  severity: z.enum(['info', 'warning', 'critical']).default('info'),
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

export type Condition = z.infer<typeof conditionSchema>;
export type Action = z.infer<typeof actionSchema>;
export type AlertAction = z.infer<typeof alertActionSchema>;
export type EmailAction = z.infer<typeof emailActionSchema>;
export type Rule = z.infer<typeof ruleSchema>;
