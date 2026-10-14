import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getSessionContext } from '@/lib/auth';
import { FileWorkspace } from '@/components/FileWorkspace';
import { FileTypeIcon } from '@/components/Icons';
import { LocalFileInfo } from '@/components/local/LocalFileInfo';
import { ONLINE_WINDOW_MS } from '@/lib/agents/types';
import { dbForResource } from '@/lib/admin';

export default async function FilePage({ params }: { params: Promise<{ fileId: string }> }) {
  const { fileId } = await params;
  const ctx = await getSessionContext();
  if (!ctx) redirect('/login');

  // Administrador: puede abrir el archivo de cualquier usuario para gestionar sus reglas.
  const db = dbForResource(ctx);
  let fileQuery = db
    .from('shared_files_metadata')
    .select('id, name, mime_type, status, last_error, source, local_path, agent_id, company_id')
    .eq('id', fileId);
  if (!ctx.isAdmin) fileQuery = fileQuery.eq('company_id', ctx.companyId);
  const { data: file } = await fileQuery.maybeSingle();
  if (!file) notFound();

  // ¿De quién es? (solo se muestra a administradores cuando no es suyo)
  let ownerEmail: string | null = null;
  let ownerUserId: string | undefined;
  if (ctx.isAdmin) {
    if (file.company_id === ctx.companyId) {
      ownerUserId = ctx.user.id;
    } else {
      const { data: users } = await ctx.supabase.rpc('admin_list_users');
      const owner = ((users ?? []) as { user_id: string; email: string; company_id: string }[]).find((u) => u.company_id === file.company_id);
      ownerEmail = owner?.email ?? 'otro usuario';
      ownerUserId = owner?.user_id;
    }
  }

  let agent: { name: string; online: boolean } | null = null;
  if (file.source === 'local' && file.agent_id) {
    const { data } = await db
      .from('local_agents')
      .select('name, last_seen_at')
      .eq('id', file.agent_id)
      .maybeSingle();
    if (data) {
      agent = {
        name: data.name,
        online: !!data.last_seen_at && Date.now() - new Date(data.last_seen_at).getTime() < ONLINE_WINDOW_MS,
      };
    }
  }

  const { data: rules } = await db
    .from('rules')
    .select('id, name, enabled, condition, actions, last_error, last_evaluated_at')
    .eq('file_id', fileId)
    .order('created_at', { ascending: false });

  return (
    <>
      <p className="back">
        <Link href={ownerEmail ? '/admin' : '/dashboard'}>{ownerEmail ? '← Volver a Administración' : '← Volver al Dashboard'}</Link>
      </p>
      <div className="page-title">
        <FileTypeIcon mime={file.mime_type} />
        <h1>{file.name}</h1>
      </div>
      <p className="sub">
        Define cuándo avisarte. Las condiciones se evalúan al instante cada vez que el archivo cambia{file.source === 'local' ? ' en tu ordenador' : ' en tu Drive'}.
      </p>
      {ownerEmail && (
        <div className="notice">
          Estás gestionando este archivo como administrador. Pertenece a <strong>{ownerEmail}</strong>; las reglas que crees aquí se ejecutan en su cuenta y en su agente.
          {file.source === 'local' && ' La vista previa y «Abrir ubicación» solo funcionan en el ordenador de su dueño.'}
        </div>
      )}
      {file.last_error && <div className="notice notice-error">{file.last_error}</div>}
      {file.source === 'local' && (
        <LocalFileInfo
          fileId={file.id}
          fileName={file.name}
          initialPath={file.local_path}
          agentName={agent?.name ?? null}
          agentOnline={agent?.online ?? false}
        />
      )}
      <FileWorkspace
        fileId={file.id}
        fileName={file.name}
        isCsv={file.mime_type === 'text/csv'}
        initialRules={rules ?? []}
        ownerUserId={ownerUserId}
      />
    </>
  );
}
