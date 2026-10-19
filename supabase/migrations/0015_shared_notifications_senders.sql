-- 0015 · Notificaciones en proyectos compartidos, responsables por nombre y traspaso de tareas.
--
--  · Cada persona tiene su PROPIO estado de lectura de las alertas (alert_reads): los invitados ya tienen contador.
--  · Al compartir, cada invitado recibe «lo que le toque» (por las columnas del Excel) o «todo el proyecto»
--    (project_members.notify). Una regla puede además marcarse «para todos» (audience = 'everyone').
--  · Los correos pendientes tienen responsable (sender_user_id), resuelto a partir de la columna de la regla y de
--    los nombres que el administrador enlaza con usuarios (user_aliases.alias_key). «Nombre1 / Nombre2»: el primero
--    es el responsable y la tarea se puede pasar al siguiente (row_handoffs).
--  · El agente de cada responsable recoge SUS correos para dejarlos en SUS borradores.

-- 0) Utilidades -----------------------------------------------------------------------------
-- Mismo criterio que normalize() de la web y del agente: minúsculas, sin tildes, espacios simples.
create or replace function public._norm(t text) returns text language sql immutable as $$
  select translate(lower(btrim(regexp_replace(coalesce(t, ''), '\s+', ' ', 'g'))),
                   'áàäâãéèëêíìïîóòöôõúùüûñç', 'aaaaaeeeeiiiiooooouuuunc');
$$;

-- Huella de un nombre para una regla (igual que digest() de assign.ts / assign.py).
create or replace function public._digest(p_rule uuid, p_key text) returns text language sql immutable as $$
  select left(encode(sha256(convert_to(p_rule::text || '|' || p_key, 'utf8')), 'hex'), 16);
$$;

-- 1) Nombres enlazados con usuarios --------------------------------------------------------------
alter table public.user_aliases add column if not exists alias_key text;
update public.user_aliases set alias_key = public._norm(alias) where alias_key is null;
create index if not exists user_aliases_key_idx on public.user_aliases (alias_key);

-- Con qué claves puede aparecer una persona en una columna de responsable (correo, parte antes de la @, alias).
create or replace function public._user_keys(p_user uuid) returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_remove(
           array[public._norm(u.email), public._norm(split_part(u.email, '@', 1))]
           || coalesce((select array_agg(a.alias_key) from public.user_aliases a where a.user_id = u.id and a.alias_key is not null), '{}'),
           null), '{}')
    from auth.users u where u.id = p_user;
$$;
revoke all on function public._user_keys(uuid) from public, anon, authenticated;

-- Usuario al que corresponde un nombre dentro de un proyecto (miembros de la empresa o del proyecto).
-- Si dos usuarios comparten el mismo nombre es ambiguo: no se adivina (devuelve null).
create or replace function public._resolve_sender(p_company uuid, p_project uuid, p_key text) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare ids uuid[];
begin
  if p_key is null or btrim(p_key) = '' then return null; end if;
  select array_agg(u.id) into ids from (
    select u.id from auth.users u
     where (exists (select 1 from public.company_members m where m.company_id = p_company and m.user_id = u.id)
            or (p_project is not null and exists (select 1 from public.project_members pm where pm.project_id = p_project and pm.user_id = u.id)))
       and p_key = any (public._user_keys(u.id))
     limit 2) u;
  if ids is null or array_length(ids, 1) <> 1 then return null; end if;
  return ids[1];
end $$;
revoke all on function public._resolve_sender(uuid, uuid, text) from public, anon, authenticated;

-- 2) Lectura por usuario ---------------------------------------------------------------------------
alter table public.alerts
  add column if not exists rev      integer not null default 0,                -- sube cuando una tarea cambia de manos
  add column if not exists audience text    not null default 'assigned' check (audience in ('assigned', 'everyone')),
  add column if not exists chains   jsonb   not null default '{}'::jsonb;      -- { "fila": ["huella1", "huella2"] }

