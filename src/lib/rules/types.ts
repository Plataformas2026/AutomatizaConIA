import { z } from 'zod';
import { OPERATORS, isUnary } from './operators';

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
    right: operandSchema.optional(),
  })
  .superRefine((c, ctx) => {
    if (!isUnary(c.operator) && !c.right) {
      ctx.addIssue({ code: 'custom', path: ['right'], message: 'Falta el segundo operando' });
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

export const actionSchema = alertActionSchema;

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
export type Rule = z.infer<typeof ruleSchema>;
