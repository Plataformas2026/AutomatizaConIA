import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getSessionContext } from '@/lib/auth';
import { RulesPanel } from '@/components/RulesPanel';

export default async function FilePage({ params }: { params: Promise<{ fileId: string }> }) {
  const { fileId } = await params;
  const ctx = await getSessionContext();
  if (!ctx) redirect('/login');

  const { data: file } = await ctx.supabase
    .from('shared_files_metadata')
    .select('id, name, status, last_error')
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
      <p className="muted">
        <Link href="/dashboard">← Archivos</Link>
      </p>
      <h1>{file.name}</h1>
      <p className="sub">
        Define cuándo avisarte. Las condiciones se evalúan al instante cada vez que el archivo cambia en tu Drive.
      </p>
      {file.last_error && <div className="card err">{file.last_error}</div>}
      <RulesPanel fileId={file.id} initialRules={rules ?? []} />
    </>
  );
}
