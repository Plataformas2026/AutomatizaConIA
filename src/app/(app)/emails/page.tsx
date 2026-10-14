import { redirect } from 'next/navigation';
import { getSessionContext } from '@/lib/auth';
import { OutboxPanel, type OutboxItem } from '@/components/email/OutboxPanel';

export const dynamic = 'force-dynamic';

export default async function EmailsPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect('/login');

  const [{ data: rows }, { data: projects }, { data: files }] = await Promise.all([
    ctx.supabase
      .from('email_outbox')
      .select('id, file_id, project_id, file_name, rule_name, sheet_name, row_number, from_addr, to_addr, cc_addr, subject, body, problem, status, created_at')
      .eq('company_id', ctx.companyId)
      .in('status', ['pending', 'drafted'])
      .order('created_at', { ascending: false })
      .limit(100),
    ctx.supabase.from('projects').select('id, name').eq('company_id', ctx.companyId).order('created_at', { ascending: true }),
    ctx.supabase.from('shared_files_metadata').select('id, project_id').eq('company_id', ctx.companyId),
  ]);

  // El proyecto actual es el del archivo (si lo moviste de proyecto, el correo te sigue).
  const fileProject = new Map((files ?? []).map((f) => [f.id as string, f.project_id as string | null]));
  const names = new Map((projects ?? []).map((p) => [p.id as string, p.name as string]));

  const items: OutboxItem[] = (rows ?? []).map((o) => {
    const projectId = (o.file_id ? fileProject.get(o.file_id) : undefined) ?? o.project_id ?? null;
    return {
      id: o.id,
      fileName: o.file_name,
      ruleName: o.rule_name,
      sheetName: o.sheet_name,
      rowNumber: o.row_number,
      from: o.from_addr,
      to: o.to_addr ?? '',
      cc: o.cc_addr ?? '',
      subject: o.subject ?? '',
      body: o.body ?? '',
      problem: o.problem,
      status: o.status as 'pending' | 'drafted',
      projectId,
      projectName: projectId ? (names.get(projectId) ?? null) : null,
      createdAt: o.created_at,
    };
  });

  return (
    <>
      <h1>Correos pendientes</h1>
      <p className="sub">
        Correos que tus reglas han preparado con los datos de tus archivos y que todavía no se han enviado. Cada uno
        pertenece al proyecto de su archivo. Cópialo a tu Outlook, envíalo y pulsa «Ya lo he enviado».
      </p>
      <OutboxPanel items={items} projects={(projects ?? []).map((p) => ({ id: p.id as string, name: p.name as string }))} />
    </>
  );
}
