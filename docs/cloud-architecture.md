# Cloud architecture — zero-knowledge Supabase sync

Status: **design + Phase 1 (crypto core) in progress.** The local-first vault
stays the source of truth on-device; Supabase is an additive, opportunistic
sync + cross-device layer. Decisions locked: **zero-knowledge encryption**,
**email + password** Supabase Auth, local-first.

## Goals

- One vault reachable from the phone app **and** a Vercel web app.
- Supabase stores **only ciphertext** — a full breach reveals nothing.
- Opt-in per-item caching; **local delete ≠ cloud delete**.
- **Watch videos while they download** (segmented encryption + range fetches).
- **Offline = whatever that device has cached.**

## Key hierarchy

```
account passphrase ──Argon2id(salt)──► KEK ──wraps──► DEK (one vault key, all devices)
                                                       ├─ wraps enc_meta (names, mime, album)
                                                       └─ wraps FK (random per file)
                                                                  └─ encrypts file in GCM chunks
4-digit PIN ──KDF──► MK_local ──wraps──► DEK   (LOCAL device keychain only)
```

Two secrets, two jobs:

| Secret | Protects | Strength |
| --- | --- | --- |
| Account passphrase | cloud-stored wrapped DEK (zero-knowledge root) | strong; memory-hard KDF |
| 4-digit PIN | device-local DEK copy only | weak OK — device-bound + lockout, never touches cloud ciphertext |
| Supabase Auth password | identity / RLS / transport only | normal; **not** an encryption key |

The PIN never protects cloud data. The passphrase is entered once per device
(first sign-in) and at passphrase change.

## Postgres schema

```sql
create table public.vault_keys (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  kdf          jsonb not null,        -- {alg:'argon2id', m, t, p, salt:'<b64>'}
  wrapped_dek  text  not null,        -- b64( nonce | GCM(KEK,DEK) | tag )
  dek_version  int   not null default 1,
  updated_at   timestamptz not null default now()
);

create table public.items (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  enc_meta      text   not null,      -- b64( GCM(DEK, JSON{name,mime,album,chunkSize,chunkCount,plainSize,kind}) )
  wrapped_fk    text   not null,      -- b64( GCM(DEK, FK) )
  byte_size     bigint not null,      -- ciphertext object size (low-sensitivity)
  storage_path  text   not null,      -- 'userId/itemId.enc'
  content_hash  text,                 -- b64 sha256(ciphertext)
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz           -- soft-delete tombstone for sync
);
create index items_sync_idx on public.items (user_id, updated_at);

alter table public.vault_keys enable row level security;
alter table public.items      enable row level security;
create policy "own keys"  on public.vault_keys for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own items" on public.items for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

Filenames/mime/album are encrypted inside `enc_meta` (Postgres rows are visible
to anyone with DB access). `byte_size` is the one unavoidable leak; pad to size
buckets if even that matters.

## Storage

Private bucket `vault`, one object per item, path-scoped for RLS:

```
vault/<user_id>/<item_id>.enc
```

```sql
create policy "own files" on storage.objects for all
  using (bucket_id = 'vault' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'vault' and (storage.foldername(name))[1] = auth.uid()::text);