create table if not exists public.alert_reads (
  user_id  uuid not null references auth.users(id) on delete cascade,
  alert_id uuid not null references public.alerts(id) on delete cascade,
  rev      integer not null default 0,
  read_at  timestamptz not null default now(),
  primary key (user_id, alert_id)
);
alter table public.alert_reads enable row level security;
drop policy if exists alert_reads_select on public.alert_reads;
create policy alert_reads_select on public.alert_reads for select to authenticated using (user_id = auth.uid());
revoke all on public.alert_reads from anon, authenticated;
grant select on public.alert_reads to authenticated;

create or replace function public.mark_alerts_read(p_ids uuid[]) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if auth.uid() is null then raise exception 'unauthorized' using errcode = '42501'; end if;
  insert into public.alert_reads (user_id, alert_id, rev)
  select auth.uid(), a.id, a.rev
    from public.alerts a
   where a.id = any ((p_ids)[1:300])
     and (public.is_company_member(a.company_id) or (a.project_id is not null and public.is_project_member(a.project_id)))
  on conflict (user_id, alert_id) do update set rev = excluded.rev, read_at = now();
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.mark_alerts_read(uuid[]) from public, anon;
grant execute on function public.mark_alerts_read(uuid[]) to authenticated;

-- 3) Qué recibe cada persona con la que se comparte --------------------------------------------------
--   assigned = lo que le toque por las columnas del Excel + lo marcado «para todos»;  all = todo el proyecto.
alter table public.project_members
  add column if not exists notify text not null default 'assigned' check (notify in ('assigned', 'all'));

create or replace function public.project_notify_all(p_project uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.project_members m
                  where m.project_id = p_project and m.user_id = auth.uid() and m.notify = 'all');
$$;
revoke all on function public.project_notify_all(uuid) from public, anon;
grant execute on function public.project_notify_all(uuid) to authenticated;

-- «Para todos» y responsable se leen de la regla (no se confía en lo que diga quien envía).
create or replace function public._rule_action_text(p_rule uuid, p_type text, p_key text) returns text
language sql stable security definer set search_path = public as $$
  select x->>p_key from public.rules r, jsonb_array_elements(r.actions) x
   where r.id = p_rule and x->>'type' = p_type limit 1;
$$;
revoke all on function public._rule_action_text(uuid, text, text) from public, anon, authenticated;

create or replace function public.alerts_set_audience() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.rule_id is not null then
    new.audience := case when public._rule_action_text(new.rule_id, 'alert', 'audience') = 'everyone' then 'everyone' else 'assigned' end;
  end if;
  return new;
end $$;
drop trigger if exists alerts_set_audience on public.alerts;
create trigger alerts_set_audience before insert on public.alerts
  for each row execute function public.alerts_set_audience();

-- 4) Correos pendientes con responsable ---------------------------------------------------------------
alter table public.email_outbox
  add column if not exists audience       text    not null default 'assigned' check (audience in ('assigned', 'everyone')),
  add column if not exists sender_chain   text[]  not null default '{}',     -- nombres normalizados: [responsable, 2.º, 3.º…]
  add column if not exists sender_level   integer not null default 0 check (sender_level between 0 and 10),
  add column if not exists sender_user_id uuid references auth.users(id) on delete set null;
create index if not exists email_outbox_sender_idx on public.email_outbox (sender_user_id, status) where sender_user_id is not null;

create or replace function public.email_outbox_prepare() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.audience := case when public._rule_action_text(new.rule_id, 'email', 'audience') = 'everyone' then 'everyone' else 'assigned' end;
  if cardinality(new.sender_chain) > 0 then
    new.sender_level := 0;
    new.sender_user_id := public._resolve_sender(new.company_id, new.project_id, new.sender_chain[1]);
    if new.sender_user_id is null and new.problem is null and new.audience = 'assigned' then
      new.problem := 'Responsable sin vincular: pide al administrador que enlace su nombre con un usuario.';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists email_outbox_prepare on public.email_outbox;
create trigger email_outbox_prepare before insert on public.email_outbox
  for each row execute function public.email_outbox_prepare();

-- Quién ve cada correo: la empresa dueña; su responsable; todo el proyecto si es «para todos»; y quien lo recibe todo.
drop policy if exists email_outbox_select on public.email_outbox;
create policy email_outbox_select on public.email_outbox
  for select to authenticated
  using (public.is_company_member(company_id)
         or sender_user_id = auth.uid()
         or (project_id is not null and public.is_project_member(project_id)
             and (audience = 'everyone' or public.project_notify_all(project_id))));

