-- =====================================================================
-- 0002_cron_renewal.sql · Renovación de canales de Drive cada 6 horas
--
-- POR QUÉ NO VERCEL CRON: en Hobby solo permite 1 ejecución al día con
-- ±59 min de imprecisión, y files.watch caduca como máximo a las 24 h.
-- pg_cron + pg_net son gratis en Supabase Free y llaman a nuestro endpoint.
--
-- ANTES DE EJECUTAR: activa las extensiones pg_cron y pg_net
-- (Dashboard → Database → Extensions) y sustituye los dos marcadores.
-- Recomendado: guardar el secreto en Vault en lugar de en claro aquí.
-- =====================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'renew-drive-watches',
  '0 */6 * * *',
  $$
  select net.http_post(
    url     := 'https://TU-DOMINIO/api/cron/renew-watches',
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer TU_CRON_SECRET'),
    body    := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);

-- Efecto colateral útil: esta actividad periódica evita que Supabase Free
-- pause el proyecto por inactividad (7 días sin uso).

-- Para quitarlo:  select cron.unschedule('renew-drive-watches');
