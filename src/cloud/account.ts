// "Safe words only" cloud identity. The user never sees email/verification —
// a hidden Supabase account is derived deterministically from the safe words,
// so entering the same safe words on any device signs into the same account.
//
// The safe words protect BOTH the account (here) and the encryption DEK
// (keyflows.ts), via DIFFERENT domain-separated derivations. The value Supabase
// stores is Argon2id(safe words) — memory-hard, so a leaked auth hash is no
// easier to crack than the vault ciphertext itself. The safe words must be
// strong; there is no email reset (that's the point).
import { argon2id } from "@noble/hashes/argon2";
import { sha256 } from "@noble/hashes/sha256";
import { utf8ToBytes } from "../crypto/b64";
import type { CloudAuth } from "./ports";

const ACCOUNT_DOMAIN = "vaultsync.app"; // synthetic; never receives mail (confirmations off)
const AUTH_SALT = utf8ToBytes("vault-cloud-auth-v1"); // fixed (determinism); public

function bytesToHex(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s;
}

export interface DerivedAccount {
  email: string;
  password: string;
}

/** Deterministic Supabase credentials from the safe words. */
export function deriveAccount(safeWords: string): DerivedAccount {
  const norm = safeWords.normalize("NFKC").trim();
  const id = bytesToHex(sha256(utf8ToBytes("vault-account-id|" + norm))).slice(0, 32);
  const pw = bytesToHex(
    argon2id(utf8ToBytes("vault-auth-pw|" + norm), AUTH_SALT, { m: 32768, t: 2, p: 1, dkLen: 32 })
  );
  return { email: `${id}@${ACCOUNT_DOMAIN}`, password: pw };
}

/**
 * Sign in with the safe-words-derived account, creating it on first use.
 * Requires email confirmations to be OFF on the project (synthetic addresses
 * can't be confirmed); a "Email not confirmed" error means that toggle is on.
 */
export async function ensureSignedIn(auth: CloudAuth, safeWords: string): Promise<void> {
  const { email, password } = deriveAccount(safeWords);
  try {
    await auth.signIn(email, password);
    return;
  } catch (signInErr) {
    try {
      await auth.signUp(email, password); // first device for these safe words
    } catch {
      throw signInErr; // both failed — surface the sign-in error
    }
    await auth.signIn(email, password);
  }
}
