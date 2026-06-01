// Web Keychain adapter. A browser has no hardware-backed secure store or
// biometric gate we can safely hold the DEK behind, so biometric unlock is
// simply unavailable on web: getItem always returns null (→ biometricAvailable
// is false), and the biometric helpers report "no hardware". The PIN remains
// the sole unlock path on web. Mirrors expoKeychain.ts's exports so imports
// resolve to this file on web.
import type { Keychain } from "../vault/ports";

export class ExpoKeychain implements Keychain {
  async setItem(_key: string, _value: string): Promise<void> {
    /* no-op: we intentionally never persist the DEK in the browser */
  }

  async getItem(_key: string): Promise<string | null> {
    return null;
  }

  async deleteItem(_key: string): Promise<void> {
    /* no-op */
  }
}

export async function biometricHardwareAvailable(): Promise<boolean> {
  return false;
}

export async function promptBiometric(_reason?: string): Promise<boolean> {
  return false;
}
