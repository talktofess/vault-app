import { beforeEach, describe, expect, it } from "vitest";
import { VaultService, __setClock } from "../src/vault/VaultService";
import { MemoryKeychain, MemoryStorage } from "../src/vault/memoryPorts";
import { utf8ToBytes, bytesToUtf8 } from "../src/crypto/b64";

let clock = 1000;
__setClock(() => ++clock);

function svc() {
  return new VaultService(new MemoryStorage(), new MemoryKeychain());
}

describe("VaultService lifecycle", () => {
  beforeEach(() => {
    clock = 1000;
  });

  it("creates, locks, and unlocks with the right password", async () => {
    const v = svc();
    expect(await v.exists()).toBe(false);
    await v.create("correct horse");
    expect(v.isUnlocked()).toBe(true);
    v.lock();
    expect(v.isUnlocked()).toBe(false);
    expect(await v.unlock("correct horse")).toBe(true);
    expect(v.isUnlocked()).toBe(true);
  });

  it("rejects the wrong password", async () => {
    const v = svc();
    await v.create("right");
    v.lock();
    expect(await v.unlock("wrong")).toBe(false);
    expect(v.isUnlocked()).toBe(false);
  });

  it("locked operations throw", async () => {
    const v = svc();
    await v.create("pw");
    v.lock();
    await expect(v.readItem("x")).rejects.toThrow(/locked/i);
    expect(() => v.listItems()).toThrow(/locked/i);
  });
});

describe("items", () => {
  it("adds, lists, reads, and deletes — content round-trips", async () => {
    const v = svc();
    await v.create("pw");
    const note = await v.addItem("note", "Diary", utf8ToBytes("dear vault"), {
      isJson: false,
    });
    const file = await v.addItem("file", "doc.bin", new Uint8Array([1, 2, 3, 4]));
    const list = v.listItems();
    expect(list.map((i) => i.name).sort()).toEqual(["Diary", "doc.bin"]);
    expect(bytesToUtf8(await v.readItem(note.id))).toBe("dear vault");
    expect(Array.from(await v.readItem(file.id))).toEqual([1, 2, 3, 4]);
    await v.deleteItem(note.id);
    expect(v.listItems().map((i) => i.name)).toEqual(["doc.bin"]);
  });

  it("persists across lock/unlock (data survives a 'restart')", async () => {
    const storage = new MemoryStorage();
    const keychain = new MemoryKeychain();
    const a = new VaultService(storage, keychain);
    await a.create("pw");
    await a.addItem("note", "kept", utf8ToBytes("still here"));

    // fresh service over the same storage = simulated app restart
    const b = new VaultService(storage, keychain);
    expect(await b.unlock("pw")).toBe(true);
    const item = b.listItems()[0];
    expect(bytesToUtf8(await b.readItem(item.id))).toBe("still here");
  });

  it("item names are not stored in plaintext on disk", async () => {
    const storage = new MemoryStorage();
    const v = new VaultService(storage, new MemoryKeychain());
    await v.create("pw");
    await v.addItem("note", "SECRETNAME", utf8ToBytes("body"));
    const onDisk = JSON.stringify(storage.manifest) + [...storage.blobs.values()].map(bytesToUtf8).join("");
    expect(onDisk).not.toContain("SECRETNAME");
  });
});

describe("change password", () => {
  it("re-wraps the DEK; new password works, old does not, items intact", async () => {
    const storage = new MemoryStorage();
    const keychain = new MemoryKeychain();
    const v = new VaultService(storage, keychain);
    await v.create("old-pw");
    const it = await v.addItem("note", "n", utf8ToBytes("payload"));
    await v.changePassword("old-pw", "new-pw");

    const fresh = new VaultService(storage, keychain);
    expect(await fresh.unlock("old-pw")).toBe(false);
    expect(await fresh.unlock("new-pw")).toBe(true);
    expect(bytesToUtf8(await fresh.readItem(it.id))).toBe("payload");
  });

  it("rejects a wrong current password", async () => {
    const v = svc();
    await v.create("real");
    await expect(v.changePassword("nope", "x")).rejects.toThrow(/incorrect/i);
  });
});

describe("biometric unlock", () => {
  it("unlocks via the keychain DEK without the password", async () => {
    const storage = new MemoryStorage();
    const keychain = new MemoryKeychain();
    const v = new VaultService(storage, keychain);
    await v.create("pw");
    await v.addItem("note", "n", utf8ToBytes("hi"));
    await v.enableBiometric();

    const fresh = new VaultService(storage, keychain);
    expect(await fresh.biometricAvailable()).toBe(true);
    expect(await fresh.unlockWithBiometric()).toBe(true);
    expect(fresh.listItems().length).toBe(1);
  });
});

describe("backup / restore", () => {
  it("exports and restores into a fresh device with a new password", async () => {
    const src = new VaultService(new MemoryStorage(), new MemoryKeychain());
    await src.create("device-pw");
    await src.addItem("note", "a", utf8ToBytes("alpha"));
    await src.addItem("file", "b.bin", new Uint8Array([9, 8, 7]));
    const archive = await src.exportVault("backup-pw");

    const dst = new VaultService(new MemoryStorage(), new MemoryKeychain());
    await dst.importVault(archive, "backup-pw", "new-device-pw");
    // unlock with the new device password
    dst.lock();
    expect(await dst.unlock("new-device-pw")).toBe(true);
    const names = dst.listItems().map((i) => i.name).sort();
    expect(names).toEqual(["a", "b.bin"]);
    const a = dst.listItems().find((i) => i.name === "a")!;
    expect(bytesToUtf8(await dst.readItem(a.id))).toBe("alpha");
  });

  it("rejects a wrong backup password", async () => {
    const src = svc();
    await src.create("pw");
    const archive = await src.exportVault("backup-pw");
    const dst = svc();
    await expect(dst.importVault(archive, "WRONG", "new")).rejects.toThrow(/incorrect/i);
  });

  it("refuses to import over an existing vault", async () => {
    const src = svc();
    await src.create("pw");
    const archive = await src.exportVault("b");
    const dst = svc();
    await dst.create("existing");
    await expect(dst.importVault(archive, "b", "n")).rejects.toThrow(/already exists/i);
  });
});
