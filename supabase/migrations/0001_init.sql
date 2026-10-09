-- =====================================================================
-- 0001_init.sql · Esquema base (Supabase Free)
--
-- PRINCIPIO ZERO-STORAGE: ninguna tabla guarda filas ni celdas de los
-- archivos del usuario. Solo configuración (IDs de archivo, tokens
-- cifrados, reglas) y alertas (texto del usuario + nº de filas afectadas).
-- =====================================================================

create extension if not exists pgcrypto;

create type public.member_role  as enum ('owner', 'admin', 'member');
create type public.file_status  as enum ('active', 'paused', 'error', 'revoked');
create type public.alert_status as enum ('open', 'read', 'dismissed');

-- ---------------------------------------------------------------------
-- Utilidades
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------------------------------------------------------------------
-- companies / company_members
-- ---------------------------------------------------------------------
create table public.companies (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 1 and 120),
  created_at timestamptz not null default now()
);

create table public.company_members (
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       public.member_role not null default 'member',
  created_at timestamptz not null default now(),
  primary key (company_id, user_id)
);
create index company_members_user_idx on public.company_members(user_id);

-- security definer: evita recursión de RLS al consultarse desde las políticas.
create or replace function public.is_company_member(p_company uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.company_members m
    where m.company_id = p_company and m.user_id = auth.uid()
  );
$$;
revoke all on function public.is_company_member(uuid) from public;
grant execute on function public.is_company_member(uuid) to authenticated;

-- Al registrarse un usuario nuevo (primer acceso por enlace mágico) se crea
-- su empresa y se le hace propietario. Si prefieres modo "solo invitación",
-- desactiva el registro libre en Supabase Auth e invita desde el panel.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_company uuid;
begin
  insert into public.companies(name) values ('Mi empresa') returning id into v_company;
  insert into public.company_members(company_id, user_id, role)
  values (v_company, new.id, 'owner');
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- google_tokens · refresh tokens CIFRADOS (AES-256-GCM en la app)
-- Sin políticas para clientes: solo accesible con service_role.
-- ---------------------------------------------------------------------
create table public.google_tokens (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id) on delete cascade,
  connected_by      uuid references auth.users(id) on delete set null,
  google_email      text not null,
  refresh_token_enc text not null,
  scopes            text[] not null default '{}',
  status            text not null default 'active' check (status in ('active', 'revoked')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (company_id, google_email)
);
create trigger google_tokens_updated before update on public.google_tokens
  for each row execute function public.set_updated_at();

-- Vista SIN secretos para que la UI sepa si hay conexión.
create view public.google_connections with (security_barrier = true) as
  select id, company_id, google_email, status, created_at
  from public.google_tokens
  where public.is_company_member(company_id);

-- ---------------------------------------------------------------------
-- shared_files_metadata · solo metadatos del archivo y del canal de Drive
-- ---------------------------------------------------------------------
create table public.shared_files_metadata (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id) on delete cascade,
  google_token_id   uuid not null references public.google_tokens(id) on delete cascade,
  drive_file_id     text not null,
  name              text not null,
  mime_type         text not null,
  status            public.file_status not null default 'active',
  last_version      text,          -- nº de versión que informa Drive (NO contenido)
  last_checked_at   timestamptz,
  last_error        text,          -- mensaje genérico, nunca datos del archivo
  watch_channel_id  text unique,
  watch_resource_id text,
  watch_expires_at  timestamptz,
  created_by        uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  unique (company_id, drive_file_id)
);
create index shared_files_company_idx on public.shared_files_metadata(company_id);
create index shared_files_expiry_idx  on public.shared_files_metadata(watch_expires_at)
  where status = 'active';

-- Compare-and-set atómico: evita procesar dos veces la misma versión cuando
-- Drive manda varias notificaciones seguidas por un único guardado.
create or replace function public.claim_file_version(
  p_file uuid, p_expected text, p_new text
) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_rows int;
begin
  update public.shared_files_metadata
     set last_version = p_new, last_checked_at = now(), last_error = null
   where id = p_file
     and last_version is not distinct from p_expected;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end $$;
revoke all on function public.claim_file_version(uuid, text, text) from public, anon, authenticated;
grant execute on function public.claim_file_version(uuid, text, text) to service_role;

