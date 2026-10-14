-- 0010 · Copia (CC) en los correos + alertas por fecha.
-- Quita «Abrir en Outlook» (agent_get_email) y añade la columna de copia a la bandeja.

drop function if exists public.agent_get_email(text, uuid);

alter table public.email_outbox
  add column if not exists cc_addr text check (cc_addr is null or char_length(cc_addr) <= 1000);

-- Limpieza diaria: también la copia.
create or replace function public.purge_email_outbox()
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  -- Resueltos: fuera el contenido de inmediato (por si algo quedó) y el registro a los 7 días.
  update public.email_outbox set to_addr = null, cc_addr = null, subject = null, body = null, from_addr = null
   where status in ('sent', 'dismissed') and (to_addr is not null or cc_addr is not null or subject is not null or body is not null);
  delete from public.email_outbox where status in ('sent', 'dismissed') and resolved_at < now() - interval '7 days';
  -- Pendientes olvidados más de 30 días.
  delete from public.email_outbox where status in ('pending', 'drafted') and created_at < now() - interval '30 days';
  get diagnostics n = row_count;
  return n;
end $$;

-- El agente recibe la copia junto con el destinatario.
create or replace function public.agent_get_outbox(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.local_agents;
begin
  a := public._agent_auth(p_token);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', o.id, 'from', o.from_addr, 'to', o.to_addr, 'cc', o.cc_addr, 'subject', o.subject, 'body', o.body)
           order by o.created_at)
      from (select * from public.email_outbox
             where company_id = a.company_id and status = 'pending' and problem is null
               and to_addr ~ '^[^[:space:]@<>;,]+@[^[:space:]@<>;,]+\.[^[:space:]@<>;,]+([;,] ?[^[:space:]@<>;,]+@[^[:space:]@<>;,]+\.[^[:space:]@<>;,]+)*$'
               and subject is not null and body is not null
             order by created_at limit 20) o), '[]'::jsonb);
end $$;

-- Al marcar como enviado, se borra también la copia.
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

-- El agente informa de los correos redactados (ahora con copia).
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

revoke all on function public.agent_get_outbox(text) from public;
revoke all on function public.agent_report_email(text, uuid, text, text) from public;
revoke all on function public.agent_report_rule(text, uuid, uuid, jsonb, text, jsonb, jsonb) from public;
grant execute on function public.agent_get_outbox(text) to anon, authenticated;
grant execute on function public.agent_report_email(text, uuid, text, text) to anon, authenticated;
grant execute on function public.agent_report_rule(text, uuid, uuid, jsonb, text, jsonb, jsonb) to anon, authenticated;
