-- Table-level privileges for the `authenticated` role. RLS already restricts
-- WHICH rows each user sees; these GRANTs are the separate, required permission
-- to touch the tables at all. They're normally applied automatically, but the
-- tables here were created over a direct postgres connection, which bypassed
-- Supabase's default grants — hence "permission denied for table vault_keys".
-- Idempotent: re-running GRANT is harmless.
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.vault_keys to authenticated;
grant select, insert, update, delete on public.items to authenticated;
