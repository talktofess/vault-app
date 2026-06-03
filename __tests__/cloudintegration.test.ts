import { describe, expect, it } from "vitest";
import { VaultService, __setClock } from "../src/vault/VaultService";
import { MemoryKeychain, MemoryStorage } from "../src/vault/memoryPorts";
import { bytesToUtf8, utf8ToBytes } from "../src/crypto/b64";
import { syncIfLinked } from "../src/cloud/autosync";
import type { CloudStore } from "../src/cloud/ports";
import type { RemoteItem, VaultKeysRow } from "../src/cloud/types";

__setClock(() => Date.parse("2026-06-01T00:00:00Z") + tick());
let _t = 0;
function tick() {
  return (_t += 1000);
}

// Shared in-memory cloud backing both "devices".
function fakeCloud() {
  const items = new Map<string, RemoteItem>();
  const objects = new Map<string, Uint8Array>();
  let keys: VaultKeysRow | null = null;
  let clock = 1;
  const stamp = () => `2026-06-01T00:${String(Math.floor(clock / 60)).padStart(2, "0")}:${String(clock++ % 60).padStart(2, "0")}Z`;
  const store: CloudStore = {
    async getVaultKeys() {
      return keys;
    },
    async putVaultKeys(k) {
      keys = k;
    },
    async listItemsSince(cursor) {
      const all = [...items.values()].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
      return cursor ? all.filter((r) => r.updatedAt > cursor) : all;
    },
    async countItems() {
      return [...items.values()].filter((r) => !r.deletedAt).length;
    },
    async upsertItem(row) {
      const prev = items.get(row.id);
      items.set(row.id, { ...row, createdAt: prev?.createdAt ?? row.createdAt, updatedAt: stamp(), deletedAt: row.deletedAt ?? null });
    },
    async markDeleted(id) {
      const r = items.get(id);
      if (r) items.set(id, { ...r, deletedAt: stamp(), updatedAt: stamp() });
    },
    async uploadObject(path, bytes) {
      objects.set(path, bytes.slice());
    },
    async downloadObject(path) {
      const b = objects.get(path);
      if (!b) throw new Error("object missing");
      return b;
    },
    async downloadRange(path, start, length) {
      return (objects.get(path) ?? new Uint8Array()).subarray(start, start + length);
    },
    async removeObject(path) {
      objects.delete(path);
    },
  };
  return { store, items, objects };
}

const USER = "user-1";

