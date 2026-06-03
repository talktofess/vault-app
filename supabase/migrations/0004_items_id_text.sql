-- The app generates its own short opaque item ids (e.g. "dkWKgQcuKoPlUacn") and
-- uses them everywhere — the local index, the encrypted blobs, and the Storage
-- object paths. The original schema typed items.id as uuid, so pushing an item
-- failed with: invalid input syntax for type uuid (22P02). Switch the column to
-- text and drop the server-side uuid default (the client always supplies the id).
-- Idempotent: re-running is harmless. No rows exist yet if sync never succeeded.
alter table public.items alter column id drop default;
alter table public.items alter column id type text using id::text;
