-- =====================================================================
-- 0007_local_agent.sql · Archivos LOCALES vigilados por un agente en tu PC
--
-- El archivo NUNCA sale de tu ordenador. Un programa (agente, Python + Watchdog)
-- lo lee en local, evalúa tus reglas y envía aquí SOLO:
--   · nombres de hojas y de columnas (estructura, para el creador de reglas),
--   · alertas (texto de tu regla + nº de fila),
--   · el estado (ok / error) y una huella de versión.
-- Nunca contenido de celdas.
--
-- Seguridad: el agente NO usa la clave service_role. Usa un token propio
-- (revocable, guardado solo como hash) que únicamente permite las 3 funciones
-- de abajo, y solo sobre los archivos asignados a ese agente.
-- Idempotente: se puede ejecutar más de una vez.
-- =====================================================================

-- 1) Agentes ----------------------------------------------------------
create table if not exists public.local_agents (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  name          text not null check (char_length(name) between 1 and 60),
  token_hash    text not null unique,          -- sha256 del token; el token en claro no se guarda
  status        text not null default 'active' check (status in ('active', 'revoked')),
  last_seen_at  timestamptz,
  agent_version text,
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists local_agents_company_idx on public.local_agents (company_id);

alter table public.local_agents enable row level security;

drop policy if exists local_agents_select on public.local_agents;
create policy local_agents_select on public.local_agents
  for select to authenticated using (public.is_company_member(company_id));

-- El navegador puede ver el estado de sus agentes, pero nunca el hash del token.
-- Altas y bajas se hacen desde la API con service_role.
revoke all on public.local_agents from anon, authenticated;
grant select (id, company_id, name, status, last_seen_at, agent_version, created_at)
  on public.local_agents to authenticated;

-- 2) Archivos locales en shared_files_metadata ------------------------
alter table public.shared_files_metadata alter column google_token_id drop not null;

alter table public.shared_files_metadata
  add column if not exists source          text not null default 'drive' check (source in ('drive', 'local')),
  add column if not exists agent_id        uuid references public.local_agents(id) on delete set null,
  add column if not exists local_path      text check (local_path is null or char_length(local_path) <= 500),
  add column if not exists local_structure jsonb;   -- {"sheets":[…], "tables":[{"sheet":…, "columns":[…]}]}: solo nombres

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'shared_files_source_token_check') then
    alter table public.shared_files_metadata
      add constraint shared_files_source_token_check
      check (source = 'local' or google_token_id is not null);
  end if;
end $$;

create index if not exists shared_files_agent_idx on public.shared_files_metadata (agent_id) where source = 'local';

-- 3) Funciones del agente (se llaman con la clave anon + token propio) -
-- Comprueba el token y devuelve el agente. Interna: nadie la llama desde fuera.
create or replace function public._agent_auth(p_token text)
returns public.local_agents
language plpgsql stable security definer set search_path = public as $$
declare a public.local_agents;
begin
  if p_token is null or char_length(p_token) < 32 or char_length(p_token) > 200 then
    raise exception 'invalid_token';
  end if;
  select * into a from public.local_agents
   where token_hash = encode(sha256(convert_to(p_token, 'utf8')), 'hex') and status = 'active';
  if not found then raise exception 'invalid_token'; end if;
  return a;
end $$;
revoke all on function public._agent_auth(text) from public, anon, authenticated;

-- Configuración del agente: sus archivos y las reglas activas de cada uno.
create or replace function public.agent_get_config(p_token text, p_version text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare a public.local_agents; result jsonb;
begin
  a := public._agent_auth(p_token);

  if a.last_seen_at is null or a.last_seen_at < now() - interval '45 seconds'
     or a.agent_version is distinct from left(p_version, 20) then
    update public.local_agents set last_seen_at = now(), agent_version = left(p_version, 20) where id = a.id;
  end if;

  select jsonb_build_object(
    'agent', jsonb_build_object('id', a.id, 'name', a.name),
    'files', coalesce(jsonb_agg(
      jsonb_build_object(
        'id', f.id,
        'name', f.name,
        'path', f.local_path,
        'sheet_mode', f.sheet_mode,
        'sheet_names', to_jsonb(f.sheet_names),
        'has_structure', f.local_structure is not null,
        'rules', coalesce((
          select jsonb_agg(jsonb_build_object(
                   'id', r.id, 'name', r.name, 'condition', r.condition, 'actions', r.actions,
                   'updated_at', r.updated_at, 'fingerprints', r.last_fingerprints)
                 order by r.created_at)
            from public.rules r where r.file_id = f.id and r.enabled), '[]'::jsonb)
      ) order by f.created_at), '[]'::jsonb))
    into result
    from public.shared_files_metadata f
   where f.agent_id = a.id and f.source = 'local' and f.status not in ('paused', 'revoked');

  return result;
end $$;

-- Estado de un archivo: ok/error, versión y estructura (solo nombres).
create or replace function public.agent_report_file(
  p_token text, p_file uuid, p_status text, p_error text, p_version text, p_structure jsonb
) returns void
language plpgsql security definer set search_path = public as $$
declare a public.local_agents;
begin
  a := public._agent_auth(p_token);
  if p_status not in ('active', 'error') then raise exception 'invalid_status'; end if;
  if p_structure is not null and pg_column_size(p_structure) > 200000 then raise exception 'structure_too_large'; end if;

  update public.shared_files_metadata
     set status          = p_status::public.file_status,
         last_error      = left(p_error, 300),
         last_checked_at = now(),
         last_version    = coalesce(left(p_version, 80), last_version),
         local_structure = coalesce(p_structure, local_structure)
   where id = p_file and agent_id = a.id and source = 'local' and status not in ('paused', 'revoked');
end $$;

-- Resultado de evaluar UNA regla: alertas nuevas + huellas, en una sola transacción.
create or replace function public.agent_report_rule(
  p_token text, p_file uuid, p_rule uuid, p_fingerprints jsonb, p_error text, p_alerts jsonb
) returns integer
language plpgsql security definer set search_path = public as $$
declare a public.local_agents; f public.shared_files_metadata; r public.rules; n integer := 0;
begin
  a := public._agent_auth(p_token);

  select * into f from public.shared_files_metadata
   where id = p_file and agent_id = a.id and source = 'local';
  if not found then raise exception 'file_not_found'; end if;

  select * into r from public.rules where id = p_rule and file_id = f.id;
  if not found then return 0; end if;  -- la regla se borró mientras tanto

  if p_error is not null then
    update public.rules set last_error = left(p_error, 300), last_evaluated_at = now() where id = r.id;
    return 0;
  end if;

  if p_alerts is not null and jsonb_typeof(p_alerts) <> 'array' then raise exception 'invalid_alerts'; end if;
  if p_alerts is not null and jsonb_array_length(p_alerts) > 300 then raise exception 'too_many_alerts'; end if;
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

  update public.rules
     set last_fingerprints = coalesce(p_fingerprints, '{}'::jsonb), last_error = null, last_evaluated_at = now()
   where id = r.id;
  return n;
end $$;

revoke all on function public.agent_get_config(text, text) from public;
revoke all on function public.agent_report_file(text, uuid, text, text, text, jsonb) from public;
revoke all on function public.agent_report_rule(text, uuid, uuid, jsonb, text, jsonb) from public;
grant execute on function public.agent_get_config(text, text) to anon, authenticated;
grant execute on function public.agent_report_file(text, uuid, text, text, text, jsonb) to anon, authenticated;
grant execute on function public.agent_report_rule(text, uuid, uuid, jsonb, text, jsonb) to anon, authenticated;
