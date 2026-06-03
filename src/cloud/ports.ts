// The seams the cloud layer depends on, so the sync engine never imports
// Supabase directly and stays unit-testable with in-memory fakes (mirrors the
// approach used for Storage/Keychain in the local vault).
import type { RemoteItem, VaultKeysRow } from "./types";

export interface CloudAuth {
  signUp(email: string, password: string): Promise<void>;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  /** The signed-in user's id, or null if not authenticated. */
  currentUserId(): Promise<string | null>;
}

export interface CloudStore {
  // --- key-set (public.vault_keys) ---
  getVaultKeys(): Promise<VaultKeysRow | null>;
  putVaultKeys(keys: VaultKeysRow): Promise<void>;

  // --- item metadata (public.items) ---
  /** Rows with updatedAt strictly after the cursor (null = all), oldest first. */
  listItemsSince(cursorISO: string | null): Promise<RemoteItem[]>;
  /** How many (non-deleted) item rows exist for the signed-in account. */
  countItems(): Promise<number>;
  upsertItem(row: RemoteItem): Promise<void>;
  markDeleted(id: string, deletedAtISO: string): Promise<void>;

  // --- blobs (Storage bucket 'vault') ---
  uploadObject(path: string, bytes: Uint8Array, contentType?: string): Promise<void>;
  downloadObject(path: string): Promise<Uint8Array>;
  /** Byte range [start, start+length) — used for chunked/streamed reads. */
  downloadRange(path: string, start: number, length: number): Promise<Uint8Array>;
  removeObject(path: string): Promise<void>;
}
