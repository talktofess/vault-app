// The Supabase-backed implementation of the cloud ports. This is the ONLY file
// that imports @supabase/supabase-js; everything above it talks to CloudStore /
// CloudAuth, so the sync engine stays testable without a network.
//
// Config via Expo public env vars (inlined at build time):
//   EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY
// If they're absent, createSupabase() returns null and the app runs local-only.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Platform } from "react-native";
import * as FileSystem from "expo-file-system";
import type { CloudAuth, CloudStore } from "./ports";
import type { RemoteItem, VaultKeysRow } from "./types";

const BUCKET = "vault";

// Native auth-session persistence (web falls back to supabase-js' localStorage).
// expo-secure-store caps at ~2KB which a JWT session can exceed, so use files.
const SB_DIR = (FileSystem.documentDirectory ?? "") + ".gamedata/sb/";
const safe = (k: string) => k.replace(/[^\w.-]+/g, "_");
const nativeStorage = {
  async getItem(key: string): Promise<string | null> {
    try {
      const p = SB_DIR + safe(key);
      const info = await FileSystem.getInfoAsync(p);
      return info.exists ? await FileSystem.readAsStringAsync(p) : null;
    } catch {
      return null;
    }
  },
  async setItem(key: string, value: string): Promise<void> {
    await FileSystem.makeDirectoryAsync(SB_DIR, { intermediates: true }).catch(() => {});
    await FileSystem.writeAsStringAsync(SB_DIR + safe(key), value);
  },
  async removeItem(key: string): Promise<void> {
    await FileSystem.deleteAsync(SB_DIR + safe(key), { idempotent: true });
  },
};

function toArrayBuffer(b: Uint8Array): ArrayBuffer {
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function mapRow(r: any): RemoteItem {
  return {
    id: r.id,
    encMeta: r.enc_meta,
    wrappedFk: r.wrapped_fk,
    byteSize: r.byte_size,
    storagePath: r.storage_path,
    contentHash: r.content_hash,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at,
  };
}

function makeAuth(c: SupabaseClient): CloudAuth {
  return {
    async signUp(email, password) {
      const { error } = await c.auth.signUp({ email, password });
      if (error) throw error;
    },
    async signIn(email, password) {
      const { error } = await c.auth.signInWithPassword({ email, password });
      if (error) throw error;
    },
    async signOut() {
      await c.auth.signOut();
    },
    async currentUserId() {
      const { data } = await c.auth.getUser();
      return data.user?.id ?? null;
    },
  };
}

async function requireUserId(c: SupabaseClient): Promise<string> {
  const { data } = await c.auth.getUser();
  if (!data.user) throw new Error("Not signed in");
  return data.user.id;
}

function makeStore(c: SupabaseClient): CloudStore {
  return {
    async getVaultKeys() {
      const { data, error } = await c
        .from("vault_keys")
        .select("kdf, wrapped_dek, dek_version, wrapped_pin")
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return { kdf: data.kdf, wrappedDek: data.wrapped_dek, dekVersion: data.dek_version, wrappedPin: data.wrapped_pin };
    },
    async putVaultKeys(keys: VaultKeysRow) {
      const user_id = await requireUserId(c);
      const { error } = await c.from("vault_keys").upsert({
        user_id,
        kdf: keys.kdf,
        wrapped_dek: keys.wrappedDek,
        dek_version: keys.dekVersion,
        wrapped_pin: keys.wrappedPin ?? null,
      });
      if (error) throw error;
    },
    async listItemsSince(cursorISO) {
      let q = c.from("items").select("*").order("updated_at", { ascending: true });
      if (cursorISO) q = q.gt("updated_at", cursorISO);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []).map(mapRow);
    },
    async upsertItem(row) {
      const user_id = await requireUserId(c);
      const { error } = await c.from("items").upsert({
        id: row.id,
        user_id,
        enc_meta: row.encMeta,
        wrapped_fk: row.wrappedFk,
        byte_size: row.byteSize,
        storage_path: row.storagePath,
        content_hash: row.contentHash ?? null,
        created_at: row.createdAt,
        deleted_at: row.deletedAt ?? null,
        // updated_at intentionally omitted — a DB trigger sets it server-side.
      });
      if (error) throw error;
    },
    async markDeleted(id, deletedAtISO) {
      const { error } = await c.from("items").update({ deleted_at: deletedAtISO }).eq("id", id);
      if (error) throw error;
    },
    async uploadObject(path, bytes, contentType) {
      const { error } = await c.storage.from(BUCKET).upload(path, toArrayBuffer(bytes), {
        contentType: contentType ?? "application/octet-stream",
        upsert: true,
      });
      if (error) throw error;
    },
    async downloadObject(path) {
      const { data, error } = await c.storage.from(BUCKET).download(path);
      if (error) throw error;
      return new Uint8Array(await data.arrayBuffer());
    },
    async downloadRange(path, start, length) {
      // Range reads go through a short-lived signed URL + an HTTP Range request,
      // which Supabase Storage honours. This is the basis for streaming.
      const { data, error } = await c.storage.from(BUCKET).createSignedUrl(path, 60);
      if (error || !data) throw error ?? new Error("Could not sign URL");
      const res = await fetch(data.signedUrl, {
        headers: { Range: `bytes=${start}-${start + length - 1}` },
      });
      return new Uint8Array(await res.arrayBuffer());
    },
    async removeObject(path) {
      await c.storage.from(BUCKET).remove([path]);
    },
  };
}

export interface Supabase {
  auth: CloudAuth;
  store: CloudStore;
}

// The project's PUBLIC config, baked in as a fallback so any deploy (Vercel
// without env vars, an EAS build, a fresh clone) can sync without extra setup.
// The anon key is public by design — it ships in the client bundle regardless —
// and row-level security + the client-side AES-256-GCM encryption are what keep
// data private. Override either via the EXPO_PUBLIC_* env vars to point the app
// at a different Supabase project (or set them empty + edit here to go local).
const DEFAULT_SUPABASE_URL = "https://aiheqgxdwqkpqoyifasu.supabase.co";
const DEFAULT_SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFpaGVxZ3hkd3FrcHFveWlmYXN1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAzMjE4MTcsImV4cCI6MjA5NTg5NzgxN30.AZr5i0u_uFCK0Phh6dsTV1L0bptQA4ANiFsL2orwKDo";

export function createSupabase(): Supabase | null {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  const client = createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storage: Platform.OS === "web" ? undefined : (nativeStorage as any),
    },
  });
  return { auth: makeAuth(client), store: makeStore(client) };
}
