import { redirect } from 'next/navigation';
import { getSessionContext } from '@/lib/auth';
import { AlertsList } from '@/components/AlertsList';

export default async function AlertsPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect('/login');

  const { data: alerts } = await ctx.supabase
    .from('alerts')
    .select('id, file_name, rule_name, sheet_name, message, severity, matched_count, row_refs, status, created_at')
    .neq('status', 'dismissed')
    .order('created_at', { ascending: false })
    .limit(100);

  return (
    <>
      <h1>Alertas</h1>
      <p className="sub">Se actualizan solas cuando cambia alguno de tus archivos.</p>
      <AlertsList initial={alerts ?? []} />
    </>
  );
}
