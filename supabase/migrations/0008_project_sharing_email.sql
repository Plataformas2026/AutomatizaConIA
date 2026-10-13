-- =====================================================================
-- 0008 · Proyectos compartidos + alertas/estadísticas por proyecto
--        + correos pendientes (Outlook) + fin del almacenamiento de informes
--
-- ⚠ ATENCIÓN: este script ELIMINA la tabla ml_reports (informes guardados).
--   Los informes ya no se guardan: se generan al vuelo y se descargan.
--   Si tienes informes guardados que quieras conservar, ábrelos y descárgalos
--   o imprímelos ANTES de ejecutar este script.
--
-- Idempotente: se puede ejecutar más de una vez.
-- =====================================================================

-- 1) Informes: ya no se guardan -----------------------------------------
drop table if exists public.ml_reports cascade;

-- 2) Compartir proyectos --------------------------------------------------
-- Un proyecto compartido da a la otra persona acceso de SOLO LECTURA al proyecto,
-- a los metadatos de sus archivos, a sus alertas y a sus estadísticas.
-- Nunca a las reglas, a los correos pendientes ni a la configuración.
create table if not exists public.project_members (
  project_id  uuid not null references public.projects(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  invited_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index if not exists project_members_user_idx on public.project_members (user_id);

create table if not exists public.project_invitations (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  email       text not null check (email = lower(email) and char_length(email) between 5 and 254),
  invited_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (project_id, email)
);
create index if not exists project_invitations_email_idx on public.project_invitations (email);

-- Funciones auxiliares (security definer: evitan recursión entre políticas).
create or replace function public.is_project_member(p_project uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.project_members m
                  where m.project_id = p_project and m.user_id = auth.uid());
$$;

create or replace function public.can_view_project(p_project uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.projects p
     where p.id = p_project
       and (public.is_company_member(p.company_id) or public.is_project_member(p.id)));
$$;

create or replace function public.is_project_owner_member(p_project uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.projects p
                  where p.id = p_project and public.is_company_member(p.company_id));
$$;

revoke all on function public.is_project_member(uuid), public.can_view_project(uuid),
  public.is_project_owner_member(uuid) from public;
grant execute on function public.is_project_member(uuid), public.can_view_project(uuid),
  public.is_project_owner_member(uuid) to authenticated;

alter table public.project_members     enable row level security;
alter table public.project_invitations enable row level security;

drop policy if exists project_members_select on public.project_members;
create policy project_members_select on public.project_members
  for select to authenticated
  using (user_id = auth.uid() or public.is_project_owner_member(project_id));

drop policy if exists project_invitations_select on public.project_invitations;
create policy project_invitations_select on public.project_invitations
  for select to authenticated using (public.is_project_owner_member(project_id));

-- Altas y bajas solo desde la API (service_role).
revoke all on public.project_members, public.project_invitations from anon, authenticated;
grant select on public.project_members, public.project_invitations to authenticated;

-- Al entrar, la persona invitada "reclama" sus invitaciones. Solo si su correo
-- está CONFIRMADO (nadie puede apropiarse de una invitación registrándose con un correo ajeno).
create or replace function public.claim_project_invitations()
returns integer language plpgsql security definer set search_path = public, auth as $$
declare v_email text; n integer := 0;
begin
  if auth.uid() is null then return 0; end if;
  select lower(u.email) into v_email from auth.users u
   where u.id = auth.uid() and u.email_confirmed_at is not null;
  if v_email is null then return 0; end if;

  insert into public.project_members (project_id, user_id, invited_by)
  select i.project_id, auth.uid(), i.invited_by
    from public.project_invitations i
    join public.projects p on p.id = i.project_id
   where i.email = v_email
     and not exists (select 1 from public.company_members m
                      where m.company_id = p.company_id and m.user_id = auth.uid())
  on conflict do nothing;
  get diagnostics n = row_count;

  delete from public.project_invitations where email = v_email;
  return n;
end $$;
revoke all on function public.claim_project_invitations() from public, anon;
grant execute on function public.claim_project_invitations() to authenticated;

-- Quién puede ver qué --------------------------------------------------------
drop policy if exists projects_select on public.projects;
create policy projects_select on public.projects
  for select to authenticated
  using (public.is_company_member(company_id) or public.is_project_member(id));

-- Metadatos de archivos de proyectos compartidos (nombre, tipo, estado). Nunca contenido.
drop policy if exists files_select_shared on public.shared_files_metadata;
create policy files_select_shared on public.shared_files_metadata
  for select to authenticated
  using (project_id is not null and public.is_project_member(project_id));

-- 3) Alertas vinculadas a un proyecto -----------------------------------------
alter table public.alerts
  add column if not exists project_id uuid references public.projects(id) on delete set null;
create index if not exists alerts_project_idx on public.alerts (project_id, created_at desc);

-- Cada alerta hereda el proyecto de su archivo...
create or replace function public.alerts_set_project()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.file_id is not null then
    select f.project_id into new.project_id from public.shared_files_metadata f where f.id = new.file_id;
  end if;
  return new;
end $$;
drop trigger if exists alerts_set_project on public.alerts;
create trigger alerts_set_project before insert on public.alerts
  for each row execute function public.alerts_set_project();

-- ...y la sigue si el archivo cambia de proyecto.
create or replace function public.files_move_alerts()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.project_id is distinct from old.project_id then
    update public.alerts set project_id = new.project_id where file_id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists files_move_alerts on public.shared_files_metadata;
create trigger files_move_alerts after update of project_id on public.shared_files_metadata
  for each row execute function public.files_move_alerts();

update public.alerts a set project_id = f.project_id
  from public.shared_files_metadata f
 where a.file_id = f.id and a.project_id is distinct from f.project_id;

drop policy if exists alerts_select on public.alerts;
create policy alerts_select on public.alerts
  for select to authenticated
  using (public.is_company_member(company_id)
         or (project_id is not null and public.is_project_member(project_id)));
-- alerts_update / alerts_delete siguen siendo solo para la empresa propietaria.

-- 4) Estadísticas vinculadas a un proyecto -------------------------------------
alter table public.stats_charts
  add column if not exists project_id uuid references public.projects(id) on delete cascade;
