import { redirect } from 'next/navigation';
import { getSessionContext } from '@/lib/auth';
import { chartConfigSchema } from '@/lib/stats/types';
import { StatsBoard } from '@/components/stats/StatsBoard';
import type { SavedChart } from '@/components/stats/ChartBuilder';

export default async function StatsPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect('/login');

  const [{ data: files }, { data: rows }] = await Promise.all([
    ctx.supabase
      .from('shared_files_metadata')
      .select('id, name, mime_type')
      .order('created_at', { ascending: false }),
    ctx.supabase
      .from('stats_charts')
      .select('id, config, position')
      .order('position', { ascending: true })
      .order('created_at', { ascending: true }),
  ]);

  // Descarta configuraciones que ya no son válidas en lugar de romper la página.
  const charts: SavedChart[] = (rows ?? []).flatMap((r) => {
    const parsed = chartConfigSchema.safeParse(r.config);
    return parsed.success ? [{ id: r.id as string, config: parsed.data, position: r.position as number }] : [];
  });

  return (
    <>
      <h1>Estadísticas</h1>
      <p className="sub">
        Monta tu propio panel con gráficas de tus archivos. Los datos se leen de tu Drive en el momento y no se guardan:
        solo se conserva la configuración de cada gráfica.
      </p>
      <StatsBoard files={files ?? []} initialCharts={charts} />
    </>
  );
}
