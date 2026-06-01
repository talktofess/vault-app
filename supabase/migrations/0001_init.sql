-- Zero-knowledge cloud vault — schema, RLS, triggers, and Storage policies.
-- Apply in the Supabase SQL editor (or `supabase db push`). Idempotent: safe to
-- re-run. See docs/cloud-architecture.md.

create extension if not exists pgcrypto; -- gen_random_uuid()

-- One key-set per user. Server stores only ciphertext (wrapped DEK + KDF params).
create table if not exists public.vault_keys (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  kdf          jsonb not null,
  wrapped_dek  text  not null,
  dek_version  int   not null default 1,
  updated_at   timestamptz not null default now()
);

-- One row per item. Names/mime/album are encrypted inside enc_meta.
create table if not exists public.items (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  enc_meta      text   not null,
  wrapped_fk    text   not null,
  byte_size     bigint not null,
  storage_path  text   not null,
  content_hash  text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
create index if not exists items_sync_idx on public.items (user_id, updated_at);

-- updated_at is server-authoritative (drives the incremental sync cursor).
create or replace function public.touch_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists items_touch on public.items;
create trigger items_touch before insert or update on public.items
  for each row execute function public.touch_updated_at();

drop trigger if exists vault_keys_touch on public.vault_keys;
create trigger vault_keys_touch before insert or update on public.vault_keys
  for each row execute function public.touch_updated_at();

-- Row-level security: a user sees only their own rows.
alter table public.vault_keys enable row level security;
alter table public.items      enable row level security;

drop policy if exists "own keys" on public.vault_keys;
create policy "own keys" on public.vault_keys for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own items" on public.items;
create policy "own items" on public.items for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Private Storage bucket; objects live under '<user_id>/...'.
insert into storage.buckets (id, name, public)
  values ('vault', 'vault', false)
  on conflict (id) do nothing;

drop policy if exists "vault own objects" on storage.objects;
create policy "vault own objects" on storage.objects for all
  using (bucket_id = 'vault' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'vault' and (storage.foldername(name))[1] = auth.uid()::text);