create index if not exists stats_charts_project_idx on public.stats_charts (project_id, position);

-- Las gráficas existentes pasan al proyecto de su archivo (si lo tiene).
update public.stats_charts c set project_id = f.project_id
  from public.shared_files_metadata f
 where c.project_id is null
   and f.project_id is not null
   and c.config ? 'fileId'
   and f.id::text = c.config->>'fileId';

drop policy if exists stats_charts_select on public.stats_charts;
create policy stats_charts_select on public.stats_charts
  for select to authenticated
  using ((user_id = auth.uid() and public.is_company_member(company_id))
         or (project_id is not null and public.can_view_project(project_id)));

drop policy if exists stats_charts_insert on public.stats_charts;
create policy stats_charts_insert on public.stats_charts
  for insert to authenticated
  with check (
    user_id = auth.uid() and public.is_company_member(company_id)
    and (project_id is null
         or exists (select 1 from public.projects p
                     where p.id = project_id and p.company_id = stats_charts.company_id)));

drop policy if exists stats_charts_update on public.stats_charts;
create policy stats_charts_update on public.stats_charts
  for update to authenticated
  using (user_id = auth.uid() and public.is_company_member(company_id))
  with check (
    user_id = auth.uid() and public.is_company_member(company_id)
    and (project_id is null
         or exists (select 1 from public.projects p
                     where p.id = project_id and p.company_id = stats_charts.company_id)));
-- stats_charts_delete (de 0004) se mantiene: solo quien creó la gráfica.

-- 5) Correos pendientes (cola «Tienes pendiente mandar el correo…») ----------------
-- Se guarda el correo ya redactado SOLO mientras está pendiente. Al marcarlo como
-- enviado o descartado se borra su contenido (queda únicamente un registro sin datos).
create table if not exists public.email_outbox (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  project_id   uuid references public.projects(id) on delete set null,
  file_id      uuid references public.shared_files_metadata(id) on delete set null,
  rule_id      uuid references public.rules(id) on delete set null,
  file_name    text not null,
  rule_name    text not null default '',
  sheet_name   text,
  row_number   integer,
  dedupe_key   text not null check (char_length(dedupe_key) <= 100),
  from_addr    text check (from_addr is null or char_length(from_addr) <= 320),
  to_addr      text check (to_addr is null or char_length(to_addr) <= 1000),
  subject      text check (subject is null or char_length(subject) <= 300),
  body         text check (body is null or char_length(body) <= 8000),
  status       text not null default 'pending' check (status in ('pending', 'drafted', 'sent', 'dismissed')),
  problem      text check (problem is null or char_length(problem) <= 300),
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz,
  resolved_by  uuid references auth.users(id) on delete set null
);
-- Un mismo correo (misma regla + misma fila + mismo texto) no se crea dos veces.
create unique index if not exists email_outbox_dedupe_idx on public.email_outbox (rule_id, dedupe_key);
create index if not exists email_outbox_company_idx on public.email_outbox (company_id, status, created_at desc);

alter table public.email_outbox enable row level security;
drop policy if exists email_outbox_select on public.email_outbox;
create policy email_outbox_select on public.email_outbox
  for select to authenticated using (public.is_company_member(company_id));
revoke all on public.email_outbox from anon, authenticated;
grant select on public.email_outbox to authenticated;

