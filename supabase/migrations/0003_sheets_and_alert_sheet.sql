-- =====================================================================
-- 0003_sheets_and_alert_sheet.sql
--
-- · Selección de hojas por archivo (una, varias o todas).
-- · Huellas por hoja en las reglas (para no repetir alertas de cada hoja).
-- · Nombre de la hoja en cada alerta (solo metadato de configuración).
--
-- Ejecútalo UNA vez en Supabase → SQL Editor. Es idempotente.
-- =====================================================================

alter table public.shared_files_metadata
  add column if not exists sheet_mode  text   not null default 'first',
  add column if not exists sheet_names text[] not null default '{}';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'shared_files_sheet_mode_check'
  ) then
    alter table public.shared_files_metadata
      add constraint shared_files_sheet_mode_check
      check (sheet_mode in ('first', 'selected', 'all'));
  end if;
end $$;

-- Una huella HMAC por hoja: {"Enero": "ab12…", "Febrero": "cd34…"}.
-- La columna antigua last_fingerprint queda sin uso (se conserva por compatibilidad).
alter table public.rules
  add column if not exists last_fingerprints jsonb not null default '{}'::jsonb;

alter table public.alerts
  add column if not exists sheet_name text;
