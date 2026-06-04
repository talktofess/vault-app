import type { Sealed } from "../crypto/cipher";

export type ItemType = "media" | "note" | "file" | "credential";

// Shape stored (as JSON, encrypted) for a credential-manager entry.
export interface Credential {
  title: string;
  username: string;
  password: string;
  url?: string;
  notes?: string;
}

// Pointer to an item's cloud copy. Present once the item has been pushed to (or
// pulled from) Supabase. wrappedFk lets this device decrypt the cloud object.
export interface RemoteRef {
  path: string; // Storage object path 'userId/itemId.enc'
  updatedAt: string; // server ISO timestamp (drives the sync cursor)
  wrappedFk: string; // packed b64 of GCM(DEK, FK)
  byteSize: number; // ciphertext object size
}

export interface VaultItem {
  id: string;
  type: ItemType;
  name: string;
  size: number; // plaintext byte length
  mime?: string;
  createdAt: number;
  // For notes we may store a flag that the content is JSON (for the editor).
  isJson?: boolean;
  // Origin URL for files downloaded via the in-app browser.
  sourceUrl?: string;
  // Optional album/folder for organization.
  album?: string;
  // Pinned items sort to the top.
  pinned?: boolean;
  // A small encrypted poster frame (for videos) is stored in a sidecar blob, so
  // the grid can show a preview without decrypting the whole clip.
  hasThumb?: boolean;
  // ---- cloud sync (optional; absent on a purely-local item) ----
  remote?: RemoteRef; // set when a cloud copy exists
  cached?: boolean; // false = pulled-but-not-downloaded; undefined/true = blob is on-device
  localOnly?: boolean; // user opted this item OUT of the Supabase backup (never pushed)
}

// Plaintext metadata, readable BEFORE unlock. Reveals nothing about content —
// only KDF parameters and the encrypted key/verifier blobs.
export interface VaultManifest {
  version: 1;
  kdf: { salt: string; iterations: number };
  wrappedDek: Sealed; // the DEK, encrypted under the master key
  verifier: Sealed; // known plaintext encrypted under the master key
  // Optional duress ("decoy") credential. A different password that unlocks a
  // SEPARATE decoy vault (its own DEK + index), giving plausible deniability:
  // an attacker who forces a password sees a believable, benign vault while the
  // real items stay encrypted under a key the duress password can't derive.
  // Its presence is indistinguishable from a vault that simply has two
  // passwords — the manifest reveals nothing about which is "real".
  duress?: {
    kdf: { salt: string; iterations: number };
    wrappedDek: Sealed; // the DECOY dek, wrapped under the duress key
    verifier: Sealed;
  };
  // Tamper/intrusion tracking, stored in plaintext (reveals only THAT failed
  // unlocks happened + when — nothing about contents). Cleared on a successful
  // real unlock; drives the failed-attempt lockout delay.
  intrusions?: number[]; // timestamps of failed unlock attempts since last success
  failedStreak?: number; // consecutive failures, for the lockout backoff
  // If set, this vault unlocks by playing a fixed-length sequence of chess moves
  // on the disguise board (instead of a PIN). Only the move COUNT is stored here
  // (plaintext, readable before unlock) — never the moves themselves.
  chessLen?: number;
}

// The item index, stored ENCRYPTED under the DEK (so even names are private).
export interface VaultIndex {
  items: VaultItem[];
  // User-created folders (albums) — tracked explicitly so an empty folder
  // persists even before anything is put in it. Item albums also count as
  // folders; this just keeps the empty ones around.
  folders?: string[];
  // High-water mark for incremental cloud pulls (max server updatedAt seen).
  syncCursor?: string;
}

// A portable, password-protected backup of the whole vault.
export interface VaultBackup {
  version: 1;
  kind: "vault-backup";
  kdf: { salt: string; iterations: number };
  wrappedDek: Sealed; // DEK wrapped under the BACKUP password's key
  blobs: Record<string, Sealed>; // includes the index under key INDEX_ID
}

export const INDEX_ID = "__index__";
export const DECOY_INDEX_ID = "__decoy_index__";
export const VERIFIER_PLAINTEXT = "vault-ok";