-- Si un archivo cambia de proyecto, sus correos pendientes lo siguen.
create or replace function public.files_move_outbox() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.project_id is distinct from old.project_id then
    update public.email_outbox set project_id = new.project_id where file_id = new.id and status in ('pending', 'drafted');
  end if;
  return new;
end $$;
drop trigger if exists files_move_outbox on public.shared_files_metadata;
create trigger files_move_outbox after update of project_id on public.shared_files_metadata
  for each row execute function public.files_move_outbox();

-- 5) Traspaso de tareas («pasar a nombre2») ------------------------------------------------------------
create table if not exists public.row_handoffs (
  rule_id    uuid not null references public.rules(id) on delete cascade,
  sheet      text not null default '',
  row_number integer not null,
  level      integer not null check (level between 0 and 10),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (rule_id, sheet, row_number)
);
alter table public.row_handoffs enable row level security;
drop policy if exists row_handoffs_select on public.row_handoffs;
create policy row_handoffs_select on public.row_handoffs
  for select to authenticated
  using (public.is_company_member(company_id) or (project_id is not null and public.is_project_member(project_id)));
revoke all on public.row_handoffs from anon, authenticated;
grant select on public.row_handoffs to authenticated;

-- Nombre con el que se muestra a una persona (su primer alias o la parte del correo antes de la @).
create or replace function public._user_label(p_user uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select a.alias from public.user_aliases a where a.user_id = u.id order by a.created_at limit 1),
                  split_part(u.email, '@', 1))
    from auth.users u where u.id = p_user;
$$;
revoke all on function public._user_label(uuid) from public, anon, authenticated;

-- Quién tiene una huella dentro de un proyecto (null si nadie conocido).
create or replace function public._holder_of(p_company uuid, p_project uuid, p_rule uuid, p_hash text) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare uid uuid;
begin
  if p_hash is null then return null; end if;
  select u.id into uid from auth.users u
   where (exists (select 1 from public.company_members m where m.company_id = p_company and m.user_id = u.id)
          or (p_project is not null and exists (select 1 from public.project_members pm where pm.project_id = p_project and pm.user_id = u.id)))
     and exists (select 1 from unnest(public._user_keys(u.id)) k where public._digest(p_rule, k) = p_hash)
   limit 1;
  return uid;
end $$;
revoke all on function public._holder_of(uuid, uuid, uuid, text) from public, anon, authenticated;

-- Quién tiene ahora cada fila de la alerta, y a quién pasaría / devolvería. Solo para filas pedidas (máx. 40).
create or replace function public.alert_task_labels(p_alert uuid, p_rows integer[]) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare a public.alerts; r integer; chain jsonb; cur integer; len integer; out jsonb := '{}'::jsonb; me uuid := auth.uid();
begin
  select * into a from public.alerts x
   where x.id = p_alert and (public.is_company_member(x.company_id) or (x.project_id is not null and public.is_project_member(x.project_id)));
  if not found or a.rule_id is null then return '{}'::jsonb; end if;
  foreach r in array coalesce((p_rows)[1:40], '{}') loop
    chain := a.chains -> r::text;
    if chain is null or jsonb_typeof(chain) <> 'array' or jsonb_array_length(chain) < 2 then continue; end if;
    len := jsonb_array_length(chain);
    select level into cur from public.row_handoffs
     where rule_id = a.rule_id and sheet = coalesce(a.sheet_name, '') and row_number = r;
    cur := least(coalesce(cur, 0), len - 1);
    out := out || jsonb_build_object(r::text, jsonb_build_object(
      'level', cur, 'len', len,
      'now',  public._user_label(public._holder_of(a.company_id, a.project_id, a.rule_id, chain ->> cur)),
      'next', case when cur + 1 < len then public._user_label(public._holder_of(a.company_id, a.project_id, a.rule_id, chain ->> (cur + 1))) end,
      'prev', case when cur > 0 then public._user_label(public._holder_of(a.company_id, a.project_id, a.rule_id, chain ->> (cur - 1))) end,
      'canPass', cur + 1 < len,
      'canBack', cur > 0,
      'mine', public._holder_of(a.company_id, a.project_id, a.rule_id, chain ->> cur) = me));
  end loop;
  return out;
