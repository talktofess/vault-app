import { describe, expect, it, vi } from "vitest";
import { generateKey } from "../src/crypto/keys";
import { CHUNK } from "../src/crypto/chunkCipher";
import { decodeFk, encodeItem } from "../src/cloud/codec";
import { StreamReader } from "../src/cloud/stream";
import type { CloudStore } from "../src/cloud/ports";

function patterned(n: number): Uint8Array {
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) b[i] = (i * 7 + 3) & 0xff;
  return b;
}

// A store that ONLY supports range reads — proves the reader never needs the
// whole object (the point of streaming).
function rangeOnlyStore(path: string, object: Uint8Array): CloudStore {
  return {
    async getVaultKeys() {
      return null;
    },
    async putVaultKeys() {},
    async listItemsSince() {
      return [];
    },
    async upsertItem() {},
    async markDeleted() {},
    async uploadObject() {},
    async downloadObject() {
      throw new Error("downloadObject must not be called by the streamer");
    },
    async downloadRange(p, start, length) {
      if (p !== path) throw new Error("bad path");
      return object.subarray(start, start + length);
    },
    async removeObject() {},
  };
}

function readerFor(plain: Uint8Array) {
  const dek = generateKey();
  const { object, row } = encodeItem(dek, "u", "i", { name: "v.mp4", mime: "video/mp4" }, plain);
  const fk = decodeFk(dek, row.wrappedFk); // unwrap the FK the same way VaultService would
  const store = rangeOnlyStore(row.storagePath, object);
  const reader = new StreamReader({ store, path: row.storagePath, fk, chunkSize: CHUNK, byteSize: object.length });
  return { reader, store, plain };
}

describe("StreamReader", () => {
  it("reconstructs the file using only range requests", async () => {
    const plain = patterned(CHUNK * 2 + 1234); // 3 chunks (last partial)
    const { reader, store } = readerFor(plain);
    const spy = vi.spyOn(store, "downloadRange");
    expect(reader.chunkCount).toBe(3);
    expect([...(await reader.readAll())]).toEqual([...plain]);
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it("seeks: chunk(k) returns exactly that slice of plaintext", async () => {
    const plain = patterned(CHUNK * 2 + 500);
    const { reader } = readerFor(plain);
    const c1 = await reader.chunk(1);
    expect([...c1]).toEqual([...plain.subarray(CHUNK, CHUNK * 2)]);
    const last = await reader.chunk(2);
    expect([...last]).toEqual([...plain.subarray(CHUNK * 2)]);
  });

  it("rejects out-of-range chunk indices", async () => {
    const { reader } = readerFor(patterned(10));
    expect(reader.chunkCount).toBe(1);
    await expect(reader.chunk(1)).rejects.toThrow(/out of range/);
  });

  it("detects a tampered chunk on the wire", async () => {
    const plain = patterned(2048);
    const dek = generateKey();
    const { object, row } = encodeItem(dek, "u", "i", { name: "x" }, plain);
    const fk = decodeFk(dek, row.wrappedFk);
    object[20] ^= 0xff; // corrupt a ciphertext byte inside chunk 0
    const store = rangeOnlyStore(row.storagePath, object);
    const reader = new StreamReader({ store, path: row.storagePath, fk, chunkSize: CHUNK, byteSize: object.length });
    await expect(reader.chunk(0)).rejects.toThrow();
  });

  it("handles an empty object (0 chunks)", async () => {
    const { reader } = readerFor(new Uint8Array(0));
    expect(reader.chunkCount).toBe(0);
    expect((await reader.readAll()).length).toBe(0);
  });
});
