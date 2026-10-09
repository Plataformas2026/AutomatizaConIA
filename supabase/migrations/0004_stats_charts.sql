-- Automatización con IA · Estadísticas: gráficas personalizadas por usuario.
-- Solo se guarda la CONFIGURACIÓN de cada gráfica (tipo, columnas elegidas,
-- título…). Los datos del archivo nunca se almacenan: se leen al vuelo de Drive.
-- Idempotente: se puede ejecutar más de una vez.

create table if not exists public.stats_charts (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  config      jsonb not null,
  position    integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists stats_charts_user_idx
  on public.stats_charts (user_id, position, created_at);

drop trigger if exists stats_charts_updated_at on public.stats_charts;
create trigger stats_charts_updated_at
  before update on public.stats_charts
  for each row execute function public.set_updated_at();

alter table public.stats_charts enable row level security;

-- Cada usuario ve y gestiona SOLO sus gráficas, dentro de su empresa.
drop policy if exists stats_charts_select on public.stats_charts;
create policy stats_charts_select on public.stats_charts
  for select to authenticated
  using (user_id = auth.uid() and public.is_company_member(company_id));

drop policy if exists stats_charts_insert on public.stats_charts;
create policy stats_charts_insert on public.stats_charts
  for insert to authenticated
  with check (user_id = auth.uid() and public.is_company_member(company_id));

drop policy if exists stats_charts_update on public.stats_charts;
create policy stats_charts_update on public.stats_charts
  for update to authenticated
  using (user_id = auth.uid() and public.is_company_member(company_id))
  with check (user_id = auth.uid() and public.is_company_member(company_id));

drop policy if exists stats_charts_delete on public.stats_charts;
create policy stats_charts_delete on public.stats_charts
  for delete to authenticated
  using (user_id = auth.uid() and public.is_company_member(company_id));

revoke all on public.stats_charts from anon;
