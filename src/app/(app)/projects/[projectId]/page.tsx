import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getSessionContext } from '@/lib/auth';
import { DrivePicker } from '@/components/DrivePicker';
import { LocalUpload } from '@/components/intake/LocalUpload';
import { FileList } from '@/components/files/FileList';
import { ProjectCover } from '@/components/projects/ProjectGrid';
import { ProjectToolbar } from '@/components/projects/ProjectToolbar';
import { FILE_COLUMNS, toFileItem, type FileRowDb } from '@/lib/projects/format';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const ctx = await getSessionContext();
  if (!ctx) redirect('/login');
  if (!UUID.test(projectId)) notFound();

  const [{ data: project }, { data: files }, { data: others }, { data: connections }] = await Promise.all([
    ctx.supabase.from('projects').select('id, name, cover').eq('id', projectId).maybeSingle(),
    ctx.supabase
      .from('shared_files_metadata')
      .select(FILE_COLUMNS)
      .eq('project_id', projectId)
      .order('created_at', { ascending: false }),
    ctx.supabase.from('projects').select('id, name').order('created_at', { ascending: true }),
    ctx.supabase.from('google_connections').select('id, status'),
  ]);
  if (!project) notFound();

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
          <ProjectToolbar project={{ id: project.id, name: project.name, cover: project.cover }} />
        </div>
      </div>

      {active ? (
        <>
          <div className="panel connect row wrap">
            <div className="grow">
              <strong>Añadir a este proyecto</strong>
              <div className="muted">Los archivos que añadas aquí se guardan directamente dentro del proyecto.</div>
            </div>
            <DrivePicker label="Añadir archivos de Google Drive" projectId={project.id} />
          </div>
          <div className="panel connect connect-local">
            <LocalUpload projectId={project.id} />
          </div>
        </>
      ) : (
        <div className="notice">
          Conecta tu Google Drive desde el <Link href="/dashboard">Dashboard</Link> para añadir archivos.
        </div>
      )}

      <h2>Archivos del proyecto</h2>
      <FileList
        files={items}
        projects={(others ?? []).map((p) => ({ id: p.id, name: p.name }))}
        currentProjectId={project.id}
        emptyText="Este proyecto aún no tiene archivos. Añádelos arriba, o arrastra archivos sueltos del Dashboard sobre su tarjeta."
      />
    </>
  );
}