describe("cloud sync across two devices", () => {
  it("pushes from A, bootstraps B from the passphrase, and pulls metadata", async () => {
    const { store, objects } = fakeCloud();

    // Device A: real vault with two items, then enable cloud + push.
    const a = new VaultService(new MemoryStorage(), new MemoryKeychain());
    await a.create("1234");
    const v1 = await a.addItem("media", "clip.mp4", utf8ToBytes("video-bytes".repeat(500)), { mime: "video/mp4" });
    await a.addItem("note", "secret", utf8ToBytes("hello"));
    await a.enableCloud(store, "a strong passphrase");
    const pushed = await a.pushAll(store, USER);
    expect(pushed).toBe(2);
    expect(objects.size).toBe(2);

    // Device B: brand-new install. Recover the DEK from the passphrase, seed a
    // fresh local vault under a different PIN, then pull.
    const dek = await VaultService.recoverDekFromCloud(store, "a strong passphrase");
    const b = new VaultService(new MemoryStorage(), new MemoryKeychain());
    await b.createWithDek("9999", dek);
    const { added } = await b.pull(store);
    expect(added).toBe(2);

    // B sees the items but hasn't downloaded them.
    const items = b.listItems();
    expect(items.map((i) => i.name).sort()).toEqual(["clip.mp4", "secret"]);
    expect(b.isCached(v1.id)).toBe(false);

    // Streaming/transient read works without caching.
    expect(bytesToUtf8(await b.fetchRemoteBytes(store, v1.id))).toBe("video-bytes".repeat(500));
  });

  it("caches on demand, then reads offline; uncache keeps the cloud copy", async () => {
    const { store, objects } = fakeCloud();
    const a = new VaultService(new MemoryStorage(), new MemoryKeychain());
    await a.create("1234");
    const item = await a.addItem("file", "report.pdf", utf8ToBytes("pdf-data"), { mime: "application/pdf" });
    await a.enableCloud(store, "pw-pw-pw-pw");
    await a.pushAll(store, USER);

    const dek = await VaultService.recoverDekFromCloud(store, "pw-pw-pw-pw");
    const b = new VaultService(new MemoryStorage(), new MemoryKeychain());
    await b.createWithDek("0000", dek);
    await b.pull(store);

    // Cache it -> now readable from the local store (works offline).
    await b.cacheItem(store, item.id);
    expect(b.isCached(item.id)).toBe(true);
    expect(bytesToUtf8(await b.readItem(item.id))).toBe("pdf-data");

    // Uncache -> local blob gone, but the cloud copy + row remain.
    await b.uncacheItem(item.id);
    expect(b.isCached(item.id)).toBe(false);
    expect(objects.size).toBe(1);
    await expect(b.readItem(item.id)).rejects.toThrow();
  });

  it("deleteEverywhere tombstones the row, removes the object, and propagates", async () => {
    const { store, objects } = fakeCloud();
    const a = new VaultService(new MemoryStorage(), new MemoryKeychain());
    await a.create("1234");
    const item = await a.addItem("media", "old.jpg", utf8ToBytes("img"), { mime: "image/jpeg" });
    await a.enableCloud(store, "pw-pw-pw-pw");
    await a.pushAll(store, USER);

    const b = new VaultService(new MemoryStorage(), new MemoryKeychain());
    await b.createWithDek("0000", await VaultService.recoverDekFromCloud(store, "pw-pw-pw-pw"));
    await b.pull(store);
    expect(b.listItems()).toHaveLength(1);

    // A deletes everywhere; the object is gone and the row is tombstoned.
    await a.deleteEverywhere(store, item.id);
    expect(objects.size).toBe(0);

    // B pulls the tombstone and drops the item locally.
    const { removed } = await b.pull(store);
    expect(removed).toBe(1);
    expect(b.listItems()).toHaveLength(0);
  });

  it("restoreFromCloud bootstraps a fresh device from email-account + passphrase", async () => {
    const { store } = fakeCloud();
    const a = new VaultService(new MemoryStorage(), new MemoryKeychain());
    await a.create("1234");
    await a.addItem("media", "a.jpg", utf8ToBytes("aaa"), { mime: "image/jpeg" });
    await a.addItem("file", "b.bin", utf8ToBytes("bbb"));
    await a.enableCloud(store, "the-passphrase");
    await a.pushAll(store, USER);

    const b = new VaultService(new MemoryStorage(), new MemoryKeychain());
    expect(await b.checkCloudPassphrase(store, "nope")).toBe(false);
    expect(await b.checkCloudPassphrase(store, "the-passphrase")).toBe(true);

    const { pulled } = await b.restoreFromCloud(store, "the-passphrase"); // shared PIN comes from the account
    expect(pulled).toBe(2);
    expect(b.isUnlocked()).toBe(true);
    expect(b.listItems().map((i) => i.name).sort()).toEqual(["a.jpg", "b.bin"]);
    // B uses A's PIN (the shared account PIN), not a new one.
    b.lock();
    expect(await b.unlock("1234")).toBe(true);
    expect(bytesToUtf8(await b.fetchRemoteBytes(store, b.listItems()[0].id)).length).toBeGreaterThan(0);

    // Refuses to clobber an existing local vault.
    await expect(b.restoreFromCloud(store, "the-passphrase", "0000")).rejects.toThrow(/already exists/i);
  });

  it("restoreFromCloud rejects a wrong passphrase", async () => {
    const { store } = fakeCloud();
    const a = new VaultService(new MemoryStorage(), new MemoryKeychain());
    await a.create("1234");
    await a.enableCloud(store, "right-pass");

    const b = new VaultService(new MemoryStorage(), new MemoryKeychain());
    await expect(b.restoreFromCloud(store, "wrong-pass", "0000")).rejects.toThrow();
    expect(await b.exists()).toBe(false); // nothing was created
  });

  it("adoptCloudVault merges an independently-created device into the shared vault", async () => {
    const { store } = fakeCloud();

    // Device A: own vault + item, connects to cloud first.
    const a = new VaultService(new MemoryStorage(), new MemoryKeychain());
    await a.create("1111");
    await a.addItem("note", "from-A", utf8ToBytes("alpha"));
    await a.enableCloud(store, "shared safe words");
    await a.pushAll(store, USER);

    // Device B: SEPARATE vault (different DEK) + its own item.
    const b = new VaultService(new MemoryStorage(), new MemoryKeychain());
    await b.create("2222");
    await b.addItem("note", "from-B", utf8ToBytes("bravo"));
    expect(await b.cloudKeyMatchesLocal(store, "shared safe words")).toBe(false);

    // Adopt + merge: re-key B's items to the cloud key, push them, pull A's.
    await b.adoptCloudVault(store, "shared safe words");
    await b.pushAll(store, USER);
    await b.pull(store);

    // B now sees BOTH items and can read each (its own cached, A's via cloud).
    const names = b.listItems().map((i) => i.name).sort();
    expect(names).toEqual(["from-A", "from-B"]);
    const bOwn = b.listItems().find((i) => i.name === "from-B")!;
    expect(bytesToUtf8(await b.readItem(bOwn.id))).toBe("bravo");
    const aItem = b.listItems().find((i) => i.name === "from-A")!;
    expect(bytesToUtf8(await b.fetchRemoteBytes(store, aItem.id))).toBe("alpha");

    // B now unlocks with the SHARED account PIN (A's "1111"), not its old "2222".
    b.lock();
    expect(await b.unlock("2222")).toBe(false);
    expect(await b.unlock("1111")).toBe(true);

    // A pulls and gets B's item too — one vault.
    const { added } = await a.pull(store);
    expect(added).toBe(1);
    expect(a.listItems().map((i) => i.name).sort()).toEqual(["from-A", "from-B"]);
  });

  it("updateSharedPin propagates a PIN change to new devices", async () => {
    const { store } = fakeCloud();
    const a = new VaultService(new MemoryStorage(), new MemoryKeychain());
    await a.create("1111");
    await a.enableCloud(store, "shared safe words"); // stores shared PIN "1111"

    // Change the PIN locally, then push it to the account.
    await a.changePassword("1111", "9999");
    expect(await a.updateSharedPin(store, "wrong words", "9999")).toBe(false); // doesn't clobber
    expect(await a.updateSharedPin(store, "shared safe words", "9999")).toBe(true);

    // A fresh device adopts the NEW shared PIN.
    const b = new VaultService(new MemoryStorage(), new MemoryKeychain());
    await b.restoreFromCloud(store, "shared safe words");
    b.lock();
    expect(await b.unlock("1111")).toBe(false);
    expect(await b.unlock("9999")).toBe(true);
  });

  it("syncIfLinked is a no-op until signed in AND linked, then pushes + pulls", async () => {
    const { store } = fakeCloud();
    const v = new VaultService(new MemoryStorage(), new MemoryKeychain());
    await v.create("1234");
    await v.addItem("file", "x.bin", utf8ToBytes("x"));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const signedOut = { auth: { currentUserId: async () => null }, store } as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const signedIn = { auth: { currentUserId: async () => USER }, store } as any;

    expect(await syncIfLinked(v, null)).toBeNull(); // no cloud configured
    expect(await syncIfLinked(v, signedOut)).toBeNull(); // signed out
    expect(await syncIfLinked(v, signedIn)).toBeNull(); // signed in but not linked

    await v.enableCloud(store, "pass-pass");
    const res = await syncIfLinked(v, signedIn); // linked -> actually syncs
    expect(res?.pushed).toBe(1);
  });
});
