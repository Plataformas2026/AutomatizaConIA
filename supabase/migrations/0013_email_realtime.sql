-- 0013: «Correos» avisa en tiempo real (pop-up y contador), igual que «Alertas».
-- Realtime respeta RLS: cada persona solo recibe los correos de su empresa.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'email_outbox'
  ) then
    alter publication supabase_realtime add table public.email_outbox;
  end if;
end $$;
