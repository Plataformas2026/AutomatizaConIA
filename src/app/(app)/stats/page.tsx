import { redirect } from 'next/navigation';
import { getSessionContext } from '@/lib/auth';
import { chartConfigSchema } from '@/lib/stats/types';
import { StatsBoard } from '@/components/stats/StatsBoard';
import { ProjectScope, type ScopeOption } from '@/components/projects/ProjectScope';
import type { SavedChart } from '@/components/stats/ChartBuilder';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function StatsPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const ctx = await getSessionContext();
  if (!ctx) redirect('/login');
  const { project: wanted } = await searchParams;

  // Proyectos propios y los compartidos conmigo (RLS).
  const { data: projectRows } = await ctx.supabase
    .from('projects')
    .select('id, name, company_id')
    .order('created_at', { ascending: true });
  const projects = projectRows ?? [];
  const mine = projects.filter((p) => p.company_id === ctx.companyId);
  const shared = projects.filter((p) => p.company_id !== ctx.companyId);

  // Cada panel de estadísticas pertenece a UN proyecto (o a «Sin proyecto»).
  const scope =
    wanted === 'none' || (wanted && UUID.test(wanted) && projects.some((p) => p.id === wanted))
      ? (wanted as string)
      : (projects[0]?.id ?? 'none');
  const current = projects.find((p) => p.id === scope) ?? null;
  const readOnly = !!current && current.company_id !== ctx.companyId;
  const projectId = current?.id ?? null;

  let filesQuery = ctx.supabase
    .from('shared_files_metadata')
    .select('id, name, mime_type, source') // Drive y locales: los locales se calculan en el navegador, vía el agente
    .order('created_at', { ascending: false });
  filesQuery = projectId
    ? filesQuery.eq('project_id', projectId)
    : filesQuery.is('project_id', null).eq('company_id', ctx.companyId);

  let chartsQuery = ctx.supabase
    .from('stats_charts')
    .select('id, config, position')
    .order('position', { ascending: true })
    .order('created_at', { ascending: true });
  chartsQuery = projectId ? chartsQuery.eq('project_id', projectId) : chartsQuery.is('project_id', null).eq('user_id', ctx.user.id);

  const [{ data: files }, { data: rows }] = await Promise.all([filesQuery, chartsQuery]);

  // Descarta configuraciones que ya no son válidas en lugar de romper la página.
  const charts: SavedChart[] = (rows ?? []).flatMap((r) => {
    const parsed = chartConfigSchema.safeParse(r.config);
    return parsed.success ? [{ id: r.id as string, config: parsed.data, position: r.position as number }] : [];
  });

  const options: ScopeOption[] = [
    ...mine.map((p) => ({ value: p.id, label: p.name })),
    ...shared.map((p) => ({ value: p.id, label: `${p.name} (compartido conmigo)` })),
    { value: 'none', label: 'Archivos sin proyecto' },
  ];

  return (
    <>
      <h1>Estadísticas</h1>
      <p className="sub">
        Cada panel pertenece a un proyecto: las gráficas usan los archivos de ese proyecto y quien lo tenga compartido
        las ve también. Los datos se leen en el momento (de Drive, o de tu ordenador a través del agente) y no se guardan: solo se conserva la configuración.
      </p>
      <ProjectScope basePath="/stats" value={scope} options={options} />
      {readOnly && (
        <div className="notice">Proyecto compartido contigo: puedes ver sus gráficas, pero solo quien lo creó puede cambiarlas.</div>
      )}
      <StatsBoard
        key={scope}
        files={files ?? []}
        initialCharts={charts}
        projectId={projectId}
        readOnly={readOnly}
      />
    </>
  );
}
