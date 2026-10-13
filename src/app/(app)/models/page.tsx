import { redirect } from 'next/navigation';
import { getSessionContext } from '@/lib/auth';
import { mlConfigSchema, type MlResult } from '@/lib/ml/types';
import { ModelStudio } from '@/components/ml/ModelStudio';
import type { SavedReport } from '@/components/ml/SavedReports';

export default async function ModelsPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect('/login');

  const [{ data: files }, { data: rows }] = await Promise.all([
    ctx.supabase.from('shared_files_metadata').select('id, name, mime_type').eq('source', 'drive').order('created_at', { ascending: false }),
    ctx.supabase
      .from('ml_reports')
      .select('id, file_id, title, config, summary, created_at')
      .order('created_at', { ascending: false }),
  ]);

  // Descarta informes con una configuración que ya no es válida en vez de romper la página.
  const reports: SavedReport[] = (rows ?? []).flatMap((r) => {
    const config = mlConfigSchema.safeParse(r.config);
    return config.success
      ? [{ id: r.id as string, file_id: r.file_id as string, title: r.title as string, config: config.data, summary: r.summary as MlResult, created_at: r.created_at as string }]
      : [];
  });

  return (
    <>
      <h1>Informes y Modelos IA</h1>
      <p className="sub">
        Predice cifras, clasifica casos, encuentra valores raros o descubre grupos en tus archivos, sin saber de estadística.
        Tus datos se leen de tu Drive al momento y no se guardan: de cada informe solo se conservan los resultados.
      </p>
      <ModelStudio files={files ?? []} initialReports={reports} />
    </>
  );
}
