import type { Sealed } from "../crypto/cipher";

export type ItemType = "media" | "note" | "file";

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
}

// Plaintext metadata, readable BEFORE unlock. Reveals nothing about content —
// only KDF parameters and the encrypted key/verifier blobs.
export interface VaultManifest {
  version: 1;
  kdf: { salt: string; iterations: number };
  wrappedDek: Sealed; // the DEK, encrypted under the master key
  verifier: Sealed; // known plaintext encrypted under the master key
}

// The item index, stored ENCRYPTED under the DEK (so even names are private).
export interface VaultIndex {
  items: VaultItem[];
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
export const VERIFIER_PLAINTEXT = "vault-ok";
