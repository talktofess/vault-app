// Cloud key bootstrapping: turn the account passphrase into the wrapped-DEK
// row (and back). Pure functions over the crypto primitives — no I/O — so they
// unit-test directly.
import { ARGON2_DEFAULTS, type Argon2Params, deriveCloudKey } from "../crypto/argon2";
import { fromB64, toB64 } from "../crypto/b64";
import { packSealed, unpackSealed, unwrapKey, wrapKey } from "../crypto/keys";
import { randomBytes } from "../crypto/random";
import type { VaultKeysRow } from "./types";

const SALT_LEN = 16;

/** Wrap an existing DEK under a passphrase-derived KEK -> vault_keys row. */
export function buildVaultKeys(
  dek: Uint8Array,
  passphrase: string,
  params: Argon2Params = ARGON2_DEFAULTS
): VaultKeysRow {
  const salt = randomBytes(SALT_LEN);
  const kek = deriveCloudKey(passphrase, salt, params);
  return {
    kdf: { alg: "argon2id", m: params.m, t: params.t, p: params.p, salt: toB64(salt) },
    wrappedDek: packSealed(wrapKey(kek, dek)),
    dekVersion: 1,
  };
}

/** Recover the DEK from a vault_keys row using the passphrase. Throws if wrong. */
export function recoverDek(row: VaultKeysRow, passphrase: string): Uint8Array {
  const kek = deriveCloudKey(passphrase, fromB64(row.kdf.salt), {
    m: row.kdf.m,
    t: row.kdf.t,
    p: row.kdf.p,
  });
  return unwrapKey(kek, unpackSealed(row.wrappedDek));
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
