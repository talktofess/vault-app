import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { VaultService } from "../src/vault/VaultService";
import { MemoryKeychain } from "../src/vault/memoryPorts";
import { ExpoStorage } from "../src/platform/expoStorage.web";
import { bytesToUtf8, utf8ToBytes } from "../src/crypto/b64";

// Verifies the web IndexedDB Storage durably persists across "reloads"
// (fresh VaultService instances over the same browser DB) — the bug where an
// imported item vanished after a page refresh.
describe("web IndexedDB storage", () => {
  it("a created vault + items survive a simulated reload", async () => {
    const keychain = new MemoryKeychain();

    // session 1: create, import, lock (simulating leaving the page)
    const a = new VaultService(new ExpoStorage(), keychain);
    await a.create("1234");
    await a.addItem("media", "photo.jpg", utf8ToBytes("pixels"), { mime: "image/jpeg" });
    await a.addItem("file", "notes.txt", utf8ToBytes("hello"));
    a.lock();

    // session 2: brand-new instances over the SAME IndexedDB = a page refresh
    const b = new VaultService(new ExpoStorage(), keychain);
    expect(await b.exists()).toBe(true);
    expect(await b.unlock("1234")).toBe(true);
    const items = b.listItems();
    expect(items.map((i) => i.name).sort()).toEqual(["notes.txt", "photo.jpg"]);
    expect(bytesToUtf8(await b.readItem(items.find((i) => i.name === "notes.txt")!.id))).toBe("hello");
  });

  it("blobs round-trip through the raw storage port", async () => {
    const s = new ExpoStorage();
    await s.writeBlob("k", new Uint8Array([9, 8, 7]));
    const again = new ExpoStorage();
    expect(Array.from((await again.readBlob("k"))!)).toEqual([9, 8, 7]);
  });
});
