-- 0011 · Rol de ADMINISTRADOR de la plataforma.
--
-- Cada usuario tiene su propia empresa (sus datos están aislados por RLS). Un administrador puede gestionar
-- proyectos y reglas EN NOMBRE de otros usuarios. Diseño de seguridad:
--   · Quién es admin se guarda aquí (platform_admins) y SOLO se cambia desde el SQL Editor de Supabase.
--   · Las políticas RLS de los usuarios normales NO se relajan (un administrador no ve datos ajenos por el
--     navegador). Las acciones de administración pasan por rutas del servidor que comprueban este rol y usan
--     service_role con el company_id explícito del usuario elegido.
--   · Cada acción sobre datos de otra persona queda anotada en admin_audit (quién, qué, a quién; sin contenido).

create table if not exists public.platform_admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.platform_admins enable row level security;
drop policy if exists platform_admins_self on public.platform_admins;
create policy platform_admins_self on public.platform_admins
  for select to authenticated using (user_id = auth.uid());
revoke all on public.platform_admins from anon, authenticated;
grant select on public.platform_admins to authenticated;

create or replace function public.is_platform_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid());
$$;
revoke all on function public.is_platform_admin() from public, anon;
grant execute on function public.is_platform_admin() to authenticated;

-- Registro de acciones de administración (solo service_role; sin contenido de archivos ni de reglas).
create table if not exists public.admin_audit (
  id                uuid primary key default gen_random_uuid(),
  admin_id          uuid references auth.users(id) on delete set null,
  target_company_id uuid references public.companies(id) on delete set null,
  action            text not null check (char_length(action) <= 40),
  entity            text not null check (char_length(entity) <= 40),
  entity_id         uuid,
  created_at        timestamptz not null default now()
);
create index if not exists admin_audit_company_idx on public.admin_audit (target_company_id, created_at desc);
alter table public.admin_audit enable row level security;
revoke all on public.admin_audit from anon, authenticated;

-- Lista de usuarios para el selector del administrador (correo + su empresa). Solo responde a administradores.
create or replace function public.admin_list_users()
returns table (user_id uuid, email text, company_id uuid, company_name text, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select u.id, u.email::text, m.company_id, c.name, u.created_at
      from auth.users u
      join public.company_members m on m.user_id = u.id
      join public.companies c on c.id = m.company_id
     where m.created_at = (select min(m2.created_at) from public.company_members m2 where m2.user_id = u.id)
     order by u.email
     limit 500;
end $$;
revoke all on function public.admin_list_users() from public, anon;
grant execute on function public.admin_list_users() to authenticated;

-- Cómo nombrar al primer administrador (ejecútalo UNA vez en el SQL Editor, con tu correo):
--   insert into public.platform_admins (user_id)
--   select id from auth.users where email = 'TU_CORREO@ejemplo.com'
--   on conflict do nothing;
