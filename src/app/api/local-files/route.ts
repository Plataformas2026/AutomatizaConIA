import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { getSessionContext } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { baseName, extensionOf, LOCAL_MIME_BY_EXT, localFilesSchema } from '@/lib/agents/types';

export const dynamic = 'force-dynamic';

/**
 * Registra archivos LOCALES. Solo se guarda el nombre (y, si el usuario la da, la ruta):
 * el navegador no sube nada. El agente del PC los localiza y los vigila.
 */
export async function POST(req: Request) {
  const ctx = await getSessionContext();
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = localFilesSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  const { agentId, projectId, files } = body.data;

  // RLS: agente y proyecto deben ser de MI empresa.
  const { data: agent } = await ctx.supabase.from('local_agents').select('id').eq('id', agentId).maybeSingle();
  if (!agent) return NextResponse.json({ error: 'agent_not_found' }, { status: 404 });
  if (projectId) {
    const { data: project } = await ctx.supabase.from('projects').select('id').eq('id', projectId).maybeSingle();
    if (!project) return NextResponse.json({ error: 'project_not_found' }, { status: 404 });
  }

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from('shared_files_metadata')
    .select('name')
    .eq('agent_id', agent.id)
    .eq('source', 'local');
  const taken = new Set((existing ?? []).map((f) => f.name.toLowerCase()));

  const rows: Record<string, unknown>[] = [];
  const duplicates: string[] = [];
  const invalid: string[] = [];

  for (const f of files) {
    const mime = LOCAL_MIME_BY_EXT[extensionOf(f.name)];
    const path = f.path?.trim() || null;
    // Si dan ruta, debe acabar en el mismo nombre de archivo (evita erratas).
    if (!mime || (path && baseName(path).toLowerCase() !== f.name.toLowerCase())) {
      invalid.push(f.name);
      continue;
    }
    if (taken.has(f.name.toLowerCase())) {
      duplicates.push(f.name);
      continue;
    }
    taken.add(f.name.toLowerCase());
    rows.push({
      company_id: ctx.companyId,
      source: 'local',
      agent_id: agent.id,
      google_token_id: null,
      drive_file_id: `local:${randomUUID()}`, // clave única sintética: no es un archivo de Drive
      name: f.name,
      mime_type: mime,
      status: 'active',
      local_path: path,
      sheet_mode: 'first',
      sheet_names: [],
      created_by: ctx.user.id,
      project_id: projectId ?? null,
    });
  }

  if (rows.length) {
    const { error } = await admin.from('shared_files_metadata').insert(rows);
    if (error) return NextResponse.json({ error: 'db_error' }, { status: 500 });
  }
  return NextResponse.json({ added: rows.length, duplicates, invalid }, { status: 201 });
}
