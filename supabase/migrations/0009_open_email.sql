-- 0009 · «Abrir en Outlook»: el agente pide UN correo por su id para abrirlo en el Outlook clásico del PC.
-- Solo devuelve correos de la empresa del agente que sigan pendientes o en Borradores.
create or replace function public.agent_get_email(p_token text, p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.local_agents;
begin
  a := public._agent_auth(p_token);
  return (
    select jsonb_build_object('id', o.id, 'from', o.from_addr, 'to', o.to_addr, 'subject', o.subject, 'body', o.body)
      from public.email_outbox o
     where o.id = p_id and o.company_id = a.company_id
       and o.status in ('pending', 'drafted')
       and o.to_addr is not null and o.subject is not null and o.body is not null);
end $$;

revoke all on function public.agent_get_email(text, uuid) from public;
grant execute on function public.agent_get_email(text, uuid) to anon, authenticated;
