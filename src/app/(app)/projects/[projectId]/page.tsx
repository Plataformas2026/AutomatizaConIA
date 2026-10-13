import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getSessionContext } from '@/lib/auth';
import { DrivePicker } from '@/components/DrivePicker';
import { LocalFilePanel } from '@/components/local/LocalFilePanel';
import { loadAgentCards } from '@/lib/agents/load';
import { FileList } from '@/components/files/FileList';
import { ProjectCover } from '@/components/projects/ProjectGrid';
import { ProjectToolbar } from '@/components/projects/ProjectToolbar';
import { FILE_COLUMNS, toFileItem, type FileRowDb } from '@/lib/projects/format';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SEVERITY = { info: 'Informativa', warning: 'Aviso', critical: 'Crítica' } as const;

export default async function ProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const ctx = await getSessionContext();
  if (!ctx) redirect('/login');
  if (!UUID.test(projectId)) notFound();

  // RLS: proyectos de mi empresa o compartidos conmigo.
  const { data: project } = await ctx.supabase
    .from('projects')
    .select('id, name, cover, company_id')
    .eq('id', projectId)
    .maybeSingle();
  if (!project) notFound();
  const shared = project.company_id !== ctx.companyId;

  const [{ data: files }, { data: others }, { data: connections }, { data: alerts }, { count: chartCount }] =
    await Promise.all([
      ctx.supabase
        .from('shared_files_metadata')
        .select(FILE_COLUMNS)
        .eq('project_id', projectId)
        .order('created_at', { ascending: false }),
      shared
        ? Promise.resolve({ data: [] as { id: string; name: string }[] })
        : ctx.supabase.from('projects').select('id, name').eq('company_id', ctx.companyId).order('created_at', { ascending: true }),
      shared ? Promise.resolve({ data: [] as { id: string; status: string }[] }) : ctx.supabase.from('google_connections').select('id, status'),
      ctx.supabase
        .from('alerts')
        .select('id, rule_name, file_name, message, severity, status, created_at')
        .eq('project_id', projectId)
        .neq('status', 'dismissed')
        .order('created_at', { ascending: false })
        .limit(5),
      ctx.supabase.from('stats_charts').select('id', { count: 'exact', head: true }).eq('project_id', projectId),
    ]);

  const agents = shared ? [] : await loadAgentCards(ctx);
  const items = ((files ?? []) as FileRowDb[]).map(toFileItem);
  const active = connections?.some((c) => c.status === 'active');

  return (
    <>
      <p className="back">
        <Link href="/dashboard">← Volver al Dashboard</Link>
      </p>

      <div className="project-head">
        <div className="project-cover">
          <ProjectCover name={project.name} cover={project.cover} />
        </div>
        <div className="grow">
          <h1>{project.name}</h1>
          <p className="sub">
            {items.length === 1 ? '1 archivo en este proyecto.' : `${items.length} archivos en este proyecto.`}
          </p>
          {shared ? (
            <p className="muted readonly-note">Proyecto compartido contigo: puedes consultarlo, pero no cambiarlo.</p>
          ) : (
            <ProjectToolbar project={{ id: project.id, name: project.name, cover: project.cover }} />
          )}
        </div>
      </div>

      {!shared &&
        (active ? (
          <div className="panel connect row wrap">
            <div className="grow">
              <strong>Añadir a este proyecto</strong>
              <div className="muted">Los archivos que añadas aquí se guardan directamente dentro del proyecto.</div>
            </div>
            <DrivePicker label="Añadir archivos de Google Drive" projectId={project.id} />
          </div>
        ) : (
          <div className="notice">
            Conecta tu Google Drive desde el <Link href="/dashboard">Dashboard</Link> para añadir archivos de Drive.
          </div>
        ))}
      {!shared && (
        <div className="panel connect connect-local">
          <LocalFilePanel agents={agents} projectId={project.id} />
        </div>
      )}

      <h2>Archivos del proyecto</h2>
      <FileList
        files={items}
        projects={(others ?? []).map((p) => ({ id: p.id, name: p.name }))}
        currentProjectId={project.id}
        readOnly={shared}
        emptyText="Este proyecto aún no tiene archivos. Añádelos arriba, o arrastra archivos sueltos del Dashboard sobre su tarjeta."
      />

      <section className="project-section" aria-labelledby="proj-alerts">
        <h2 id="proj-alerts">Alertas del proyecto</h2>
        {(alerts ?? []).length === 0 ? (
          <p className="muted">Este proyecto no tiene alertas pendientes.</p>
        ) : (
          <ul className="mini-alerts">
            {(alerts ?? []).map((a) => (
              <li key={a.id}>
                <strong>{a.message}</strong>
                <span className="tag tag-file">{a.file_name}</span>
                <span className="muted">
                  {SEVERITY[a.severity as keyof typeof SEVERITY]} · {new Date(a.created_at).toLocaleString('es-ES')}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p>
          <Link className="btn" href="/alerts">
            Ver todas las alertas
          </Link>
        </p>
      </section>

      <section className="project-section" aria-labelledby="proj-stats">
        <h2 id="proj-stats">Estadísticas del proyecto</h2>
        <p className="muted">
          {chartCount ? `${chartCount} ${chartCount === 1 ? 'gráfica guardada' : 'gráficas guardadas'}.` : 'Todavía no hay gráficas.'}
        </p>
        <p>
          <Link className="btn" href={`/stats?project=${project.id}`}>
            {shared ? 'Ver estadísticas' : 'Abrir estadísticas'}
          </Link>
        </p>
      </section>
    </>
  );
}