```

## File format (streamable)

Each file is AES-256-GCM in independent 1 MiB chunks so a player can decrypt
chunk 0 and start playing while chunk N is still downloading.

```
[ "VLT1"(4) | version(1) | flags(1) | reserved(2) ]   8-byte cleartext header
[ ct(CHUNK) | tag(16) ]   chunk 0
[ ct(CHUNK) | tag(16) ]   chunk 1
...
[ ct(≤CHUNK) | tag(16) ]  final chunk (may be short)
```

- `CHUNK = 1 MiB`. Stored chunk = `CHUNK + 16`.
- Per-chunk nonce = `8 zero bytes || uint32be(index)`. Safe because **FK is
  unique per file** (no key/nonce reuse) and the index is unique within a file.
- **AAD = uint32be(index)** → GCM authenticates position; chunks can't be
  reordered or spliced. Cross-file substitution fails (different FK).
- Range fetch: chunk `i` is at byte `8 + i*(CHUNK+16)`, length `CHUNK+16`.

Playback: **web** uses Media Source Extensions (decrypt → appendBuffer);
**React Native** uses a loopback decrypt-server or progressive decrypt-to-file
(expo-av can't take a custom chunk stream directly).

## Sync

`items` is the source of truth; blobs are immutable (edit = new item/version).
Pull `where updated_at > cursor`; `deleted_at` is a tombstone. Last-writer-wins
on metadata. Uncache = drop local blob only; cloud delete = set `deleted_at` +
remove the Storage object.

## Import & the web grabber

Client encrypts before upload (resumable/tus for big files). A Vercel
serverless function may **proxy bytes** but must **not** encrypt — only the
client holds the keys, so encryption happens in-browser. Server-side encryption
would break zero-knowledge.

## Security notes

- Memory-hard Argon2id on the passphrase resists offline brute force.
- Per-file FK; chunk-index AAD; per-chunk GCM tags; optional `content_hash`.
- RLS on every table + Storage path = `auth.uid()`.
- **No passphrase recovery** (zero-knowledge). Offer an optional printed
  **recovery code** = DEK wrapped under a random high-entropy code.
- Key rotation is cheap: new passphrase re-wraps DEK; DEK rotation re-wraps
  every `wrapped_fk` + `enc_meta` (metadata only, no blob re-encryption).

## Setup (apply this to go live)

1. **Create a Supabase project**, then in the SQL editor run
   `supabase/migrations/0001_init.sql` (schema + RLS + triggers + the private
   `vault` bucket and its policies). Idempotent — safe to re-run.
2. **Auth:** Authentication → Providers → enable **Email**. (Optionally turn off
   email confirmation during testing.)
3. **Env:** copy `.env.example` to `.env` and fill in `EXPO_PUBLIC_SUPABASE_URL`
   and `EXPO_PUBLIC_SUPABASE_ANON_KEY` from Settings → API.
4. **Rebuild** the app (env vars inline at build time). With no env vars set the
   app runs fully local and all cloud UI hides.
5. **First device:** Settings → Cloud sync → create account → set a strong
   **encryption passphrase** (the zero-knowledge root) → it pushes your local
   items.
6. **Another device:** install → on the onboarding screen tap **"Already have a
   cloud vault? Restore"** → sign in → enter the same passphrase → choose a new
   device PIN. The DEK is recovered locally and the metadata pulled; tap any
   item to download it.

## Build status

- **Phase 1 — crypto core:** ✅ `argon2.ts`, `keys.ts`, `chunkCipher.ts` + tests.
- **Phase 2 — sync engine + Supabase adapter:** ✅ `src/cloud/*` (ports, codec,
  keyflows, supabase adapter), `VaultService` cloud methods (enableCloud,
  push/pull, cache/uncache, deleteEverywhere), all behind the `CloudStore` port
  and covered by a two-device integration test using in-memory fakes.
- **Phase 3 — UI:** ✅ Cloud sync screen (auth + passphrase + sync), Library
  cloud/cached badges, per-item Download / Remove-download, sync button,
  delete-everywhere, a **Restore-from-cloud** onboarding flow for bootstrapping
  a fresh device (VaultService.restoreFromCloud / checkCloudPassphrase), and
  **automatic background sync** (`src/cloud/autosync.ts`) — opportunistic
  push+pull on entering the Library and after each import, no-op unless signed
  in and linked. All covered by integration tests.
- **Phase 4 — streaming player:** ✅ (with caveats) `src/cloud/stream.ts`
  `StreamReader` fetches + decrypts chunk-by-chunk over HTTP Range (tested:
  reconstruction, seek, range-only, tamper). `VaultService.openRemoteStream`
  exposes it. Players in `src/platform/streamMedia.{ts,web.ts}`:
  - **Web:** genuine watch-while-downloading via **Media Source Extensions** —
    decrypt chunk 0, append, start playback, stream the rest in the background.
    Falls back to a buffered Blob when the container isn't MSE-compatible (e.g.
    a non-fragmented MP4), so playback always works.
  - **Native:** buffered — decrypts via Range (constant per-chunk memory) to a
    temp file, then plays. True progressive native playback still needs a
    loopback decrypt-server (deferred) or faststart/fragmented sources.
  Wired into the Library: opening an uncached remote video/audio streams it.

### Not yet verified live
The crypto and sync logic are unit + integration tested locally, but the
Supabase **network** path (adapter against a real project, RN session
persistence, range requests) hasn't been exercised against a live backend —
do that after applying the migration and setting env vars.
