import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionContext } from '@/lib/auth';
import { DrivePicker } from '@/components/DrivePicker';
import { FileActions } from '@/components/FileActions';

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

const STATUS_LABEL: Record<string, string> = {
  active: 'Activo',
  paused: 'Pausado',
  error: 'Con error',
  revoked: 'Reconectar',
};

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ google?: string }>;
}) {
  const ctx = await getSessionContext();
  if (!ctx) redirect('/login');
  const { google } = await searchParams;

  const [{ data: connections }, { data: files }] = await Promise.all([
    ctx.supabase.from('google_connections').select('id, google_email, status'),
    ctx.supabase
      .from('shared_files_metadata')
      .select('id, name, status, last_checked_at, last_error, watch_expires_at')
      .order('created_at', { ascending: false }),
  ]);

  const active = connections?.find((c) => c.status === 'active');
  const needsReconnect = !active && (connections?.length ?? 0) > 0;

  return (
    <>
      <h1>Archivos</h1>
      <p className="sub">
        Tus archivos permanecen en tu Google Drive. Aquí solo guardamos la configuración y las alertas.
      </p>

      {google && NOTICES[google] && <div className="card">{NOTICES[google]}</div>}

      <div className="card row wrap">
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
          <DrivePicker label="Añadir / compartir otro archivo" />
        ) : (
          <a className="btn primary" href="/api/google/connect">
            {needsReconnect ? 'Reconectar Google Drive' : 'Conectar Google Drive'}
          </a>
        )}
      </div>

      <h2>Archivos compartidos</h2>
      {!files?.length && <p className="muted">Todavía no has compartido ningún archivo.</p>}
      {files?.map((f) => (
        <div className="card row wrap" key={f.id}>
          <div className="grow">
            <Link href={`/files/${f.id}`}>
              <strong>{f.name}</strong>
            </Link>{' '}
            <span className={`pill ${f.status}`}>{STATUS_LABEL[f.status] ?? f.status}</span>
            <div className="muted">
              {f.last_checked_at
                ? `Última comprobación: ${new Date(f.last_checked_at).toLocaleString('es-ES')}`
                : 'Aún sin comprobar'}
            </div>
            {f.last_error && <div className="err">{f.last_error}</div>}
          </div>
          <Link className="btn" href={`/files/${f.id}`}>
            Reglas
          </Link>
          <FileActions fileId={f.id} />
        </div>
      ))}
    </>
  );
}
