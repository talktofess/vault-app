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
  DECOY_INDEX_ID,
  INDEX_ID,
  VERIFIER_PLAINTEXT,
  type Credential,
  type ItemType,
  type VaultBackup,
  type VaultIndex,
  type VaultItem,
  type VaultManifest,
} from "./types";
import type { CloudStore } from "../cloud/ports";
import { buildVaultKeys, recoverDek, recoverPin } from "../cloud/keyflows";
import { decodeFk, decodeMeta, decodeObject, encodeItem } from "../cloud/codec";
import { StreamReader, type RemoteStream } from "../cloud/stream";
import { CHUNK, chunkCount } from "../crypto/chunkCipher";
import { packSealed } from "../crypto/keys";

const BIO_KEY = "vault.dek"; // keychain entry holding the DEK for biometric unlock

function newId(): string {
  return toB64(randomBytes(12)).replace(/[+/=]/g, "").slice(0, 16);
}

export class VaultService {
  private dek: Uint8Array | null = null; // present only while unlocked
  private index: VaultIndex | null = null;
  private indexId: string = INDEX_ID; // switches to the decoy index under duress
  private decoy = false; // true when unlocked via the duress password
  private lastIntrusions: number[] = []; // failed attempts seen at last unlock
  private sessionPin: string | null = null; // the PIN used this session (to sync as the shared PIN)

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
    this.sessionPin = null;
    this.index = null;
    this.indexId = INDEX_ID;
    this.decoy = false;
  }

  /** True when the current session was opened with the duress password. */
  isDecoy(): boolean {
    return this.decoy;
  }

  /** First-run: set the master password, generate the DEK, write the manifest. */
  async create(password: string): Promise<void> {
    await this.createWithDek(password, randomBytes(32));
  }

  /**
   * Like create(), but wraps a SPECIFIC DEK under the new PIN. Used when
   * bootstrapping a new device from the cloud: the account DEK is recovered
   * with the passphrase, then re-wrapped here under a fresh local PIN so the
   * device shares the one vault key. Starts with an empty local index; items
   * arrive via pull().
   */
  async createWithDek(password: string, dek: Uint8Array): Promise<void> {
    if (await this.exists()) throw new Error("Vault already exists");
    const salt = randomBytes(SALT_LEN);
    const mk = deriveKey(password, salt);
    const manifest: VaultManifest = {
      version: 1,
      kdf: { salt: toB64(salt), iterations: KDF_ITERATIONS },
      wrappedDek: seal(mk, dek),
      verifier: seal(mk, utf8ToBytes(VERIFIER_PLAINTEXT)),
    };
    await this.storage.writeManifest(JSON.stringify(manifest));
    this.dek = dek;
    this.sessionPin = password;
    this.index = { items: [] };
    await this.persistIndex();
  }

  private async loadManifest(): Promise<VaultManifest> {
    const raw = await this.storage.readManifest();
    if (!raw) throw new Error("No vault");
    return JSON.parse(raw) as VaultManifest;
  }

  /**
   * Unlock with the master password. Returns false on wrong password. If a
   * duress password is configured and matches, this unlocks the DECOY vault
   * instead (isDecoy() === true) — the caller can't tell the difference, which
   * is the point.
   */
  async unlock(password: string): Promise<boolean> {
    const m = await this.loadManifest();

    // 1. try the real password
    const mk = deriveKey(password, fromB64(m.kdf.salt), m.kdf.iterations);
    try {
      if (bytesToUtf8(open(mk, m.verifier)) === VERIFIER_PLAINTEXT) {
        this.dek = open(mk, m.wrappedDek);
        this.sessionPin = password;
        this.decoy = false;
        this.indexId = INDEX_ID;
        await this.loadIndex();
        await this.onUnlockSuccess(m, false);
        return true;
      }
    } catch {
      /* fall through to duress check */
    }

    // 2. try the duress password -> decoy vault
    if (m.duress) {
      const dmk = deriveKey(password, fromB64(m.duress.kdf.salt), m.duress.kdf.iterations);
      try {
        if (bytesToUtf8(open(dmk, m.duress.verifier)) === VERIFIER_PLAINTEXT) {
          this.dek = open(dmk, m.duress.wrappedDek);
          this.decoy = true;
          this.indexId = DECOY_INDEX_ID;
          await this.loadIndex();
          // A duress unlock leaves the real intrusion log intact (don't tip off
          // the coercer that attempts were logged) — just capture for display.
          this.lastIntrusions = m.intrusions ?? [];
          return true;
        }
      } catch {
        /* wrong */
      }
    }

    // total failure -> log the intrusion
    await this.onUnlockFailure(m);
    return false;
  }

  // ---- intrusion log & lockout ----

  private async onUnlockSuccess(m: VaultManifest, decoy: boolean): Promise<void> {
    this.lastIntrusions = m.intrusions ?? [];
    if (!decoy && (m.intrusions?.length || m.failedStreak)) {
      const cleared: VaultManifest = { ...m, intrusions: [], failedStreak: 0 };
      await this.storage.writeManifest(JSON.stringify(cleared));
    }
  }

  private async onUnlockFailure(m: VaultManifest): Promise<void> {
    const intrusions = [...(m.intrusions ?? []), nowMs()].slice(-50); // keep last 50
    const updated: VaultManifest = {
      ...m,
      intrusions,
      failedStreak: (m.failedStreak ?? 0) + 1,
    };
    await this.storage.writeManifest(JSON.stringify(updated));
  }

  /** Failed unlock attempts recorded since the last successful unlock. */
  getIntrusions(): number[] {
    return [...this.lastIntrusions];
  }

  /**
   * Remaining lockout in ms based on consecutive failures: free for the first 4
   * tries, then exponential backoff (5th=30s, doubling, capped at 5 min) measured
   * from the most recent failed attempt.
   */
  async lockoutRemainingMs(): Promise<number> {
    const m = await this.loadManifest().catch(() => null);
    if (!m) return 0;
    const streak = m.failedStreak ?? 0;
    if (streak < 5) return 0;
    const base = 30_000;
    const delay = Math.min(base * 2 ** (streak - 5), 5 * 60_000);
    const last = m.intrusions?.[m.intrusions.length - 1] ?? 0;
    return Math.max(0, last + delay - nowMs());
  }

  /**
   * Configure (or replace) the duress password. Must be unlocked with the REAL
   * password. Generates a fresh decoy DEK + empty decoy index so the duress
   * login opens a believable, empty vault. Refuses if the duress password
   * equals the real one.
   */
  async setDuressPassword(duressPassword: string): Promise<void> {
    this.requireUnlocked();
    if (this.decoy) throw new Error("Cannot set a duress password from the decoy vault");
    // ensure it isn't the real password (which would shadow the real vault)
    const m = await this.loadManifest();
    const asReal = deriveKey(duressPassword, fromB64(m.kdf.salt), m.kdf.iterations);
    try {
      if (bytesToUtf8(open(asReal, m.verifier)) === VERIFIER_PLAINTEXT) {
        throw new Error("Duress password must differ from your real password");
      }
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("Duress password must")) throw e;
      /* good: it doesn't match the real password */
    }

    const salt = randomBytes(SALT_LEN);
    const dmk = deriveKey(duressPassword, salt);
    const decoyDek = randomBytes(32);
    const updated: VaultManifest = {
      ...m,
      duress: {
        kdf: { salt: toB64(salt), iterations: KDF_ITERATIONS },
        wrappedDek: seal(dmk, decoyDek),
        verifier: seal(dmk, utf8ToBytes(VERIFIER_PLAINTEXT)),
      },
    };
    await this.storage.writeManifest(JSON.stringify(updated));
    // seed an empty decoy index so the decoy login lands on a clean vault
    const emptyIndex: VaultIndex = { items: [] };
    const sealed = seal(decoyDek, utf8ToBytes(JSON.stringify(emptyIndex)));
    await this.storage.writeBlob(DECOY_INDEX_ID, utf8ToBytes(JSON.stringify(sealed)));
  }

  async hasDuress(): Promise<boolean> {
    const m = await this.loadManifest();
    return m.duress !== undefined;
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
    const blob = await this.storage.readBlob(this.indexId);
    if (!blob) {
      this.index = { items: [] };
      return;
    }
    const sealed = JSON.parse(bytesToUtf8(blob)) as Sealed;
    this.index = JSON.parse(bytesToUtf8(open(this.dek!, sealed))) as VaultIndex;
  }

  private async persistIndex(): Promise<void> {
    const sealed = seal(this.dek!, utf8ToBytes(JSON.stringify(this.index)));
    await this.storage.writeBlob(this.indexId, utf8ToBytes(JSON.stringify(sealed)));
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
    opts: {
      mime?: string;
      isJson?: boolean;
      createdAt?: number;
      sourceUrl?: string;
      album?: string;
    } = {}
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
      album: opts.album,
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

  /** Rename, move to an album (album: "" clears), and/or pin an item. */
  async updateItemMeta(
    id: string,
    changes: { name?: string; album?: string; pinned?: boolean }
  ): Promise<void> {
    this.requireUnlocked();
    const item = this.index!.items.find((i) => i.id === id);
    if (!item) throw new Error("Item not found");
    if (changes.name !== undefined) item.name = changes.name;
    if (changes.album !== undefined) item.album = changes.album || undefined;
    if (changes.pinned !== undefined) item.pinned = changes.pinned || undefined;
    await this.persistIndex();
  }

  /** Distinct album names across items, sorted. */
  albums(): string[] {
    this.requireUnlocked();
    const set = new Set<string>();
    for (const i of this.index!.items) if (i.album) set.add(i.album);
    return [...set].sort();
  }

  /** Search items by name (case-insensitive substring), newest first. */
  search(query: string): VaultItem[] {
    this.requireUnlocked();
    const q = query.trim().toLowerCase();
    const items = q
      ? this.index!.items.filter((i) => i.name.toLowerCase().includes(q))
      : [...this.index!.items];
    return items.sort((a, b) => b.createdAt - a.createdAt);
  }

  // ---- credential manager (entries are encrypted JSON of type "credential") ----

  async addCredential(cred: Credential): Promise<VaultItem> {
    const bytes = utf8ToBytes(JSON.stringify(cred));
    return this.addItem("credential", cred.title || "Untitled", bytes);
  }

  async updateCredential(id: string, cred: Credential): Promise<void> {
    this.requireUnlocked();
    const item = this.index!.items.find((i) => i.id === id);
    if (!item) throw new Error("Item not found");
    const sealed = seal(this.dek!, utf8ToBytes(JSON.stringify(cred)));
    await this.storage.writeBlob(id, utf8ToBytes(JSON.stringify(sealed)));
    item.name = cred.title || "Untitled";
    item.size = JSON.stringify(cred).length;
    await this.persistIndex();
  }

  async readCredential(id: string): Promise<Credential> {
    const bytes = await this.readItem(id);
    return JSON.parse(bytesToUtf8(bytes)) as Credential;
  }

  listCredentials(): VaultItem[] {
    this.requireUnlocked();
    return this.index!.items
      .filter((i) => i.type === "credential")
      .sort((a, b) => a.name.localeCompare(b.name));
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
      ...m, // preserve duress / intrusion fields
      version: 1,
      kdf: { salt: toB64(salt), iterations: KDF_ITERATIONS },
      wrappedDek: seal(newMk, dek),
      verifier: seal(newMk, utf8ToBytes(VERIFIER_PLAINTEXT)),
    };
    await this.storage.writeManifest(JSON.stringify(updated));
    if (this.sessionPin === oldPw) this.sessionPin = newPw;
  }

  /**
   * Propagate a PIN change to the whole account: re-wraps the shared PIN in the
   * cloud key-set under the safe words (verified against the local key first, so
   * a wrong passphrase can't lock other devices out). Returns false if the safe
   * words are wrong. Other devices pick up the new PIN on their next restore/
   * adopt; already-set-up devices keep working with the old PIN until then.
   */
  async updateSharedPin(cloud: CloudStore, passphrase: string, newPin: string): Promise<boolean> {
    this.requireUnlocked();
    if (!(await this.cloudKeyMatchesLocal(cloud, passphrase))) return false;
    await cloud.putVaultKeys(buildVaultKeys(this.dek!, passphrase, undefined, newPin));
    return true;
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

  // ---- cloud sync (zero-knowledge; see docs/cloud-architecture.md) ----
  //
  // The DEK never leaves this object: enableCloud wraps it under the passphrase,
  // pushItem encrypts items under per-file keys, and pull only learns metadata.
  // Caching is explicit (cacheItem); offline you can read only cached items.

  /** Recover the account DEK from the cloud key-set (new-device bootstrap). */
  static async recoverDekFromCloud(cloud: CloudStore, passphrase: string): Promise<Uint8Array> {
    const keys = await cloud.getVaultKeys();
    if (!keys) throw new Error("No cloud vault to bootstrap from");
    return recoverDek(keys, passphrase);
  }

  /** Publish this vault's DEK + shared PIN wrapped under the passphrase (enable cloud). */
  async enableCloud(cloud: CloudStore, passphrase: string): Promise<void> {
    this.requireUnlocked();
    if (this.decoy) throw new Error("Cannot enable cloud from the decoy vault");
    await cloud.putVaultKeys(buildVaultKeys(this.dek!, passphrase, undefined, this.sessionPin));
  }

  /** Recover the account's shared PIN (set on the first device), or null. */
  static async recoverPinFromCloud(cloud: CloudStore, passphrase: string): Promise<string | null> {
    const keys = await cloud.getVaultKeys();
    return keys ? recoverPin(keys, passphrase) : null;
  }

  /**
   * Seed the account's shared PIN from this device if it isn't set yet (e.g. a
   * vault enabled before the shared-PIN feature). No-op once a PIN is stored.
   */
  async ensureSharedPin(cloud: CloudStore, passphrase: string): Promise<void> {
    this.requireUnlocked();
    if (this.decoy || !this.sessionPin) return;
    const keys = await cloud.getVaultKeys();
    if (!keys || keys.wrappedPin) return;
    await cloud.putVaultKeys(buildVaultKeys(this.dek!, passphrase, undefined, this.sessionPin));
  }

  async cloudEnabled(cloud: CloudStore): Promise<boolean> {
    return (await cloud.getVaultKeys()) !== null;
  }

  /**
   * Does the passphrase recover a DEK equal to this device's DEK? Used before
   * linking: if the account already has a cloud vault under a DIFFERENT key,
   * pushing local items would corrupt the set, so the UI must refuse.
   */
  async cloudKeyMatchesLocal(cloud: CloudStore, passphrase: string): Promise<boolean> {
    this.requireUnlocked();
    const keys = await cloud.getVaultKeys();
    if (!keys) return false;
    try {
      const dek = recoverDek(keys, passphrase);
      if (dek.length !== this.dek!.length) return false;
      let diff = 0;
      for (let i = 0; i < dek.length; i++) diff |= dek[i] ^ this.dek![i];
      return diff === 0;
    } catch {
      return false;
    }
  }

  private nowIso(): string {
    return new Date(nowMs()).toISOString();
  }

  /** Encrypt + upload one local item to the cloud and record the remote ref. */
  async pushItem(cloud: CloudStore, userId: string, id: string): Promise<void> {
    this.requireUnlocked();
    const item = this.index!.items.find((i) => i.id === id);
    if (!item) throw new Error("Item not found");
    const plain = await this.readItem(id);
    const { object, row } = encodeItem(
      this.dek!,
      userId,
      id,
      { name: item.name, mime: item.mime, album: item.album, kind: item.type },
      plain
    );
    await cloud.uploadObject(row.storagePath, object, "application/octet-stream");
    const updatedAt = this.nowIso();
    await cloud.upsertItem({
      ...row,
      createdAt: new Date(item.createdAt).toISOString(),
      updatedAt, // server overrides via trigger; sent for fakes/back-compat
      deletedAt: null,
    });
    item.remote = { path: row.storagePath, updatedAt, wrappedFk: row.wrappedFk, byteSize: row.byteSize };
    item.cached = true;
    await this.persistIndex();
  }

  /**
   * Re-sync just an item's metadata (name/album) to the cloud — re-seals
   * enc_meta and updates the row, WITHOUT re-uploading the blob. No-op if the
   * item has no cloud copy yet.
   */
  async pushItemMeta(cloud: CloudStore, id: string): Promise<void> {
    this.requireUnlocked();
    const item = this.index!.items.find((i) => i.id === id);
    if (!item?.remote) return;
    const meta = {
      name: item.name,
      mime: item.mime,
      album: item.album,
      kind: item.type,
      plainSize: item.size,
      chunkSize: CHUNK,
      chunkCount: chunkCount(item.size),
    };
    await cloud.upsertItem({
      id,
      encMeta: packSealed(seal(this.dek!, utf8ToBytes(JSON.stringify(meta)))),
      wrappedFk: item.remote.wrappedFk,
      byteSize: item.remote.byteSize,
      storagePath: item.remote.path,
      contentHash: null,
      createdAt: new Date(item.createdAt).toISOString(),
      updatedAt: this.nowIso(),
      deletedAt: null,
    });
  }

  /** Push every local item that isn't on the cloud yet. Returns the count pushed. */
  async pushAll(cloud: CloudStore, userId: string): Promise<number> {
    this.requireUnlocked();
    const todo = this.index!.items.filter((i) => !i.remote);
    for (const i of todo) await this.pushItem(cloud, userId, i.id);
    return todo.length;
  }

  /** Pull metadata changes since the last cursor. Does NOT download blobs. */
  async pull(cloud: CloudStore): Promise<{ added: number; removed: number }> {
    this.requireUnlocked();
    const rows = await cloud.listItemsSince(this.index!.syncCursor ?? null);
    let added = 0;
    let removed = 0;
    for (const row of rows) {
      const existing = this.index!.items.find((i) => i.id === row.id);
      if (row.deletedAt) {
        if (existing) {
          await this.storage.deleteBlob(row.id);
          this.index!.items = this.index!.items.filter((i) => i.id !== row.id);
          removed++;
        }
      } else {
        const meta = decodeMeta(this.dek!, row.encMeta);
        const ref = { path: row.storagePath, updatedAt: row.updatedAt, wrappedFk: row.wrappedFk, byteSize: row.byteSize };
        if (existing) {
          existing.name = meta.name;
          existing.mime = meta.mime;
          existing.album = meta.album;
          existing.size = meta.plainSize;
          existing.remote = ref;
        } else {
          this.index!.items.push({
            id: row.id,
            type: (meta.kind as ItemType) ?? "file",
            name: meta.name,
            size: meta.plainSize,
            mime: meta.mime,
            album: meta.album,
            createdAt: Date.parse(row.createdAt) || nowMs(),
            remote: ref,
            cached: false,
          });
          added++;
        }
      }
      this.index!.syncCursor = row.updatedAt;
    }
    await this.persistIndex();
    return { added, removed };
  }

  /** Whether the item's encrypted blob is present on this device. */
  isCached(id: string): boolean {
    const item = this.index!.items.find((i) => i.id === id);
    return !!item && item.cached !== false;
  }

  /** Does the passphrase open this account's cloud key-set? (pre-flight check) */
  async checkCloudPassphrase(cloud: CloudStore, passphrase: string): Promise<boolean> {
    const keys = await cloud.getVaultKeys();
    if (!keys) return false;
    try {
      recoverDek(keys, passphrase);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * New-device bootstrap: recover the account DEK with the passphrase, seed a
   * fresh local vault under a new PIN that wraps that same DEK, then pull the
   * cloud metadata. Refuses if a local vault already exists.
   */
  async restoreFromCloud(
    cloud: CloudStore,
    passphrase: string,
    fallbackPin?: string
  ): Promise<{ pulled: number }> {
    if (await this.exists()) throw new Error("A vault already exists on this device");
    const keys = await cloud.getVaultKeys();
    if (!keys) throw new Error("No cloud vault found for this account");
    const dek = recoverDek(keys, passphrase); // throws on a wrong passphrase
    const pin = recoverPin(keys, passphrase) ?? fallbackPin; // prefer the account's shared PIN
    if (!pin) {
      const err = new Error("NO_SHARED_PIN");
      throw err; // caller should ask the user to set a PIN, then retry with it
    }
    await this.createWithDek(pin, dek);
    const { added } = await this.pull(cloud);
    return { pulled: added };
  }

  /**
   * Merge an EXISTING local vault into the shared cloud vault so this device
   * becomes part of the one account. Re-keys every local item from the device's
   * own DEK to the cloud DEK (recovered from the safe words), re-wraps the
   * manifest under the verified PIN, then the caller pushes the migrated items
   * and pulls the rest. Needed when a device was set up independently before
   * connecting — the "one vault across devices" path.
   */
  async adoptCloudVault(cloud: CloudStore, passphrase: string): Promise<{ migrated: number }> {
    this.requireUnlocked();
    if (this.decoy) throw new Error("Cannot link cloud from the decoy vault");
    const keys = await cloud.getVaultKeys();
    if (!keys) throw new Error("No cloud vault found for these safe words");
    const cloudDek = recoverDek(keys, passphrase);
    // The whole account shares one PIN. Prefer the stored one; if absent (vault
    // predates the feature), seed it from this device's PIN and back it up.
    const sharedPin = recoverPin(keys, passphrase) ?? this.sessionPin;
    if (!sharedPin) throw new Error("Couldn't determine the shared PIN for this account.");
    if (!keys.wrappedPin) await cloud.putVaultKeys(buildVaultKeys(cloudDek, passphrase, undefined, sharedPin));

    // Re-encrypt local items from this device's DEK to the shared cloud DEK.
    const same = cloudDek.length === this.dek!.length && cloudDek.every((b, i) => b === this.dek![i]);
    let migrated = 0;
    if (!same) {
      const oldDek = this.dek!;
      for (const item of this.index!.items) {
        const blob = await this.storage.readBlob(item.id);
        if (!blob) continue;
        const sealed = JSON.parse(bytesToUtf8(blob)) as Sealed;
        await this.storage.writeBlob(item.id, utf8ToBytes(JSON.stringify(seal(cloudDek, open(oldDek, sealed)))));
        item.remote = undefined; // re-push under the shared key
        item.cached = true;
        migrated++;
      }
      this.dek = cloudDek;
    }

    // Re-wrap the manifest under the SHARED PIN (fresh salt) so this device
    // unlocks with the account-wide PIN.
    const m = await this.loadManifest();
    const salt = randomBytes(SALT_LEN);
    const mk = deriveKey(sharedPin, salt);
    const updated: VaultManifest = {
      ...m,
      kdf: { salt: toB64(salt), iterations: KDF_ITERATIONS },
      wrappedDek: seal(mk, this.dek!),
      verifier: seal(mk, utf8ToBytes(VERIFIER_PLAINTEXT)),
    };
    await this.storage.writeManifest(JSON.stringify(updated));
    await this.persistIndex();
    if (await this.keychain.getItem(BIO_KEY)) await this.keychain.setItem(BIO_KEY, toB64(this.dek!));
    this.sessionPin = sharedPin;
    return { migrated };
  }

  /**
   * A seekable, range-based reader over a remote item's encrypted object — the
   * basis for progressive ("watch while downloading") playback. The FK is
   * unwrapped here so the player layer never sees key material.
   */
  openRemoteStream(cloud: CloudStore, id: string): RemoteStream {
    this.requireUnlocked();
    const item = this.index!.items.find((i) => i.id === id);
    if (!item?.remote) throw new Error("No cloud copy");
    const reader = new StreamReader({
      store: cloud,
      path: item.remote.path,
      fk: decodeFk(this.dek!, item.remote.wrappedFk),
      chunkSize: CHUNK,
      byteSize: item.remote.byteSize,
    });
    return { chunkSize: CHUNK, chunkCount: reader.chunkCount, plainSize: item.size, mime: item.mime, reader };
  }

  /** Download + decrypt a remote item's bytes WITHOUT persisting (transient view). */
  async fetchRemoteBytes(cloud: CloudStore, id: string): Promise<Uint8Array> {
    this.requireUnlocked();
    const item = this.index!.items.find((i) => i.id === id);
    if (!item?.remote) throw new Error("No cloud copy");
    const object = await cloud.downloadObject(item.remote.path);
    return decodeObject(decodeFk(this.dek!, item.remote.wrappedFk), object);
  }

  /** Persist a remote item's blob locally (explicit opt-in caching). */
  async cacheItem(cloud: CloudStore, id: string): Promise<void> {
    this.requireUnlocked();
    const item = this.index!.items.find((i) => i.id === id);
    if (!item?.remote) throw new Error("No cloud copy to cache");
    const plain = await this.fetchRemoteBytes(cloud, id);
    await this.storage.writeBlob(id, utf8ToBytes(JSON.stringify(seal(this.dek!, plain))));
    item.cached = true;
    await this.persistIndex();
  }

  /** Drop the local blob but keep the cloud copy. Refuses if there's no cloud copy. */
  async uncacheItem(id: string): Promise<void> {
    this.requireUnlocked();
    const item = this.index!.items.find((i) => i.id === id);
    if (!item) return;
    if (!item.remote) throw new Error("Refusing to uncache: no cloud copy exists");
    await this.storage.deleteBlob(id);
    item.cached = false;
    await this.persistIndex();
  }

  /** Delete everywhere: cloud row tombstoned, object removed, local blob gone. */
  async deleteEverywhere(cloud: CloudStore, id: string): Promise<void> {
    this.requireUnlocked();
    const item = this.index!.items.find((i) => i.id === id);
    await cloud.markDeleted(id, this.nowIso());
    if (item?.remote) await cloud.removeObject(item.remote.path).catch(() => {});
    await this.deleteItem(id);
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
