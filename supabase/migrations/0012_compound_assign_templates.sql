-- 0012 · Reglas compuestas (no necesitan cambios de esquema: la condición ya es jsonb), alertas por persona
--        y plantillas que se rellenan con los datos de una fila.
--
-- PRIVACIDAD (igual que el resto de la plataforma): aquí NUNCA se guardan filas ni celdas.
--  · Reparto por persona: por cada alerta se guarda, por persona, SOLO una huella (hash) de su nombre/correo y
--    los NÚMEROS de fila que le corresponden. El nombre o correo de la celda no se guarda en claro.
--  · Plantillas: es el documento en blanco con sus {{campos}} y el mapeo campo → nombre de columna. Los datos de
--    la fila se leen en el momento de pulsar «Rellenar» (en tu PC o al vuelo en el servidor) y no se guardan.

-- 1) Alertas: reparto por persona y plantilla ---------------------------
alter table public.alerts
  add column if not exists assignees jsonb not null default '{}'::jsonb;
alter table public.alerts
  drop constraint if exists alerts_assignees_check;
alter table public.alerts
  add constraint alerts_assignees_check check (jsonb_typeof(assignees) = 'object' and pg_column_size(assignees) <= 20000);

-- 2) Nombres por los que se conoce a cada usuario en las columnas de reparto ---
--    («María López», «mlopez»…). Los gestiona el administrador; el correo del usuario se reconoce solo.
create table if not exists public.user_aliases (
  user_id    uuid not null references auth.users(id) on delete cascade,
  alias      text not null check (char_length(alias) between 1 and 100),
  created_at timestamptz not null default now(),
  primary key (user_id, alias)
);
alter table public.user_aliases enable row level security;
drop policy if exists user_aliases_select on public.user_aliases;
create policy user_aliases_select on public.user_aliases for select to authenticated using (user_id = auth.uid());
revoke all on public.user_aliases from anon, authenticated;
grant select on public.user_aliases to authenticated;

-- 3) Plantillas ----------------------------------------------------------
create table if not exists public.report_templates (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 120),
  file_name   text not null check (char_length(file_name) <= 200),
  content_b64 text not null check (char_length(content_b64) <= 1800000),   -- ≈ 1,3 MB de .docx
  fields      jsonb not null default '[]'::jsonb,                           -- {{campos}} que contiene
  mapping     jsonb not null default '{}'::jsonb,                           -- campo → nombre de columna
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists report_templates_company_idx on public.report_templates (company_id);
alter table public.report_templates enable row level security;
drop policy if exists report_templates_select on public.report_templates;
create policy report_templates_select on public.report_templates for select to authenticated
  using (company_id in (select company_id from public.company_members where user_id = auth.uid()));
revoke all on public.report_templates from anon, authenticated;
grant select (id, company_id, name, file_name, fields, created_at) on public.report_templates to authenticated;
-- (las altas y cambios las hace el servidor con service_role, solo para administradores)

alter table public.alerts
  add column if not exists template_id uuid references public.report_templates(id) on delete set null;