end $$;
revoke all on function public.alert_task_labels(uuid, integer[]) from public, anon;
grant execute on function public.alert_task_labels(uuid, integer[]) to authenticated;

-- p_delta = 1 → pasar a la siguiente persona · -1 → devolver a la anterior.
create or replace function public.handoff_task(p_alert uuid, p_row integer, p_delta integer) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a public.alerts; chain jsonb; len integer; cur integer; nxt integer; me uuid := auth.uid(); allowed boolean; k text;
begin
  if me is null then raise exception 'unauthorized' using errcode = '42501'; end if;
  if p_delta not in (-1, 1) then raise exception 'invalid_delta'; end if;
  select * into a from public.alerts x
   where x.id = p_alert and (public.is_company_member(x.company_id) or (x.project_id is not null and public.is_project_member(x.project_id)));
  if not found or a.rule_id is null then raise exception 'not_found'; end if;

  chain := a.chains -> p_row::text;
  if chain is null or jsonb_typeof(chain) <> 'array' or jsonb_array_length(chain) < 2 then raise exception 'no_chain'; end if;
  len := jsonb_array_length(chain);
  select level into cur from public.row_handoffs
   where rule_id = a.rule_id and sheet = coalesce(a.sheet_name, '') and row_number = p_row;
  cur := least(coalesce(cur, 0), len - 1);
  nxt := cur + p_delta;
  if nxt < 0 or nxt >= len then raise exception 'out_of_range'; end if;

  -- Puede traspasar: el dueño del proyecto o quien tiene ahora la tarea.
  allowed := public.is_company_member(a.company_id);
  if not allowed then
    foreach k in array public._user_keys(me) loop
      if public._digest(a.rule_id, k) = chain ->> cur then allowed := true; exit; end if;
    end loop;
  end if;
  if not allowed then raise exception 'forbidden' using errcode = '42501'; end if;

  insert into public.row_handoffs (rule_id, sheet, row_number, level, company_id, project_id, updated_by)
  values (a.rule_id, coalesce(a.sheet_name, ''), p_row, nxt, a.company_id, a.project_id, me)
  on conflict (rule_id, sheet, row_number) do update set level = excluded.level, updated_by = me, updated_at = now();

  update public.alerts set rev = rev + 1 where id = a.id;   -- vuelve a salir como no leída para quien la recibe

  -- El correo pendiente de esa fila pasa a la nueva persona (su agente creará su borrador).
  update public.email_outbox o
     set sender_level = nxt,
         sender_user_id = public._resolve_sender(o.company_id, o.project_id, o.sender_chain[nxt + 1]),
         status = 'pending',
         problem = case when public._resolve_sender(o.company_id, o.project_id, o.sender_chain[nxt + 1]) is null and o.audience = 'assigned'
                        then 'Responsable sin vincular: pide al administrador que enlace su nombre con un usuario.'
                        else null end
   where o.rule_id = a.rule_id and o.sheet_name is not distinct from a.sheet_name and o.row_number = p_row
     and o.status in ('pending', 'drafted') and cardinality(o.sender_chain) >= nxt + 1;
  return jsonb_build_object('level', nxt);
end $$;
revoke all on function public.handoff_task(uuid, integer, integer) from public, anon;
grant execute on function public.handoff_task(uuid, integer, integer) to authenticated;

