import { argon2id } from "@noble/hashes/argon2";
import { utf8ToBytes } from "./b64";

// Cloud-root key derivation. Unlike the local 4-digit PIN (which only ever
// guards a device-bound, rate-limited DEK copy), the account passphrase is the
// ONLY thing between an attacker holding the cloud ciphertext and the vault —
// so it uses memory-hard Argon2id, not PBKDF2. Params are stored per-vault in
// vault_keys.kdf so they can be tuned per device class without breaking old
// wraps.

export interface Argon2Params {
  m: number; // memory cost, KiB
  t: number; // time cost, iterations
  p: number; // parallelism
}

// 64 MiB / 3 passes / 1 lane — RFC 9106-ish, comfortable on a mid phone.
export const ARGON2_DEFAULTS: Argon2Params = { m: 65536, t: 3, p: 1 };
export const CLOUD_KEY_LEN = 32; // 256-bit KEK

export function deriveCloudKey(
  passphrase: string,
  salt: Uint8Array,
  params: Argon2Params = ARGON2_DEFAULTS
): Uint8Array {
  return argon2id(utf8ToBytes(passphrase), salt, {
    t: params.t,
    m: params.m,
    p: params.p,
    dkLen: CLOUD_KEY_LEN,
  });
}
