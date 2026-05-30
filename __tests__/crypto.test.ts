import { describe, expect, it } from "vitest";
import { seal, open, canOpen } from "../src/crypto/cipher";
import { deriveKey } from "../src/crypto/kdf";
import { randomBytes } from "../src/crypto/random";
import { fromB64, toB64, utf8ToBytes, bytesToUtf8 } from "../src/crypto/b64";

describe("base64", () => {
  it("round-trips arbitrary bytes including edge lengths", () => {
    for (const len of [0, 1, 2, 3, 4, 5, 16, 100, 255]) {
      const b = randomBytes(len);
      expect(Array.from(fromB64(toB64(b)))).toEqual(Array.from(b));
    }
  });
  it("round-trips utf8 incl. non-ascii", () => {
    const s = "héllo 🌍 {\"k\":1}";
    expect(bytesToUtf8(utf8ToBytes(s))).toBe(s);
  });
});

describe("AES-256-GCM seal/open", () => {
  it("decrypts with the correct key", () => {
    const key = randomBytes(32);
    const msg = utf8ToBytes("top secret");
    expect(bytesToUtf8(open(key, seal(key, msg)))).toBe("top secret");
  });

  it("fails with the wrong key", () => {
    const sealed = seal(randomBytes(32), utf8ToBytes("x"));
    expect(canOpen(randomBytes(32), sealed)).toBe(false);
  });

  it("detects tampering (auth tag)", () => {
    const key = randomBytes(32);
    const sealed = seal(key, utf8ToBytes("x"));
    const ct = fromB64(sealed.c);
    ct[0] ^= 1; // flip a bit
    expect(canOpen(key, { ...sealed, c: toB64(ct) })).toBe(false);
  });

  it("uses a unique nonce per call", () => {
    const key = randomBytes(32);
    const a = seal(key, utf8ToBytes("same"));
    const b = seal(key, utf8ToBytes("same"));
    expect(a.n).not.toBe(b.n);
    expect(a.c).not.toBe(b.c);
  });
});

describe("KDF", () => {
  it("is deterministic for the same password+salt", () => {
    const salt = randomBytes(16);
    expect(toB64(deriveKey("pw", salt, 1000))).toBe(toB64(deriveKey("pw", salt, 1000)));
  });
  it("differs for different passwords and different salts", () => {
    const salt = randomBytes(16);
    expect(toB64(deriveKey("pw", salt, 1000))).not.toBe(toB64(deriveKey("pw2", salt, 1000)));
    expect(toB64(deriveKey("pw", randomBytes(16), 1000))).not.toBe(
      toB64(deriveKey("pw", randomBytes(16), 1000))
    );
  });
});