-- ---------------------------------------------------------------------
-- rules · condición y acciones como JSONB validado con Zod en la app
--   condition: {"kind":"compare","left":{"type":"column","column":"Stock"},
--               "operator":"lt","right":{"type":"value","value":"10"}}
--   actions:   [{"type":"alert","message":"Stock bajo","severity":"warning"}]
-- ---------------------------------------------------------------------
create table public.rules (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id) on delete cascade,
  file_id           uuid not null references public.shared_files_metadata(id) on delete cascade,
  name              text not null check (char_length(name) between 1 and 120),
  enabled           boolean not null default true,
  condition         jsonb not null check (jsonb_typeof(condition) = 'object'),
  actions           jsonb not null default '[]' check (jsonb_typeof(actions) = 'array'),
  -- Huella (HMAC) del conjunto de nº de fila que cumplió la regla la última vez.
  -- Solo se alerta cuando el conjunto cambia. No contiene datos legibles.
  last_fingerprint  text,
  last_error        text,
  last_evaluated_at timestamptz,
  created_by        uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index rules_file_idx on public.rules(file_id) where enabled;
create trigger rules_updated before update on public.rules
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- alerts · texto escrito por el usuario + referencias a nº de fila
-- ---------------------------------------------------------------------
create table public.alerts (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  file_id       uuid references public.shared_files_metadata(id) on delete set null,
  rule_id       uuid references public.rules(id) on delete set null,
  file_name     text not null,        -- instantánea de la config, para el histórico
  rule_name     text not null,
  message       text not null,
  severity      text not null default 'info' check (severity in ('info', 'warning', 'critical')),
  matched_count integer not null default 0,
  row_refs      integer[] not null default '{}'
                check (cardinality(row_refs) <= 200),   -- solo números de fila
  status        public.alert_status not null default 'open',
  created_at    timestamptz not null default now(),
  read_at       timestamptz
);
create index alerts_company_created_idx on public.alerts(company_id, created_at desc);
create index alerts_open_idx on public.alerts(company_id) where status = 'open';

-- Realtime: la pestaña "Alertas" se actualiza sola (RLS aplica a Realtime).
alter publication supabase_realtime add table public.alerts;

-- =====================================================================
-- RLS
-- =====================================================================
alter table public.companies             enable row level security;
alter table public.company_members       enable row level security;
alter table public.google_tokens         enable row level security;
alter table public.shared_files_metadata enable row level security;
alter table public.rules                 enable row level security;
alter table public.alerts                enable row level security;

-- companies
create policy companies_select on public.companies
  for select to authenticated using (public.is_company_member(id));
create policy companies_update on public.companies
  for update to authenticated
  using (exists (select 1 from public.company_members m
                 where m.company_id = id and m.user_id = auth.uid()
                   and m.role in ('owner', 'admin')))
  with check (true);

-- company_members (solo lectura para clientes)
create policy members_select on public.company_members
  for select to authenticated using (public.is_company_member(company_id));

-- google_tokens: SIN políticas → denegado a anon/authenticated.

-- shared_files_metadata (lectura; altas/bajas por API con service_role,
-- porque hay que llamar a Google para crear/parar el canal)
create policy files_select on public.shared_files_metadata
  for select to authenticated using (public.is_company_member(company_id));

-- rules: CRUD de los miembros, y el archivo debe ser de la misma empresa
create policy rules_select on public.rules
  for select to authenticated using (public.is_company_member(company_id));
create policy rules_insert on public.rules
  for insert to authenticated
  with check (
    public.is_company_member(company_id)
    and exists (select 1 from public.shared_files_metadata f
                where f.id = file_id and f.company_id = rules.company_id)
  );
create policy rules_update on public.rules
  for update to authenticated
  using (public.is_company_member(company_id))
  with check (
    public.is_company_member(company_id)
    and exists (select 1 from public.shared_files_metadata f
                where f.id = file_id and f.company_id = rules.company_id)
  );
create policy rules_delete on public.rules
  for delete to authenticated using (public.is_company_member(company_id));

-- alerts: leer, marcar leída/descartada y borrar. Crearlas solo el servidor.
create policy alerts_select on public.alerts
  for select to authenticated using (public.is_company_member(company_id));
create policy alerts_update on public.alerts
  for update to authenticated
  using (public.is_company_member(company_id))
  with check (public.is_company_member(company_id));
create policy alerts_delete on public.alerts
  for delete to authenticated using (public.is_company_member(company_id));

-- =====================================================================
-- Privilegios (defensa en profundidad además de RLS)
-- =====================================================================
revoke all on all tables in schema public from anon;
revoke all on public.google_tokens from authenticated;
grant  select on public.google_connections to authenticated;

revoke insert, update, delete, truncate on public.company_members       from authenticated;
revoke insert, update, delete, truncate on public.shared_files_metadata from authenticated;

revoke insert, truncate on public.alerts from authenticated;
revoke update on public.alerts from authenticated;
grant  update (status, read_at) on public.alerts to authenticated;

revoke update on public.rules from authenticated;
grant  update (name, enabled, condition, actions) on public.rules to authenticated;

revoke update on public.companies from authenticated;
grant  update (name) on public.companies to authenticated;