-- Limpieza (la llama el cron diario): sin acumular datos.
create or replace function public.purge_email_outbox()
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  -- Resueltos: fuera el contenido de inmediato (por si algo quedó) y el registro a los 7 días.
  update public.email_outbox set to_addr = null, subject = null, body = null, from_addr = null
   where status in ('sent', 'dismissed') and (to_addr is not null or subject is not null or body is not null);
  delete from public.email_outbox where status in ('sent', 'dismissed') and resolved_at < now() - interval '7 days';
  -- Pendientes olvidados más de 30 días.
  delete from public.email_outbox where status in ('pending', 'drafted') and created_at < now() - interval '30 days';
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.purge_email_outbox() from public, anon, authenticated;

-- 6) Agente local: correos --------------------------------------------------------
create or replace function public.agent_get_outbox(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.local_agents;
begin
  a := public._agent_auth(p_token);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', o.id, 'from', o.from_addr, 'to', o.to_addr, 'subject', o.subject, 'body', o.body)
           order by o.created_at)
      from (select * from public.email_outbox
             where company_id = a.company_id and status = 'pending' and problem is null
               and to_addr ~ '^[^[:space:]@<>;,]+@[^[:space:]@<>;,]+\.[^[:space:]@<>;,]+([;,] ?[^[:space:]@<>;,]+@[^[:space:]@<>;,]+\.[^[:space:]@<>;,]+)*$'
               and subject is not null and body is not null
             order by created_at limit 20) o), '[]'::jsonb);
end $$;

create or replace function public.agent_report_email(
  p_token text, p_id uuid, p_status text, p_error text default null
) returns void language plpgsql security definer set search_path = public as $$
declare a public.local_agents;
begin
  a := public._agent_auth(p_token);
  if p_status not in ('sent', 'drafted', 'failed') then raise exception 'invalid_status'; end if;

  if p_status = 'sent' then
    update public.email_outbox
       set status = 'sent', resolved_at = now(), to_addr = null, subject = null, body = null, from_addr = null, problem = null
     where id = p_id and company_id = a.company_id and status in ('pending', 'drafted');
  elsif p_status = 'drafted' then
    update public.email_outbox set status = 'drafted', problem = null
     where id = p_id and company_id = a.company_id and status = 'pending';
  else
    update public.email_outbox
       set problem = 'El envío automático falló: ' || coalesce(nullif(left(p_error, 200), ''), 'error desconocido')
     where id = p_id and company_id = a.company_id and status = 'pending';
  end if;
end $$;

-- agent_report_rule ahora también recibe los correos redactados por el agente.
drop function if exists public.agent_report_rule(text, uuid, uuid, jsonb, text, jsonb);
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
    (company_id, file_id, rule_id, file_name, rule_name, sheet_name, message, severity, matched_count, row_refs)
  select f.company_id, f.id, r.id, f.name, r.name,
         nullif(left(t.x->>'sheet', 200), ''),
         left(coalesce(t.x->>'message', ''), 500),
         case when t.x->>'severity' in ('info', 'warning', 'critical') then t.x->>'severity' else 'info' end,
         greatest(0, least(coalesce((t.x->>'count')::bigint, 0), 2000000000))::int,
         coalesce((select array_agg(v.n)
                     from (select e.val::int as n
                             from jsonb_array_elements_text(coalesce(t.x->'rows', '[]'::jsonb)) as e(val)
                            limit 200) v), '{}')
    from jsonb_array_elements(coalesce(p_alerts, '[]'::jsonb)) as t(x);
  get diagnostics n = row_count;

  insert into public.email_outbox
    (company_id, project_id, file_id, rule_id, file_name, rule_name, sheet_name, row_number,
     dedupe_key, from_addr, to_addr, subject, body, problem)
  select f.company_id, f.project_id, f.id, r.id, f.name, r.name,
         nullif(left(t.x->>'sheet', 200), ''),
         case when (t.x->>'row') ~ '^[0-9]{1,9}$' then (t.x->>'row')::int end,
         left(coalesce(t.x->>'key', md5(t.x::text)), 100),
         nullif(left(t.x->>'from', 320), ''),
         left(coalesce(t.x->>'to', ''), 1000),
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

revoke all on function public.agent_get_outbox(text) from public;
revoke all on function public.agent_report_email(text, uuid, text, text) from public;
revoke all on function public.agent_report_rule(text, uuid, uuid, jsonb, text, jsonb, jsonb) from public;
grant execute on function public.agent_get_outbox(text) to anon, authenticated;
grant execute on function public.agent_report_email(text, uuid, text, text) to anon, authenticated;
grant execute on function public.agent_report_rule(text, uuid, uuid, jsonb, text, jsonb, jsonb) to anon, authenticated;
