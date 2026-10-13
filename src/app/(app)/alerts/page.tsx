import { redirect } from 'next/navigation';
import { getSessionContext } from '@/lib/auth';
import { AlertsList } from '@/components/AlertsList';
import type { AlertRow } from '@/components/AlertsProvider';

export default async function AlertsPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect('/login');

  // RLS devuelve las alertas de mi empresa y las de proyectos compartidos conmigo.
  const [{ data: alerts }, { data: projects }] = await Promise.all([
    ctx.supabase
      .from('alerts')
      .select(
        'id, company_id, project_id, file_name, rule_name, sheet_name, message, severity, matched_count, row_refs, status, created_at',
      )
      .neq('status', 'dismissed')
      .order('created_at', { ascending: false })
      .limit(150),
    ctx.supabase.from('projects').select('id, name, company_id').order('created_at', { ascending: true }),
  ]);

  const names = new Map((projects ?? []).map((p) => [p.id as string, p.name as string]));
  const rows: AlertRow[] = (alerts ?? []).map(({ company_id, ...a }) => ({
    ...a,
    project_name: a.project_id ? (names.get(a.project_id) ?? null) : null,
    shared: company_id !== ctx.companyId,
  })) as AlertRow[];

  const withAlerts = new Set(rows.map((a) => a.project_id).filter(Boolean));
  const options = (projects ?? [])
    .filter((p) => withAlerts.has(p.id) || p.company_id === ctx.companyId)
    .map((p) => ({ id: p.id as string, name: p.company_id === ctx.companyId ? (p.name as string) : `${p.name} (compartido)` }));

  return (
    <>
      <h1>Alertas</h1>
      <p className="sub">
        Cada alerta pertenece al proyecto de su archivo. Las de proyectos que han compartido contigo aparecen aquí
        solo para consultar.
      </p>
      <AlertsList initial={rows} projects={options} />
    </>
  );
}
