import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Action } from '@/lib/rules/types';
import { variablePattern, type VariableKey } from '@/lib/messages/variables';

/**
 * Registro de acciones. Para añadir una nueva (email, webhook, Slack…):
 *   1. define su esquema en rules/types.ts
 *   2. añade aquí su handler en `handlers`
 * El pipeline no cambia.
 */

export interface ActionContext {
  admin: SupabaseClient;
  companyId: string;
  file: { id: string; name: string };
  rule: { id: string; name: string };
  /** Hoja donde se detectó; null en CSV. */
  sheetName: string | null;
  /** Columna principal de la condición (nombre de configuración, no datos). */
  columnName: string;
  matchedCount: number;
  /** Nº de fila (máx. 200). Nunca valores de celdas. */
  rowRefs: number[];
}

type Handler<T extends Action['type']> = (
  action: Extract<Action, { type: T }>,
  ctx: ActionContext,
) => Promise<void>;

/** PRIVACIDAD: las plantillas solo admiten variables que NO provienen de las
 *  celdas. Así el texto de la alerta nunca copia datos del archivo.
 *  Las variables disponibles se definen en lib/messages/variables.ts. */
export function renderMessage(template: string, ctx: ActionContext): string {
  const preview = ctx.rowRefs.slice(0, 10).join(', ') + (ctx.matchedCount > 10 ? '…' : '');
  const vars: Record<VariableKey, string> = {
    count: String(ctx.matchedCount),
    rows: preview,
    column: ctx.columnName,
    sheet: ctx.sheetName ?? ctx.file.name,
    file: ctx.file.name,
    rule: ctx.rule.name,
  };
  return template.replace(variablePattern(), (_, k: VariableKey) => vars[k]);
}

const handlers: { [K in Action['type']]: Handler<K> } = {
  alert: async (action, ctx) => {
    const { error } = await ctx.admin.from('alerts').insert({
      company_id: ctx.companyId,
      file_id: ctx.file.id,
      rule_id: ctx.rule.id,
      file_name: ctx.file.name,
      rule_name: ctx.rule.name,
      sheet_name: ctx.sheetName,
      message: renderMessage(action.message, ctx),
      severity: action.severity,
      matched_count: ctx.matchedCount,
      row_refs: ctx.rowRefs.slice(0, 200),
    });
    if (error) throw new Error(`No se pudo guardar la alerta: ${error.code ?? error.message}`);
  },
};

export async function runActions(actions: Action[], ctx: ActionContext): Promise<void> {
  for (const action of actions) {
    // Con varios tipos de acción, TS puede exigir aquí un cast al handler correspondiente.
    await handlers[action.type](action, ctx);
  }
}
