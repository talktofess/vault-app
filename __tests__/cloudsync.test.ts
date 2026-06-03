import { describe, expect, it } from "vitest";
import { generateKey } from "../src/crypto/keys";
import { utf8ToBytes } from "../src/crypto/b64";
import { buildVaultKeys, recoverDek, rewrapVaultKeys } from "../src/cloud/keyflows";
import { decodeFk, decodeMeta, decodeObject, encodeItem, storagePath } from "../src/cloud/codec";
import type { CloudStore } from "../src/cloud/ports";
import type { RemoteItem, VaultKeysRow } from "../src/cloud/types";

const LIGHT = { m: 256, t: 2, p: 1 };

// Minimal in-memory CloudStore — the same seam the Supabase adapter implements.
function fakeStore() {
  const items = new Map<string, RemoteItem>();
  const objects = new Map<string, Uint8Array>();
  let keys: VaultKeysRow | null = null;
  let clock = 1;
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
      const updatedAt = `2026-01-01T00:00:${String(clock++).padStart(2, "0")}Z`;
      const prev = items.get(row.id);
      items.set(row.id, {
        ...row,
        createdAt: prev?.createdAt ?? row.createdAt ?? updatedAt,
        updatedAt,
        deletedAt: row.deletedAt ?? null,
      });
    },
    async markDeleted(id, deletedAtISO) {
      const r = items.get(id);
      if (r) items.set(id, { ...r, deletedAt: deletedAtISO, updatedAt: deletedAtISO });
    },
    async uploadObject(path, bytes) {
      objects.set(path, bytes);
    },
    async downloadObject(path) {
      const b = objects.get(path);
      if (!b) throw new Error("not found");
      return b;
    },
    async downloadRange(path, start, length) {
      const b = objects.get(path);
      if (!b) throw new Error("not found");
      return b.subarray(start, start + length);
    },
    async removeObject(path) {
      objects.delete(path);
    },
  };
  return { store, items, objects };
}

describe("cloud key bootstrap", () => {
  it("wraps a DEK under a passphrase and recovers it on another 'device'", () => {
    const dek = generateKey();
    const row = buildVaultKeys(dek, "a strong passphrase", LIGHT);
    expect([...recoverDek(row, "a strong passphrase")]).toEqual([...dek]);
  });

  it("rejects the wrong passphrase", () => {
    const row = buildVaultKeys(generateKey(), "right", LIGHT);
    expect(() => recoverDek(row, "wrong")).toThrow();
  });

  it("re-wraps under a new passphrase without changing the DEK", () => {
    const dek = generateKey();
    const row = buildVaultKeys(dek, "old", LIGHT);
    const rotated = rewrapVaultKeys(row, "old", "new", LIGHT);
    expect(() => recoverDek(rotated, "old")).toThrow();
    expect([...recoverDek(rotated, "new")]).toEqual([...dek]);
  });
});

describe("item codec over a fake CloudStore", () => {
  it("encrypts, uploads, lists, downloads and decrypts an item end-to-end", async () => {
    const { store } = fakeStore();
    const dek = generateKey();
    const userId = "user-123";
    const itemId = "item-abc";
    const plain = utf8ToBytes("a private clip ".repeat(100000)); // ~1.4 MiB -> multi-chunk

    const { object, row } = encodeItem(dek, userId, itemId, { name: "clip.mp4", mime: "video/mp4", kind: "media" }, plain);
    await store.uploadObject(row.storagePath, object, "application/octet-stream");
    await store.upsertItem({ ...row, createdAt: "x", updatedAt: "x", deletedAt: null });

    const rows = await store.listItemsSince(null);
    expect(rows).toHaveLength(1);
    const got = rows[0];

    const meta = decodeMeta(dek, got.encMeta);
    expect(meta.name).toBe("clip.mp4");
    expect(meta.mime).toBe("video/mp4");
    expect(meta.plainSize).toBe(plain.length);

    const fk = decodeFk(dek, got.wrappedFk);
    const downloaded = await store.downloadObject(got.storagePath);
    expect([...decodeObject(fk, downloaded)]).toEqual([...plain]);
  });

  it("hides the filename from the stored row (zero-knowledge)", () => {
    const dek = generateKey();
    const { row } = encodeItem(dek, "u", "i", { name: "SECRET-tax-return.pdf", mime: "application/pdf" }, utf8ToBytes("x"));
    const serialized = JSON.stringify(row);
    expect(serialized).not.toContain("SECRET");
    expect(serialized).not.toContain("tax-return");
  });

  it("storagePath is scoped under the user id (for RLS prefix checks)", () => {
    expect(storagePath("user-9", "item-1")).toBe("user-9/item-1.enc");
  });

  it("the incremental cursor only returns newer rows", async () => {
    const { store } = fakeStore();
    const dek = generateKey();
    const a = encodeItem(dek, "u", "a", { name: "a" }, utf8ToBytes("a"));
    await store.upsertItem({ ...a.row, createdAt: "x", updatedAt: "x", deletedAt: null });
    const first = await store.listItemsSince(null);
    const cursor = first[first.length - 1].updatedAt;

    const b = encodeItem(dek, "u", "b", { name: "b" }, utf8ToBytes("b"));
    await store.upsertItem({ ...b.row, createdAt: "x", updatedAt: "x", deletedAt: null });

    const delta = await store.listItemsSince(cursor);
    expect(delta).toHaveLength(1);
    expect(delta[0].id).toBe("b");
  });
});