-- Tras enlazar un nombre nuevo, los correos que estaban «sin vincular» se resuelven solos.
create or replace function public.resolve_pending_senders(p_company uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  update public.email_outbox o
     set sender_user_id = public._resolve_sender(o.company_id, o.project_id, o.sender_chain[o.sender_level + 1]),
         problem = case when o.problem like 'Responsable sin vincular%' then null else o.problem end
   where o.company_id = p_company and o.status = 'pending' and o.sender_user_id is null
     and cardinality(o.sender_chain) > o.sender_level
     and public._resolve_sender(o.company_id, o.project_id, o.sender_chain[o.sender_level + 1]) is not null;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.resolve_pending_senders(uuid) from public, anon, authenticated;

-- 6) El agente: alertas con cadenas y correos con responsable ------------------------------------------
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
     assignees, chains, template_id)
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
         case when jsonb_typeof(t.x->'chains') = 'object' and pg_column_size(t.x->'chains') <= 40000
              then t.x->'chains' else '{}'::jsonb end,
         (select rt.id from public.report_templates rt
           where (t.x->>'template') ~ '^[0-9a-fA-F-]{36}$' and rt.id = (t.x->>'template')::uuid and rt.company_id = f.company_id)
    from jsonb_array_elements(coalesce(p_alerts, '[]'::jsonb)) as t(x);
  get diagnostics n = row_count;

  insert into public.email_outbox
    (company_id, project_id, file_id, rule_id, file_name, rule_name, sheet_name, row_number,
     dedupe_key, from_addr, to_addr, cc_addr, subject, body, problem, sender_chain)
  select f.company_id, f.project_id, f.id, r.id, f.name, r.name,
         nullif(left(t.x->>'sheet', 200), ''),
         case when (t.x->>'row') ~ '^[0-9]{1,9}$' then (t.x->>'row')::int end,
         left(coalesce(t.x->>'key', md5(t.x::text)), 100),
         nullif(left(t.x->>'from', 320), ''),
         left(coalesce(t.x->>'to', ''), 1000),
         nullif(left(t.x->>'cc', 1000), ''),
         left(coalesce(t.x->>'subject', ''), 300),
         left(coalesce(t.x->>'body', ''), 8000),
         nullif(left(t.x->>'problem', 300), ''),
         case when jsonb_typeof(t.x->'sender') = 'array'
              then coalesce((select array_agg(left(public._norm(s.v), 100))
                               from (select v from jsonb_array_elements_text(t.x->'sender') as e(v)
                                      where btrim(v) <> '' limit 5) s), '{}')
              else '{}'::text[] end
    from jsonb_array_elements(coalesce(p_emails, '[]'::jsonb)) as t(x)
  on conflict (rule_id, dedupe_key) do nothing;

  update public.rules
     set last_fingerprints = coalesce(p_fingerprints, '{}'::jsonb), last_error = null, last_evaluated_at = now()
   where id = r.id;
  return n;
end $$;
revoke all on function public.agent_report_rule(text, uuid, uuid, jsonb, text, jsonb, jsonb) from public;
grant execute on function public.agent_report_rule(text, uuid, uuid, jsonb, text, jsonb, jsonb) to anon, authenticated;

-- El agente recoge los correos de su empresa SIN responsable y los que le tocan a su dueño (aunque sean de
-- otra empresa: proyectos compartidos). El responsable usa su propia cuenta de Outlook: la cuenta «desde»
-- de la regla solo se respeta en los correos de la propia empresa.
create or replace function public.agent_get_outbox(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.local_agents;
begin
  a := public._agent_auth(p_token);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', o.id, 'from', case when o.company_id = a.company_id then o.from_addr end,
             'to', o.to_addr, 'cc', o.cc_addr, 'subject', o.subject, 'body', o.body)
           order by o.created_at)
      from (select * from public.email_outbox
             where status = 'pending' and problem is null
               and ((company_id = a.company_id and sender_user_id is null)
                    or (a.created_by is not null and sender_user_id = a.created_by))
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
       set status = 'sent', resolved_at = now(), to_addr = null, cc_addr = null, subject = null, body = null, from_addr = null, problem = null
     where id = p_id and status in ('pending', 'drafted')
       and ((company_id = a.company_id and sender_user_id is null) or (a.created_by is not null and sender_user_id = a.created_by));
  elsif p_status = 'drafted' then
    update public.email_outbox set status = 'drafted', problem = null
     where id = p_id and status = 'pending'
       and ((company_id = a.company_id and sender_user_id is null) or (a.created_by is not null and sender_user_id = a.created_by));
  else
    update public.email_outbox
       set problem = 'El envío automático falló: ' || coalesce(nullif(left(p_error, 200), ''), 'error desconocido')
     where id = p_id and status = 'pending'
       and ((company_id = a.company_id and sender_user_id is null) or (a.created_by is not null and sender_user_id = a.created_by));
  end if;
end $$;
