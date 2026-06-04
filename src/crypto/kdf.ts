import { pbkdf2 } from "@noble/hashes/pbkdf2";
import { sha256 } from "@noble/hashes/sha256";
import { utf8ToBytes } from "./b64";

// Password-based key derivation. PBKDF2-HMAC-SHA256 with a high iteration count
// and a random per-vault salt makes brute-forcing the master password slow.
// (scrypt is stronger against GPUs; PBKDF2 is chosen for broad, reliable
// support on-device. Iteration count is tunable below.)
export const KDF_ITERATIONS = 150_000;
// A chess-move unlock secret has much more entropy than a 4-digit PIN, so it can
// use a lower iteration count and still resist brute force — which makes the
// (pure-JS, on-device) unlock noticeably faster.
export const CHESS_KDF_ITERATIONS = 50_000;
export const KEY_LEN = 32; // 256-bit key
export const SALT_LEN = 16;

export function deriveKey(
  password: string,
  salt: Uint8Array,
  iterations: number = KDF_ITERATIONS
): Uint8Array {
  return pbkdf2(sha256, utf8ToBytes(password), salt, {
    c: iterations,
    dkLen: KEY_LEN,
  });
}
