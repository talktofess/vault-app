import { gcm } from "@noble/ciphers/aes";
import { fromB64, toB64 } from "./b64";
import { randomBytes } from "./random";

// Authenticated encryption: AES-256-GCM with a fresh random 12-byte nonce per
// message. GCM's auth tag means any tampering with the ciphertext is detected
// on open() (it throws), so we get confidentiality AND integrity.

export interface Sealed {
  n: string; // nonce, base64
  c: string; // ciphertext (incl. GCM tag), base64
}

const NONCE_LEN = 12;

export function seal(key: Uint8Array, plaintext: Uint8Array): Sealed {
  const nonce = randomBytes(NONCE_LEN);
  const ct = gcm(key, nonce).encrypt(plaintext);
  return { n: toB64(nonce), c: toB64(ct) };
}

// Throws if the key is wrong or the ciphertext was tampered with.
export function open(key: Uint8Array, sealed: Sealed): Uint8Array {
  const nonce = fromB64(sealed.n);
  const ct = fromB64(sealed.c);
  return gcm(key, nonce).decrypt(ct);
}

// Convenience: does this key correctly open this blob? (no throw)
export function canOpen(key: Uint8Array, sealed: Sealed): boolean {
  try {
    open(key, sealed);
    return true;
  } catch {
    return false;
  }
}
