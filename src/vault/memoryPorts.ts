// In-memory Storage + Keychain for tests (and a desktop dry-run). The Expo
// implementations live in src/platform/ and are only imported by the app.
import type { Keychain, Storage } from "./ports";

export class MemoryStorage implements Storage {
  manifest: string | null = null;
  blobs = new Map<string, Uint8Array>();

  async readManifest() {
    return this.manifest;
  }
  async writeManifest(json: string) {
    this.manifest = json;
  }
  async readBlob(id: string) {
    return this.blobs.get(id) ?? null;
  }
  async writeBlob(id: string, data: Uint8Array) {
    this.blobs.set(id, data);
  }
  async deleteBlob(id: string) {
    this.blobs.delete(id);
  }
  async clearAll() {
    this.manifest = null;
    this.blobs.clear();
  }
}

export class MemoryKeychain implements Keychain {
  store = new Map<string, string>();
  async setItem(k: string, v: string) {
    this.store.set(k, v);
  }
  async getItem(k: string) {
    return this.store.get(k) ?? null;
  }
  async deleteItem(k: string) {
    this.store.delete(k);
  }
}
