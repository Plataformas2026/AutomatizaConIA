import { redirect } from 'next/navigation';
import { getSessionContext } from '@/lib/auth';
import { ModelStudio } from '@/components/ml/ModelStudio';

export default async function ModelsPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect('/login');

  const { data: files } = await ctx.supabase
    .from('shared_files_metadata')
    .select('id, name, mime_type, source')
    .eq('company_id', ctx.companyId)
    .order('created_at', { ascending: false });

  return (
    <>
      <h1>Informes y Modelos IA</h1>
      <p className="sub">
        Predice cifras, clasifica casos, encuentra valores raros o descubre grupos en tus archivos, sin saber de estadística.
        El informe no se guarda en ningún sitio: si quieres conservarlo,
        descárgalo.
      </p>
      <ModelStudio files={files ?? []} />
    </>
  );
}
