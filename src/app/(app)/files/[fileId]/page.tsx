import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getSessionContext } from '@/lib/auth';
import { FileWorkspace } from '@/components/FileWorkspace';
import { FileTypeIcon } from '@/components/Icons';

export default async function FilePage({ params }: { params: Promise<{ fileId: string }> }) {
  const { fileId } = await params;
  const ctx = await getSessionContext();
  if (!ctx) redirect('/login');

  const { data: file } = await ctx.supabase
    .from('shared_files_metadata')
    .select('id, name, mime_type, status, last_error')
    .eq('id', fileId)
    .maybeSingle();
  if (!file) notFound();

  const { data: rules } = await ctx.supabase
    .from('rules')
    .select('id, name, enabled, condition, actions, last_error, last_evaluated_at')
    .eq('file_id', fileId)
    .order('created_at', { ascending: false });

  return (
    <>
      <p className="back">
        <Link href="/dashboard">← Volver al Dashboard</Link>
      </p>
      <div className="page-title">
        <FileTypeIcon mime={file.mime_type} />
        <h1>{file.name}</h1>
      </div>
      <p className="sub">
        Define cuándo avisarte. Las condiciones se evalúan al instante cada vez que el archivo cambia en tu Drive.
      </p>
      {file.last_error && <div className="notice notice-error">{file.last_error}</div>}
      <FileWorkspace
        fileId={file.id}
        fileName={file.name}
        isCsv={file.mime_type === 'text/csv'}
        initialRules={rules ?? []}
      />
    </>
  );
}
