// Envelope-key helpers for the cloud layer: generate random keys, wrap/unwrap
// them under a key-encryption key, and (de)serialize a Sealed blob to the
// compact wire format the Supabase schema stores (`b64( nonce | ct | tag )`).
// Wrapping is just GCM over the raw key bytes, so it reuses seal/open.
import { open, seal, type Sealed } from "./cipher";
import { fromB64, toB64 } from "./b64";
import { randomBytes } from "./random";

export const DEK_LEN = 32; // data encryption key
export const FK_LEN = 32; // per-file key
const NONCE_LEN = 12; // must match cipher.ts

/** A fresh random symmetric key (DEK or FK). */
export function generateKey(len: number = 32): Uint8Array {
  return randomBytes(len);
}

/** Encrypt raw key bytes under a KEK. */
export function wrapKey(kek: Uint8Array, key: Uint8Array): Sealed {
  return seal(kek, key);
}

/** Decrypt a wrapped key. Throws if the KEK is wrong or the blob was tampered. */
export function unwrapKey(kek: Uint8Array, wrapped: Sealed): Uint8Array {
  return open(kek, wrapped);
}

/** Sealed -> single base64 string: nonce(12) ‖ ciphertext(+tag). */
export function packSealed(s: Sealed): string {
  const n = fromB64(s.n);
  const c = fromB64(s.c);
  const out = new Uint8Array(n.length + c.length);
  out.set(n, 0);
  out.set(c, n.length);
  return toB64(out);
}

/** Inverse of packSealed. */
export function unpackSealed(packed: string): Sealed {
  const raw = fromB64(packed);
  return {
    n: toB64(raw.subarray(0, NONCE_LEN)),
    c: toB64(raw.subarray(NONCE_LEN)),
  };
}
