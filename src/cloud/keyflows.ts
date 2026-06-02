// Cloud key bootstrapping: turn the account passphrase into the wrapped-DEK
// row (and back). Pure functions over the crypto primitives — no I/O — so they
// unit-test directly.
import { ARGON2_DEFAULTS, type Argon2Params, deriveCloudKey } from "../crypto/argon2";
import { bytesToUtf8, fromB64, toB64, utf8ToBytes } from "../crypto/b64";
import { packSealed, unpackSealed, unwrapKey, wrapKey } from "../crypto/keys";
import { randomBytes } from "../crypto/random";
import type { VaultKeysRow } from "./types";

const SALT_LEN = 16;

/** Wrap an existing DEK (and optionally the shared PIN) under a passphrase-KEK. */
export function buildVaultKeys(
  dek: Uint8Array,
  passphrase: string,
  params: Argon2Params = ARGON2_DEFAULTS,
  pin?: string | null
): VaultKeysRow {
  const salt = randomBytes(SALT_LEN);
  const kek = deriveCloudKey(passphrase, salt, params);
  return {
    kdf: { alg: "argon2id", m: params.m, t: params.t, p: params.p, salt: toB64(salt) },
    wrappedDek: packSealed(wrapKey(kek, dek)),
    dekVersion: 1,
    wrappedPin: pin ? packSealed(wrapKey(kek, utf8ToBytes(pin))) : null,
  };
}

function kekFor(row: VaultKeysRow, passphrase: string): Uint8Array {
  return deriveCloudKey(passphrase, fromB64(row.kdf.salt), { m: row.kdf.m, t: row.kdf.t, p: row.kdf.p });
}

/** Recover the DEK from a vault_keys row using the passphrase. Throws if wrong. */
export function recoverDek(row: VaultKeysRow, passphrase: string): Uint8Array {
  return unwrapKey(kekFor(row, passphrase), unpackSealed(row.wrappedDek));
}

/** Recover the shared PIN, or null if this vault doesn't have one stored. */
export function recoverPin(row: VaultKeysRow, passphrase: string): string | null {
  if (!row.wrappedPin) return null;
  try {
    return bytesToUtf8(unwrapKey(kekFor(row, passphrase), unpackSealed(row.wrappedPin)));
  } catch {
    return null;
  }
}

/** Re-wrap the same DEK under a new passphrase (cheap: no blob re-encryption). */
export function rewrapVaultKeys(
  row: VaultKeysRow,
  oldPassphrase: string,
  newPassphrase: string,
  params: Argon2Params = ARGON2_DEFAULTS
): VaultKeysRow {
  const dek = recoverDek(row, oldPassphrase);
  const next = buildVaultKeys(dek, newPassphrase, params);
  return { ...next, dekVersion: row.dekVersion };
}
