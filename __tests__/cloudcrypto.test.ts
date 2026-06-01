import { describe, expect, it } from "vitest";
import { deriveCloudKey } from "../src/crypto/argon2";
import { generateKey, packSealed, unpackSealed, unwrapKey, wrapKey } from "../src/crypto/keys";
import {
  CHUNK,
  TAG,
  HEADER,
  chunkCount,
  chunkRange,
  decryptFile,
  encryptFile,
  openChunk,
  sealChunk,
} from "../src/crypto/chunkCipher";
import { utf8ToBytes } from "../src/crypto/b64";

// Light Argon2 params so tests stay fast (production uses ARGON2_DEFAULTS).
const LIGHT = { m: 256, t: 2, p: 1 };

function patterned(n: number): Uint8Array {
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) b[i] = (i * 31 + 7) & 0xff;
  return b;
}

describe("Argon2id cloud KDF", () => {
  it("is deterministic for the same passphrase + salt + params", () => {
    const salt = new Uint8Array(16).fill(9);
    const a = deriveCloudKey("correct horse battery staple", salt, LIGHT);
    const b = deriveCloudKey("correct horse battery staple", salt, LIGHT);
    expect(a.length).toBe(32);
    expect([...a]).toEqual([...b]);
  });

  it("changes with the salt and with the passphrase", () => {
    const s1 = new Uint8Array(16).fill(1);
    const s2 = new Uint8Array(16).fill(2);
    const base = deriveCloudKey("pw", s1, LIGHT);
    expect([...deriveCloudKey("pw", s2, LIGHT)]).not.toEqual([...base]);
    expect([...deriveCloudKey("pw2", s1, LIGHT)]).not.toEqual([...base]);
  });
});

describe("key wrap / unwrap", () => {
  it("round-trips a DEK under a KEK", () => {
    const kek = generateKey();
    const dek = generateKey();
    const wrapped = wrapKey(kek, dek);
    expect([...unwrapKey(kek, wrapped)]).toEqual([...dek]);
  });

  it("fails to unwrap with the wrong KEK", () => {
    const dek = generateKey();
    const wrapped = wrapKey(generateKey(), dek);
    expect(() => unwrapKey(generateKey(), wrapped)).toThrow();
  });

  it("packSealed / unpackSealed survive a round-trip", () => {
    const kek = generateKey();
    const fk = generateKey();
    const packed = packSealed(wrapKey(kek, fk));
    expect(typeof packed).toBe("string");
    expect([...unwrapKey(kek, unpackSealed(packed))]).toEqual([...fk]);
  });
});

describe("chunk cipher", () => {
  it("seals and opens a single chunk", () => {
    const fk = generateKey();
    const plain = patterned(1234);
    expect([...openChunk(fk, 0, sealChunk(fk, 0, plain))]).toEqual([...plain]);
  });

  it("rejects a chunk opened at the wrong index (AAD mismatch)", () => {
    const fk = generateKey();
    const ct = sealChunk(fk, 3, patterned(64));
    expect(() => openChunk(fk, 4, ct)).toThrow();
  });

  it("detects a tampered byte", () => {
    const fk = generateKey();
    const ct = sealChunk(fk, 0, patterned(64));
    ct[0] ^= 0x01;
    expect(() => openChunk(fk, 0, ct)).toThrow();
  });
});

describe("whole-file encryption", () => {
  it("round-trips sizes below, at, and above the chunk boundary", () => {
    const fk = generateKey();
    for (const size of [0, 1, 100, CHUNK - 1, CHUNK, CHUNK + 1, CHUNK * 2 + 555]) {
      const plain = patterned(size);
      const obj = encryptFile(fk, plain);
      expect([...decryptFile(fk, obj)]).toEqual([...plain]);
    }
  });

  it("lays chunks at the ranges chunkRange() predicts", () => {
    const fk = generateKey();
    const size = CHUNK * 2 + 10;
    const obj = encryptFile(fk, patterned(size));
    expect(chunkCount(size)).toBe(3);
    // chunk 1 occupies a full CHUNK+TAG slot at its predicted offset
    const r1 = chunkRange(1);
    expect(r1.start).toBe(HEADER + (CHUNK + TAG));
    expect(r1.length).toBe(CHUNK + TAG);
    expect(obj.length).toBe(HEADER + 2 * (CHUNK + TAG) + (10 + TAG));
  });

  it("fails to decrypt with the wrong file key", () => {
    const obj = encryptFile(generateKey(), patterned(2048));
    expect(() => decryptFile(generateKey(), obj)).toThrow();
  });

  it("rejects a swapped (reordered) chunk", () => {
    const fk = generateKey();
    const obj = encryptFile(fk, patterned(CHUNK * 2)); // exactly 2 full chunks
    const c0Start = HEADER;
    const c1Start = HEADER + (CHUNK + TAG);
    const c0 = obj.slice(c0Start, c1Start);
    const c1 = obj.slice(c1Start, c1Start + (CHUNK + TAG));
    obj.set(c1, c0Start); // put chunk 1's bytes where chunk 0 belongs
    obj.set(c0, c1Start);
    expect(() => decryptFile(fk, obj)).toThrow(); // index-as-AAD catches it
  });

  it("rejects a corrupted header", () => {
    const fk = generateKey();
    const obj = encryptFile(fk, patterned(128));
    obj[0] ^= 0xff; // break the magic
    expect(() => decryptFile(fk, obj)).toThrow();
  });
});

describe("full envelope integration", () => {
  it("passphrase -> KEK -> DEK -> FK -> file, end to end", () => {
    const salt = new Uint8Array(16).fill(5);
    const kek = deriveCloudKey("a strong passphrase here", salt, LIGHT);
    const dek = generateKey();
    const wrappedDek = packSealed(wrapKey(kek, dek));

    // later / another device: re-derive KEK, unwrap DEK
    const kek2 = deriveCloudKey("a strong passphrase here", salt, LIGHT);
    const dek2 = unwrapKey(kek2, unpackSealed(wrappedDek));
    expect([...dek2]).toEqual([...dek]);

    // per-file key wrapped under DEK; file encrypted under FK
    const fk = generateKey();
    const wrappedFk = packSealed(wrapKey(dek2, fk));
    const plain = utf8ToBytes("the secret video bytes".repeat(5000));
    const obj = encryptFile(unwrapKey(dek2, unpackSealed(wrappedFk)), plain);
    expect([...decryptFile(fk, obj)]).toEqual([...plain]);
  });
});
