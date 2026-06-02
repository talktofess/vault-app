// Wire types shared between the sync engine and the Supabase adapter. Anything
// sensitive (names, mime, album) lives ENCRYPTED inside encMeta; the rest is
// low-sensitivity routing/scheduling data.

export interface KdfDescriptor {
  alg: "argon2id";
  m: number;
  t: number;
  p: number;
  salt: string; // base64
}

// public.vault_keys — one per user. Zero-knowledge: only ciphertext.
export interface VaultKeysRow {
  kdf: KdfDescriptor;
  wrappedDek: string; // packed b64( nonce|ct|tag ) of GCM(KEK, DEK)
  dekVersion: number;
  // The shared 4-digit PIN, encrypted under the KEK, so every device uses the
  // same unlock PIN. Absent on vaults created before this feature.
  wrappedPin?: string | null;
}

// public.items — one per stored item.
export interface RemoteItem {
  id: string;
  encMeta: string; // packed b64 of GCM(DEK, JSON<ItemMeta>)
  wrappedFk: string; // packed b64 of GCM(DEK, FK)
  byteSize: number; // ciphertext object size
  storagePath: string; // 'userId/itemId.enc'
  contentHash?: string | null;
  createdAt: string; // ISO
  updatedAt: string; // ISO
  deletedAt?: string | null; // tombstone
}

// Decrypted item metadata (the plaintext sealed into encMeta).
export interface ItemMeta {
  name: string;
  mime?: string;
  album?: string;
  kind?: string; // ItemType mirror ("media" | "file" | "note" | ...)
  plainSize: number;
  chunkSize: number;
  chunkCount: number;
}
