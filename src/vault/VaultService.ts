// The single seam every screen goes through: lock/unlock, item CRUD, password
// change, biometric enrolment, and encrypted backup/restore.
//
// Envelope encryption:
//   master key (MK) = KDF(password, salt)        — never stored
//   DEK            = random 256-bit key           — wrapped by MK in the manifest
//   every item     = AES-256-GCM under the DEK
// Changing the password only re-wraps the DEK (no re-encrypting of items).

import { deriveKey, KDF_ITERATIONS, SALT_LEN } from "../crypto/kdf";
import { open, seal, type Sealed } from "../crypto/cipher";
import { randomBytes } from "../crypto/random";
import { bytesToUtf8, fromB64, toB64, utf8ToBytes } from "../crypto/b64";
import type { Keychain, Storage } from "./ports";
import {
  INDEX_ID,
  VERIFIER_PLAINTEXT,
  type ItemType,
  type VaultBackup,
  type VaultIndex,
  type VaultItem,
  type VaultManifest,
} from "./types";

const BIO_KEY = "vault.dek"; // keychain entry holding the DEK for biometric unlock

function newId(): string {
  return toB64(randomBytes(12)).replace(/[+/=]/g, "").slice(0, 16);
}

export class VaultService {
  private dek: Uint8Array | null = null; // present only while unlocked
  private index: VaultIndex | null = null;

  constructor(
    private storage: Storage,
    private keychain: Keychain
  ) {}

  // ---- lifecycle ----

  async exists(): Promise<boolean> {
    return (await this.storage.readManifest()) !== null;
  }

  isUnlocked(): boolean {
    return this.dek !== null;
  }

  lock(): void {
    if (this.dek) this.dek.fill(0);
    this.dek = null;
    this.index = null;
  }

  /** First-run: set the master password, generate the DEK, write the manifest. */
  async create(password: string): Promise<void> {
    if (await this.exists()) throw new Error("Vault already exists");
    const salt = randomBytes(SALT_LEN);
    const mk = deriveKey(password, salt);
    const dek = randomBytes(32);
    const manifest: VaultManifest = {
      version: 1,
      kdf: { salt: toB64(salt), iterations: KDF_ITERATIONS },
      wrappedDek: seal(mk, dek),
      verifier: seal(mk, utf8ToBytes(VERIFIER_PLAINTEXT)),
    };
    await this.storage.writeManifest(JSON.stringify(manifest));
    this.dek = dek;
    this.index = { items: [] };
    await this.persistIndex();
  }

  private async loadManifest(): Promise<VaultManifest> {
    const raw = await this.storage.readManifest();
    if (!raw) throw new Error("No vault");
    return JSON.parse(raw) as VaultManifest;
  }

  /** Unlock with the master password. Returns false on wrong password. */
  async unlock(password: string): Promise<boolean> {
    const m = await this.loadManifest();
    const mk = deriveKey(password, fromB64(m.kdf.salt), m.kdf.iterations);
    let dek: Uint8Array;
    try {
      // verifier must decrypt to the known plaintext, else password is wrong
      if (bytesToUtf8(open(mk, m.verifier)) !== VERIFIER_PLAINTEXT) return false;
      dek = open(mk, m.wrappedDek);
    } catch {
      return false;
    }
    this.dek = dek;
    await this.loadIndex();
    return true;
  }

  // ---- biometric unlock ----

  /** Store the DEK in the OS keychain so biometrics can unlock without the password. */
  async enableBiometric(): Promise<void> {
    this.requireUnlocked();
    await this.keychain.setItem(BIO_KEY, toB64(this.dek!));
  }

  async disableBiometric(): Promise<void> {
    await this.keychain.deleteItem(BIO_KEY);
  }

  async biometricAvailable(): Promise<boolean> {
    return (await this.keychain.getItem(BIO_KEY)) !== null;
  }

  /** Unlock by reading the DEK from the keychain (the OS gates this with biometrics). */
  async unlockWithBiometric(): Promise<boolean> {
    const stored = await this.keychain.getItem(BIO_KEY);
    if (!stored) return false;
    this.dek = fromB64(stored);
    await this.loadIndex();
    return true;
  }

  // ---- index ----

  private async loadIndex(): Promise<void> {
    const blob = await this.storage.readBlob(INDEX_ID);
    if (!blob) {
      this.index = { items: [] };
      return;
    }
    const sealed = JSON.parse(bytesToUtf8(blob)) as Sealed;
    this.index = JSON.parse(bytesToUtf8(open(this.dek!, sealed))) as VaultIndex;
  }

  private async persistIndex(): Promise<void> {
    const sealed = seal(this.dek!, utf8ToBytes(JSON.stringify(this.index)));
    await this.storage.writeBlob(INDEX_ID, utf8ToBytes(JSON.stringify(sealed)));
  }

  // ---- items ----

  listItems(): VaultItem[] {
    this.requireUnlocked();
    return [...this.index!.items].sort((a, b) => b.createdAt - a.createdAt);
  }

