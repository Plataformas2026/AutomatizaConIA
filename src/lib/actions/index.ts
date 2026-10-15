import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Action, AlertAction, EmailAction } from '@/lib/rules/types';
import { buildEmails, type MatchedRow } from '@/lib/email/render';
import type { Assignees } from '@/lib/assign/assign';
import { variablePattern, type VariableKey } from '@/lib/messages/variables';

/**
 * Registro de acciones. Para añadir una nueva (webhook, Slack…):
 *   1. define su esquema en rules/types.ts
 *   2. añade aquí su handler y su `case` en runActions
 * El pipeline no cambia.
 */

export interface ActionContext {
  admin: SupabaseClient;
  companyId: string;
  file: { id: string; name: string; projectId: string | null };
  rule: { id: string; name: string };
  /** Hoja donde se detectó; null en CSV. */
  sheetName: string | null;
  /** Columna principal de la condición (nombre de configuración, no datos). */
  columnName: string;
  matchedCount: number;
  /** Nº de fila (máx. 200). Nunca valores de celdas. */
  rowRefs: number[];
  /** Filas que cumplen la regla con SOLO las columnas que usa algún correo (vacío si no hay acción de correo).
   *  Existen únicamente en memoria durante la evaluación. */
  rows: MatchedRow[];
  /** Columnas que existen en la hoja donde se detectó. */
  headers: string[];
  /** Reparto de las filas que cumplen la regla por persona (huellas, nunca nombres). null si la columna no existe. */
  assignees?: (column: string) => Promise<Assignees | null>;
}

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

async function runAlert(action: AlertAction, ctx: ActionContext): Promise<void> {
  const assignees = action.assignColumn && ctx.assignees ? await ctx.assignees(action.assignColumn) : null;
  let templateId: string | null = null;
  if (action.templateId) {
    const { data } = await ctx.admin
      .from('report_templates')
      .select('id')
      .eq('id', action.templateId)
      .eq('company_id', ctx.companyId)
      .maybeSingle();
    templateId = (data?.id as string | undefined) ?? null;
  }
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
    assignees: assignees ?? {},
    template_id: templateId,
  });
  if (error) throw new Error(`No se pudo guardar la alerta: ${error.code ?? error.message}`);
}

/**
 * Correo: el servidor no puede enviar en nombre de nadie. Deja el correo ya redactado en la cola
 * «pendientes» del Dashboard (o lo recoge el agente de tu ordenador, si lo has configurado para enviar).
 */
async function runEmail(action: EmailAction, ctx: ActionContext): Promise<void> {
  const drafts = buildEmails(
    action,
    ctx.rule.id,
    { fileName: ctx.file.name, ruleName: ctx.rule.name, sheetName: ctx.sheetName, columnName: ctx.columnName, count: ctx.matchedCount },
    ctx.rows,
    ctx.headers,
  );
  if (!drafts.length) return;

  const { error } = await ctx.admin.from('email_outbox').upsert(
    drafts.map((d) => ({
      company_id: ctx.companyId,
      project_id: ctx.file.projectId,
      file_id: ctx.file.id,
      rule_id: ctx.rule.id,
      file_name: ctx.file.name,
      rule_name: ctx.rule.name,
      sheet_name: d.sheet,
      row_number: d.row,
      dedupe_key: d.key,
      from_addr: d.from || null,
      to_addr: d.to,
      cc_addr: d.cc || null,
      subject: d.subject,
      body: d.body,
      problem: d.problem,
    })),
    { onConflict: 'rule_id,dedupe_key', ignoreDuplicates: true },
  );
  if (error) throw new Error(`No se pudo preparar el correo: ${error.code ?? error.message}`);
}

export async function runActions(actions: Action[], ctx: ActionContext): Promise<void> {
  for (const action of actions) {
    if (action.type === 'alert') await runAlert(action, ctx);
    else await runEmail(action, ctx);
  }
}
