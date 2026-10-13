-- Automatización con IA · Informes y Modelos IA.
-- Guarda el INFORME de cada análisis (ajustes, métricas, conclusiones, importancia
-- de variables, perfiles de grupos, nº de fila de las anomalías…). NUNCA guarda
-- valores ni filas de tus datos: eso se calcula al vuelo desde tu Drive.
-- Idempotente: se puede ejecutar más de una vez.

create table if not exists public.ml_reports (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  file_id     uuid not null references public.shared_files_metadata(id) on delete cascade,
  title       text not null,
  task        text not null check (task in ('regression', 'classification', 'anomaly', 'clustering')),
  config      jsonb not null,
  summary     jsonb not null,
  created_at  timestamptz not null default now()
);

create index if not exists ml_reports_user_idx on public.ml_reports (user_id, created_at desc);
create index if not exists ml_reports_file_idx on public.ml_reports (file_id);

alter table public.ml_reports enable row level security;

drop policy if exists ml_reports_select on public.ml_reports;
create policy ml_reports_select on public.ml_reports
  for select to authenticated
  using (user_id = auth.uid() and public.is_company_member(company_id));

drop policy if exists ml_reports_insert on public.ml_reports;
create policy ml_reports_insert on public.ml_reports
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and public.is_company_member(company_id)
    and exists (select 1 from public.shared_files_metadata f
                where f.id = file_id and f.company_id = ml_reports.company_id)
  );

drop policy if exists ml_reports_delete on public.ml_reports;
create policy ml_reports_delete on public.ml_reports
  for delete to authenticated
  using (user_id = auth.uid() and public.is_company_member(company_id));

revoke all on public.ml_reports from anon;
