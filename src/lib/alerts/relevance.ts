import { myShare, type Assignees, type Chains, type Handoffs } from '@/lib/assign/assign';

/** Lo mínimo de una alerta para decidir si me toca y si la he leído. */
export interface RelevantAlert {
  id: string;
  company_id?: string | null;
  project_id?: string | null;
  rule_id?: string | null;
  sheet_name?: string | null;
  assignees?: Assignees | null;
  chains?: Chains | null;
  audience?: 'assigned' | 'everyone' | null;
  rev?: number | null;
  status: 'open' | 'read' | 'dismissed';
}

/** Quién soy y qué avisos me tocan. Todo se calcula con huellas: nunca se guardan nombres ajenos. */
export interface NotifyContext {
  companyId: string;
  /** Mis nombres (correo y alias que puso el administrador). */
  ids: string[];
  /** Proyectos compartidos conmigo donde el dueño eligió «todos los avisos». */
  notifyAll: string[];
  /** Tareas traspasadas: `${regla}|${hoja}` → { fila: nivel }. */
  handoffs: Record<string, Handoffs>;
}

export const handoffKey = (ruleId: string, sheet: string | null | undefined) => `${ruleId}|${sheet ?? ''}`;

/**
 * ¿Esta alerta me toca? Mi empresa: todas (como siempre). Proyecto compartido: las marcadas «para todos»,
 * todas si el dueño me puso «todos los avisos», y si no, solo las que tienen alguna fila para mí.
 */
export async function isRelevant(a: RelevantAlert, ctx: NotifyContext): Promise<boolean> {
  if (!a.company_id || a.company_id === ctx.companyId) return true;
  if (a.audience === 'everyone') return true;
  if (a.project_id && ctx.notifyAll.includes(a.project_id)) return true;
  if (!a.rule_id || !a.assignees) return false;
  const share = await myShare(a.assignees, a.rule_id, ctx.ids, a.chains, ctx.handoffs[handoffKey(a.rule_id, a.sheet_name)]);
  return share.mine > 0;
}

/** Sin leer = no descartada y sin lectura mía al nivel actual (al pasar una tarea, la alerta vuelve a salir). */
export function isUnread(a: RelevantAlert, reads: Record<string, number>): boolean {
  if (a.status === 'dismissed') return false;
  const rev = a.rev ?? 0;
  if (a.status === 'read' && rev === 0) return false; // lecturas anteriores a esta versión
  const seen = reads[a.id];
  return seen === undefined || seen < rev;
}

/** Cuenta las alertas que me tocan y no he leído. */
export async function countUnread(alerts: RelevantAlert[], ctx: NotifyContext, reads: Record<string, number>): Promise<number> {
  let n = 0;
  for (const a of alerts) if (isUnread(a, reads) && (await isRelevant(a, ctx))) n += 1;
  return n;
}