  async addItem(
    type: ItemType,
    name: string,
    data: Uint8Array,
    opts: { mime?: string; isJson?: boolean; createdAt?: number; sourceUrl?: string } = {}
  ): Promise<VaultItem> {
    this.requireUnlocked();
    const item: VaultItem = {
      id: newId(),
      type,
      name,
      size: data.length,
      mime: opts.mime,
      isJson: opts.isJson,
      sourceUrl: opts.sourceUrl,
      createdAt: opts.createdAt ?? nowMs(),
    };
    const sealed = seal(this.dek!, data);
    await this.storage.writeBlob(item.id, utf8ToBytes(JSON.stringify(sealed)));
    this.index!.items.push(item);
    await this.persistIndex();
    return item;
  }

  async readItem(id: string): Promise<Uint8Array> {
    this.requireUnlocked();
    const blob = await this.storage.readBlob(id);
    if (!blob) throw new Error("Item not found");
    const sealed = JSON.parse(bytesToUtf8(blob)) as Sealed;
    return open(this.dek!, sealed);
  }

  async deleteItem(id: string): Promise<void> {
    this.requireUnlocked();
    await this.storage.deleteBlob(id);
    this.index!.items = this.index!.items.filter((i) => i.id !== id);
    await this.persistIndex();
  }

  // ---- password change (re-wrap DEK only) ----

  async changePassword(oldPw: string, newPw: string): Promise<void> {
    const m = await this.loadManifest();
    const oldMk = deriveKey(oldPw, fromB64(m.kdf.salt), m.kdf.iterations);
    let dek: Uint8Array;
    try {
      if (bytesToUtf8(open(oldMk, m.verifier)) !== VERIFIER_PLAINTEXT)
        throw new Error("wrong password");
      dek = open(oldMk, m.wrappedDek);
    } catch {
      throw new Error("Current password is incorrect");
    }
    const salt = randomBytes(SALT_LEN);
    const newMk = deriveKey(newPw, salt);
    const updated: VaultManifest = {
      version: 1,
      kdf: { salt: toB64(salt), iterations: KDF_ITERATIONS },
      wrappedDek: seal(newMk, dek),
      verifier: seal(newMk, utf8ToBytes(VERIFIER_PLAINTEXT)),
    };
    await this.storage.writeManifest(JSON.stringify(updated));
  }

  // ---- backup / restore ----

  /** Encrypted archive of the whole vault, wrapped under a chosen backup password. */
  async exportVault(backupPassword: string): Promise<string> {
    this.requireUnlocked();
    const salt = randomBytes(SALT_LEN);
    const bmk = deriveKey(backupPassword, salt);
    const blobs: Record<string, Sealed> = {};
    // index
    const idxBlob = await this.storage.readBlob(INDEX_ID);
    if (idxBlob) blobs[INDEX_ID] = JSON.parse(bytesToUtf8(idxBlob)) as Sealed;
    // items (already sealed under DEK on disk — copy as-is)
    for (const item of this.index!.items) {
      const b = await this.storage.readBlob(item.id);
      if (b) blobs[item.id] = JSON.parse(bytesToUtf8(b)) as Sealed;
    }
    const backup: VaultBackup = {
      version: 1,
      kind: "vault-backup",
      kdf: { salt: toB64(salt), iterations: KDF_ITERATIONS },
      wrappedDek: seal(bmk, this.dek!),
      blobs,
    };
    return JSON.stringify(backup);
  }

  /**
   * Restore a backup into a fresh vault. Unwraps the DEK with the backup
   * password, then re-wraps it under a new device password and writes
   * everything. Refuses if a vault already exists (export first / wipe).
   */
  async importVault(
    archiveJson: string,
    backupPassword: string,
    newDevicePassword: string
  ): Promise<void> {
    if (await this.exists()) throw new Error("A vault already exists on this device");
    const backup = JSON.parse(archiveJson) as VaultBackup;
    if (backup.kind !== "vault-backup") throw new Error("Not a vault backup file");
    const bmk = deriveKey(
      backupPassword,
      fromB64(backup.kdf.salt),
      backup.kdf.iterations
    );
    let dek: Uint8Array;
    try {
      dek = open(bmk, backup.wrappedDek);
    } catch {
      throw new Error("Backup password is incorrect");
    }
    // write all blobs verbatim (they're sealed under this DEK)
    for (const [id, sealed] of Object.entries(backup.blobs)) {
      await this.storage.writeBlob(id, utf8ToBytes(JSON.stringify(sealed)));
    }
    // new manifest wrapping the restored DEK under the new device password
    const salt = randomBytes(SALT_LEN);
    const mk = deriveKey(newDevicePassword, salt);
    const manifest: VaultManifest = {
      version: 1,
      kdf: { salt: toB64(salt), iterations: KDF_ITERATIONS },
      wrappedDek: seal(mk, dek),
      verifier: seal(mk, utf8ToBytes(VERIFIER_PLAINTEXT)),
    };
    await this.storage.writeManifest(JSON.stringify(manifest));
    this.dek = dek;
    await this.loadIndex();
  }

  // ---- danger ----

  async wipe(): Promise<void> {
    await this.storage.clearAll();
    await this.keychain.deleteItem(BIO_KEY);
    this.lock();
  }

  private requireUnlocked(): void {
    if (!this.dek) throw new Error("Vault is locked");
  }
}

// Injected so tests stay deterministic; the app passes Date.now.
let nowMs = (): number => Date.now();
export function __setClock(fn: () => number): void {
  nowMs = fn;
}
