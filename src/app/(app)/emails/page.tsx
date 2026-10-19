import { redirect } from 'next/navigation';
import { getSessionContext } from '@/lib/auth';
import { OutboxPanel, type OutboxItem } from '@/components/email/OutboxPanel';

export const dynamic = 'force-dynamic';

export default async function EmailsPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect('/login');

  const [{ data: rows }, { data: projects }, { data: files }] = await Promise.all([
    ctx.supabase
      .from('email_outbox')
      .select('id, rule_id, company_id, file_id, project_id, sender_chain, file_name, rule_name, sheet_name, row_number, from_addr, to_addr, cc_addr, subject, body, problem, status, created_at')
      .in('status', ['pending', 'drafted'])
      .order('created_at', { ascending: false })
      .limit(100),
    ctx.supabase.from('projects').select('id, name').order('created_at', { ascending: true }),
    ctx.supabase.from('shared_files_metadata').select('id, project_id').eq('company_id', ctx.companyId),
  ]);

  // Quién tiene cada tarea y a quién se puede pasar (los nombres los pone la base de datos, no el navegador).
  const chained = (rows ?? []).filter((o) => (o.sender_chain as string[] | null)?.length && (o.sender_chain as string[]).length > 1 && o.rule_id && o.row_number != null);
  const alertIds = new Map<string, string>();
  if (chained.length) {
    const { data: al } = await ctx.supabase
      .from('alerts')
      .select('id, rule_id, file_id, sheet_name, created_at')
      .in('rule_id', [...new Set(chained.map((o) => o.rule_id as string))])
      .order('created_at', { ascending: false })
      .limit(300);
    for (const a of al ?? []) {
      const k = `${a.rule_id}|${a.file_id}|${a.sheet_name ?? ''}`;
      if (!alertIds.has(k)) alertIds.set(k, a.id as string);
    }
  }
  const byAlert = new Map<string, number[]>();
  const alertOf = (o: { rule_id: string | null; file_id: string | null; sheet_name: string | null }) => alertIds.get(`${o.rule_id}|${o.file_id}|${o.sheet_name ?? ''}`);
  for (const o of chained) {
    const id = alertOf(o);
    if (id) byAlert.set(id, [...(byAlert.get(id) ?? []), o.row_number as number]);
  }
  const labels = new Map<string, Record<string, { now: string | null; next: string | null; prev: string | null; canPass: boolean; canBack: boolean; mine: boolean }>>();
  await Promise.all(
    [...byAlert].map(async ([id, rws]) => {
      const { data } = await ctx.supabase.rpc('alert_task_labels', { p_alert: id, p_rows: rws });
      if (data) labels.set(id, data as never);
    }),
  );

  // El proyecto actual es el del archivo (si lo moviste de proyecto, el correo te sigue).
  const fileProject = new Map((files ?? []).map((f) => [f.id as string, f.project_id as string | null]));
  const names = new Map((projects ?? []).map((p) => [p.id as string, p.name as string]));

  const items: OutboxItem[] = (rows ?? []).map((o) => {
    const projectId = (o.file_id ? fileProject.get(o.file_id) : undefined) ?? o.project_id ?? null;
    return {
      id: o.id,
      fileName: o.file_name,
      ruleName: o.rule_name,
      sheetName: o.sheet_name,
      rowNumber: o.row_number,
      from: o.from_addr,
      to: o.to_addr ?? '',
      cc: o.cc_addr ?? '',
      subject: o.subject ?? '',
      body: o.body ?? '',
      problem: o.problem,
      status: o.status as 'pending' | 'drafted',
      projectId,
      projectName: projectId ? (names.get(projectId) ?? null) : null,
      createdAt: o.created_at,
      shared: o.company_id !== ctx.companyId,
      handoff: (() => {
        const aid = alertOf(o);
        const l = aid && o.row_number != null ? labels.get(aid)?.[String(o.row_number)] : undefined;
        return l && aid ? { alertId: aid, ...l } : null;
      })(),
    };
  });

  return (
    <>
      <h1>Correos pendientes</h1>
      <p className="sub">
        Correos que tus reglas han preparado con los datos de tus archivos y que todavía no se han enviado. Cada uno
        pertenece al proyecto de su archivo. También ves aquí los que te toca mandar a ti en proyectos compartidos. Cópialo a tu Outlook, envíalo y pulsa «Ya lo he enviado».
      </p>
      <OutboxPanel items={items} projects={(projects ?? []).map((p) => ({ id: p.id as string, name: p.name as string }))} />
    </>
  );
}
