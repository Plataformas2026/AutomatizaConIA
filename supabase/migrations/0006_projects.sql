-- Automatización con IA · Proyectos: carpetas lógicas para organizar los archivos compartidos.
-- Guarda solo el nombre del proyecto y una portada diminuta (imagen reducida en el navegador,
-- ~20-60 KB). Nunca contenido de tus archivos. Idempotente: se puede ejecutar más de una vez.

create table if not exists public.projects (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 60),
  cover       text check (cover is null or (cover like 'data:image/jpeg;base64,%' and char_length(cover) <= 200000)),
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists projects_company_idx on public.projects (company_id, created_at);

drop trigger if exists projects_updated_at on public.projects;
create trigger projects_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

-- Un archivo puede estar suelto (null) o dentro de un proyecto.
-- Si se borra el proyecto, sus archivos NO se borran: vuelven a quedar sueltos.
alter table public.shared_files_metadata
  add column if not exists project_id uuid references public.projects(id) on delete set null;

create index if not exists shared_files_project_idx on public.shared_files_metadata (project_id);

alter table public.projects enable row level security;

drop policy if exists projects_select on public.projects;
create policy projects_select on public.projects
  for select to authenticated using (public.is_company_member(company_id));

drop policy if exists projects_insert on public.projects;
create policy projects_insert on public.projects
  for insert to authenticated with check (public.is_company_member(company_id));

drop policy if exists projects_update on public.projects;
create policy projects_update on public.projects
  for update to authenticated
  using (public.is_company_member(company_id))
  with check (public.is_company_member(company_id));

drop policy if exists projects_delete on public.projects;
create policy projects_delete on public.projects
  for delete to authenticated using (public.is_company_member(company_id));

revoke all on public.projects from anon;