-- 4) El agente descarga la plantilla (solo de SU empresa) para rellenarla en el PC ----
create or replace function public.agent_get_template(p_token text, p_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare a public.local_agents; t public.report_templates;
begin
  a := public._agent_auth(p_token);
  select * into t from public.report_templates where id = p_id and company_id = a.company_id;
  if not found then return null; end if;
  return jsonb_build_object('id', t.id, 'name', t.name, 'content_b64', t.content_b64, 'mapping', t.mapping);
end $$;
revoke all on function public.agent_get_template(text, uuid) from public;
grant execute on function public.agent_get_template(text, uuid) to anon, authenticated;

-- 5) El agente informa de las alertas con su reparto y plantilla ----------
create or replace function public.agent_report_rule(
  p_token text, p_file uuid, p_rule uuid, p_fingerprints jsonb, p_error text, p_alerts jsonb,
  p_emails jsonb default '[]'::jsonb
) returns integer
language plpgsql security definer set search_path = public as $$
declare a public.local_agents; f public.shared_files_metadata; r public.rules; n integer := 0;
begin
  a := public._agent_auth(p_token);

  select * into f from public.shared_files_metadata
   where id = p_file and agent_id = a.id and source = 'local';
  if not found then raise exception 'file_not_found'; end if;

  select * into r from public.rules where id = p_rule and file_id = f.id;
  if not found then return 0; end if;

  if p_error is not null then
    update public.rules set last_error = left(p_error, 300), last_evaluated_at = now() where id = r.id;
    return 0;
  end if;

  if p_alerts is not null and jsonb_typeof(p_alerts) <> 'array' then raise exception 'invalid_alerts'; end if;
  if p_alerts is not null and jsonb_array_length(p_alerts) > 300 then raise exception 'too_many_alerts'; end if;
  if p_emails is not null and jsonb_typeof(p_emails) <> 'array' then raise exception 'invalid_emails'; end if;
  if p_emails is not null and jsonb_array_length(p_emails) > 100 then raise exception 'too_many_emails'; end if;
  if p_fingerprints is not null and pg_column_size(p_fingerprints) > 20000 then raise exception 'fingerprints_too_large'; end if;

  insert into public.alerts
    (company_id, file_id, rule_id, file_name, rule_name, sheet_name, message, severity, matched_count, row_refs,
     assignees, template_id)
  select f.company_id, f.id, r.id, f.name, r.name,
         nullif(left(t.x->>'sheet', 200), ''),
         left(coalesce(t.x->>'message', ''), 500),
         case when t.x->>'severity' in ('info', 'warning', 'critical') then t.x->>'severity' else 'info' end,
         greatest(0, least(coalesce((t.x->>'count')::bigint, 0), 2000000000))::int,
         coalesce((select array_agg(v.n)
                     from (select e.val::int as n
                             from jsonb_array_elements_text(coalesce(t.x->'rows', '[]'::jsonb)) as e(val)
                            limit 200) v), '{}'),
         case when jsonb_typeof(t.x->'assignees') = 'object' and pg_column_size(t.x->'assignees') <= 20000
              then t.x->'assignees' else '{}'::jsonb end,
         (select rt.id from public.report_templates rt
           where (t.x->>'template') ~ '^[0-9a-fA-F-]{36}$' and rt.id = (t.x->>'template')::uuid and rt.company_id = f.company_id)
    from jsonb_array_elements(coalesce(p_alerts, '[]'::jsonb)) as t(x);
  get diagnostics n = row_count;

  insert into public.email_outbox
    (company_id, project_id, file_id, rule_id, file_name, rule_name, sheet_name, row_number,
     dedupe_key, from_addr, to_addr, cc_addr, subject, body, problem)
  select f.company_id, f.project_id, f.id, r.id, f.name, r.name,
         nullif(left(t.x->>'sheet', 200), ''),
         case when (t.x->>'row') ~ '^[0-9]{1,9}$' then (t.x->>'row')::int end,
         left(coalesce(t.x->>'key', md5(t.x::text)), 100),
         nullif(left(t.x->>'from', 320), ''),
         left(coalesce(t.x->>'to', ''), 1000),
         nullif(left(t.x->>'cc', 1000), ''),
         left(coalesce(t.x->>'subject', ''), 300),
         left(coalesce(t.x->>'body', ''), 8000),
         nullif(left(t.x->>'problem', 300), '')
    from jsonb_array_elements(coalesce(p_emails, '[]'::jsonb)) as t(x)
  on conflict (rule_id, dedupe_key) do nothing;

  update public.rules
     set last_fingerprints = coalesce(p_fingerprints, '{}'::jsonb), last_error = null, last_evaluated_at = now()
   where id = r.id;
  return n;
end $$;
revoke all on function public.agent_report_rule(text, uuid, uuid, jsonb, text, jsonb, jsonb) from public;
grant execute on function public.agent_report_rule(text, uuid, uuid, jsonb, text, jsonb, jsonb) to anon, authenticated;
