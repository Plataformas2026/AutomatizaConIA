import { redirect } from 'next/navigation';
import { getSessionContext } from '@/lib/auth';
import Link from 'next/link';
import { DrivePicker } from '@/components/DrivePicker';
import { LocalFilePanel } from '@/components/local/LocalFilePanel';
import { loadAgentCards } from '@/lib/agents/load';
import { FileList } from '@/components/files/FileList';
import { ProjectGrid, ProjectCover } from '@/components/projects/ProjectGrid';
import { FILE_COLUMNS, toFileItem, type FileRowDb } from '@/lib/projects/format';
import type { ProjectCard } from '@/lib/projects/types';

const NOTICES: Record<string, string> = {
  connected: 'Google Drive conectado. Ahora elige un archivo.',
  denied: 'Cancelaste el permiso de Google.',
  missing_scope: 'Falta el permiso de acceso a archivos de Drive. Vuelve a conectar y déjalo marcado.',
  no_refresh_token: 'Google no devolvió acceso permanente. Revoca el acceso de la app en tu cuenta de Google y reconecta.',
  state_error: 'La conexión expiró. Inténtalo de nuevo.',
  save_error: 'No se pudo guardar la conexión.',
  exchange_error: 'No se pudo completar la conexión con Google.',
  no_code: 'Google no devolvió el código de autorización.',
};

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ google?: string }>;
}) {
  const ctx = await getSessionContext();
  if (!ctx) redirect('/login');
  const { google } = await searchParams;

  // Si alguien te invitó a un proyecto con este correo, aquí pasa a ser tuyo (solo lectura).
  await ctx.supabase.rpc('claim_project_invitations');

  const [{ data: connections }, { data: files }, { data: projectRows }, { data: sharedRows }, { count: outboxCount }] =
    await Promise.all([
      ctx.supabase.from('google_connections').select('id, google_email, status'),
      ctx.supabase
        .from('shared_files_metadata')
        .select(FILE_COLUMNS)
        .eq('company_id', ctx.companyId)
        .order('created_at', { ascending: false }),
      ctx.supabase
        .from('projects')
        .select('id, name, cover')
        .eq('company_id', ctx.companyId)
        .order('created_at', { ascending: true }),
      ctx.supabase
        .from('projects')
        .select('id, name, cover')
        .neq('company_id', ctx.companyId)
        .order('created_at', { ascending: true }),
      ctx.supabase
        .from('email_outbox')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', ctx.companyId)
        .in('status', ['pending', 'drafted']),
    ]);

  const allFiles = ((files ?? []) as FileRowDb[]).map(toFileItem);
  const loose = allFiles.filter((f) => !f.projectId);
  const counts = new Map<string, number>();
  for (const f of allFiles) if (f.projectId) counts.set(f.projectId, (counts.get(f.projectId) ?? 0) + 1);
  const projects: ProjectCard[] = (projectRows ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    cover: p.cover,
    fileCount: counts.get(p.id) ?? 0,
  }));

  const agents = await loadAgentCards(ctx);

  const active = connections?.find((c) => c.status === 'active');
  const needsReconnect = !active && (connections?.length ?? 0) > 0;

  return (
    <>
      <h1>Dashboard</h1>
      <p className="sub">
        Tus archivos permanecen en tu Google Drive. Aquí solo guardamos la configuración y las alertas.
      </p>

      {google && NOTICES[google] && <div className="notice">{NOTICES[google]}</div>}

      {(outboxCount ?? 0) > 0 && (
        <div className="notice">
          Tienes {outboxCount} correo{outboxCount === 1 ? '' : 's'} pendiente{outboxCount === 1 ? '' : 's'}.{' '}
          <Link href="/emails">Ver correos pendientes</Link>
        </div>
      )}

      <div className="panel connect row wrap">
        <div className="grow">
          {active ? (
            <>
              <strong>Google Drive conectado</strong>
              <div className="muted">{active.google_email}</div>
            </>
          ) : (
            <>
              <strong>{needsReconnect ? 'Acceso a Google revocado' : 'Conecta tu Google Drive'}</strong>
              <div className="muted">Solo accederemos a los archivos que elijas explícitamente.</div>
            </>
          )}
        </div>
        {active ? (
          <DrivePicker label="Añadir archivos de Google Drive" />
        ) : (
          <a className="btn primary" href="/api/google/connect">
            {needsReconnect ? 'Reconectar Google Drive' : 'Conectar Google Drive'}
          </a>
        )}
      </div>

      <div className="panel connect connect-local">
        <LocalFilePanel agents={agents} />
      </div>

      <h2>Proyectos</h2>
      <p className="muted section-hint">
        Agrupa tus archivos por temas. Arrastra un archivo sobre un proyecto, o usa el botón «Mover».
      </p>
      <ProjectGrid projects={projects} />

      {(sharedRows ?? []).length > 0 && (
        <section className="shared-with-me" aria-labelledby="shared-title">
          <h2 id="shared-title">Compartidos conmigo</h2>
          <p className="muted section-hint">
            Proyectos de otras personas. Puedes ver sus archivos, alertas y estadísticas, pero no cambiarlos.
          </p>
          <ul className="pgrid">
            {(sharedRows ?? []).map((p) => (
              <li key={p.id}>
                <Link href={`/projects/${p.id}`} className="pcard" draggable={false}>
                  <ProjectCover name={p.name} cover={p.cover} />
                  <span className="pcard-body">
                    <span className="pcard-name">{p.name}</span>
                    <span className="muted">Solo lectura</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <h2>{projects.length ? 'Archivos sin proyecto' : 'Archivos compartidos'}</h2>
      <FileList
        files={loose}
        projects={projects.map((p) => ({ id: p.id, name: p.name }))}
        currentProjectId={null}
        emptyText={
          allFiles.length
            ? 'Todos tus archivos están dentro de un proyecto.'
            : 'Todavía no has compartido ningún archivo.'
        }
      />
    </>
  );
}
