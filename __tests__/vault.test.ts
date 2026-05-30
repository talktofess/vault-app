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

describe("duress / decoy password", () => {
  it("opens a separate empty decoy vault and hides the real items", async () => {
    const storage = new MemoryStorage();
    const keychain = new MemoryKeychain();
    const real = new VaultService(storage, keychain);
    await real.create("real-pw");
    await real.addItem("note", "TOP SECRET", utf8ToBytes("the real stuff"));
    await real.setDuressPassword("decoy-pw");

    const sneaky = new VaultService(storage, keychain);
    expect(await sneaky.unlock("decoy-pw")).toBe(true);
    expect(sneaky.isDecoy()).toBe(true);
    expect(sneaky.listItems()).toEqual([]);

    const owner = new VaultService(storage, keychain);
    expect(await owner.unlock("real-pw")).toBe(true);
    expect(owner.isDecoy()).toBe(false);
    expect(owner.listItems().map((i) => i.name)).toEqual(["TOP SECRET"]);
  });

  it("decoy edits don't touch the real vault", async () => {
    const storage = new MemoryStorage();
    const keychain = new MemoryKeychain();
    const real = new VaultService(storage, keychain);
    await real.create("real-pw");
    await real.addItem("note", "real-note", utf8ToBytes("x"));
    await real.setDuressPassword("decoy-pw");

    const decoy = new VaultService(storage, keychain);
    await decoy.unlock("decoy-pw");
    await decoy.addItem("note", "decoy-note", utf8ToBytes("planted"));

    const owner = new VaultService(storage, keychain);
    await owner.unlock("real-pw");
    expect(owner.listItems().map((i) => i.name)).toEqual(["real-note"]);
  });

  it("refuses a duress password equal to the real one", async () => {
    const v = svc();
    await v.create("same");
    await expect(v.setDuressPassword("same")).rejects.toThrow(/differ/i);
  });

  it("wrong password fails even with duress configured", async () => {
    const v = svc();
    await v.create("real-pw");
    await v.setDuressPassword("decoy-pw");
    v.lock();
    expect(await v.unlock("neither")).toBe(false);
  });
});

describe("albums & search", () => {
  it("assigns albums, lists distinct albums, and searches by name", async () => {
    const v = svc();
    await v.create("pw");
    await v.addItem("media", "beach.jpg", utf8ToBytes("a"), { album: "Trips" });
    await v.addItem("media", "mountain.jpg", utf8ToBytes("b"), { album: "Trips" });
    await v.addItem("note", "recipe", utf8ToBytes("c"), { album: "Food" });

    expect(v.albums()).toEqual(["Food", "Trips"]);
    expect(v.search("beach").map((i) => i.name)).toEqual(["beach.jpg"]);
    expect(v.search("").length).toBe(3);
    expect(v.search("ZZZ")).toEqual([]);
  });

  it("renames and re-albums an item", async () => {
    const v = svc();
    await v.create("pw");
    const it = await v.addItem("file", "old.bin", utf8ToBytes("x"));
    await v.updateItemMeta(it.id, { name: "new.bin", album: "Docs" });
    const got = v.listItems()[0];
    expect(got.name).toBe("new.bin");
    expect(got.album).toBe("Docs");
    await v.updateItemMeta(it.id, { album: "" });
    expect(v.listItems()[0].album).toBeUndefined();
  });
});

describe("credential manager", () => {
  it("adds, reads, updates, and lists credentials", async () => {
    const v = svc();
    await v.create("pw");
    const c = await v.addCredential({
      title: "Email",
      username: "me@x.com",
      password: "s3cr3t",
      url: "mail.x.com",
    });
    const read = await v.readCredential(c.id);
    expect(read.username).toBe("me@x.com");
    expect(read.password).toBe("s3cr3t");

    await v.updateCredential(c.id, { ...read, password: "rotated", title: "Email (work)" });
    const again = await v.readCredential(c.id);
    expect(again.password).toBe("rotated");
    expect(v.listCredentials()[0].name).toBe("Email (work)");
  });

  it("credentials don't appear in the media/file lists", async () => {
    const v = svc();
    await v.create("pw");
    await v.addCredential({ title: "c", username: "u", password: "p" });
    await v.addItem("media", "m.jpg", utf8ToBytes("x"));
    expect(v.listCredentials().length).toBe(1);
    expect(v.listItems().filter((i) => i.type === "media").length).toBe(1);
  });
});

describe("intrusion log & lockout", () => {
  it("records failed attempts and surfaces them after a successful unlock", async () => {
    const storage = new MemoryStorage();
    const keychain = new MemoryKeychain();
    const a = new VaultService(storage, keychain);
    await a.create("right-pw");
    a.lock();

    const b = new VaultService(storage, keychain);
    expect(await b.unlock("wrong1")).toBe(false);
    expect(await b.unlock("wrong2")).toBe(false);
    expect(await b.unlock("right-pw")).toBe(true);
    expect(b.getIntrusions().length).toBe(2);

    const c = new VaultService(storage, keychain);
    expect(await c.unlock("right-pw")).toBe(true);
    expect(c.getIntrusions().length).toBe(0);
  });

  it("imposes a lockout delay after 5 consecutive failures", async () => {
    const v = svc();
    await v.create("pw");
    v.lock();
    expect(await v.lockoutRemainingMs()).toBe(0);
    for (let i = 0; i < 5; i++) await v.unlock("nope");
    expect(await v.lockoutRemainingMs()).toBeGreaterThan(0);
  });

  it("a successful unlock resets the lockout", async () => {
    const v = svc();
    await v.create("pw");
    v.lock();
    for (let i = 0; i < 6; i++) await v.unlock("nope");
    expect(await v.lockoutRemainingMs()).toBeGreaterThan(0);
    await v.unlock("pw");
    v.lock();
    expect(await v.lockoutRemainingMs()).toBe(0);
  });
});
