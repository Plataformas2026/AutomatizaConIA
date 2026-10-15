-- 0014: Registro central de los agentes («Logs»).
-- El agente envía SOLO avisos y errores (y unos pocos eventos de estado, como «Agente en marcha»),
-- con el texto ya limpiado de correos. Nunca filas ni celdas de tus archivos.
-- Se conservan 14 días y un máximo de 1000 registros por agente.
create table if not exists public.agent_logs (
  id          bigint generated always as identity primary key,
  company_id  uuid not null references public.companies(id) on delete cascade,
  agent_id    uuid not null references public.local_agents(id) on delete cascade,
  level       text not null check (level in ('info', 'warning', 'error')),
  message     text not null check (char_length(message) between 1 and 500),
  occurrences integer not null default 1 check (occurrences between 1 and 100000),
  logged_at   timestamptz not null default now(),   -- cuándo ocurrió en el ordenador del agente
  created_at  timestamptz not null default now()    -- cuándo llegó
);
create index if not exists agent_logs_company_idx on public.agent_logs (company_id, created_at desc);
create index if not exists agent_logs_agent_idx on public.agent_logs (agent_id, id desc);

alter table public.agent_logs enable row level security;
drop policy if exists agent_logs_select on public.agent_logs;
create policy agent_logs_select on public.agent_logs
  for select to authenticated using (public.is_company_member(company_id));
revoke all on public.agent_logs from anon, authenticated;
grant select on public.agent_logs to authenticated;

-- El agente entrega un lote: [{"level":"warning","message":"…","n":3,"age":42}]  (age = segundos desde que ocurrió)
create or replace function public.agent_report_logs(p_token text, p_entries jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare a public.local_agents; inserted integer;
begin
  a := public._agent_auth(p_token);
  if p_entries is null or jsonb_typeof(p_entries) <> 'array' then raise exception 'invalid_entries'; end if;

  -- Freno: un agente descontrolado no llena la base de datos.
  if (select count(*) from public.agent_logs where agent_id = a.id and created_at > now() - interval '1 hour') >= 500 then
    return 0;
  end if;

  insert into public.agent_logs (company_id, agent_id, level, message, occurrences, logged_at)
  select a.company_id, a.id,
         case lower(coalesce(e->>'level', '')) when 'error' then 'error' when 'warning' then 'warning' else 'info' end,
         left(btrim(e->>'message'), 500),
         case when (e->>'n') ~ '^[0-9]{1,5}$' and (e->>'n')::int >= 1 then (e->>'n')::int else 1 end,
         now() - make_interval(secs => case when (e->>'age') ~ '^[0-9]{1,5}$' then least((e->>'age')::int, 86400) else 0 end)
    from (select value as e from jsonb_array_elements(p_entries) limit 50) s
   where btrim(coalesce(e->>'message', '')) <> '';
  get diagnostics inserted = row_count;

  delete from public.agent_logs
   where agent_id = a.id
     and id not in (select id from public.agent_logs where agent_id = a.id order by id desc limit 1000);
  return inserted;
end $$;
revoke all on function public.agent_report_logs(text, jsonb) from public;
grant execute on function public.agent_report_logs(text, jsonb) to anon, authenticated;

-- Limpieza diaria (la llama el cron existente).
create or replace function public.purge_agent_logs()
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  delete from public.agent_logs where created_at < now() - interval '14 days';
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.purge_agent_logs() from public, anon, authenticated;

-- Tiempo real: la pestaña «Logs» se actualiza sola (RLS aplica a Realtime).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'agent_logs'
  ) then
    alter publication supabase_realtime add table public.agent_logs;
  end if;
end $$;
