import { randomBytes as nobleRandomBytes } from "@noble/hashes/utils";

// Cryptographically-secure random bytes. @noble uses the platform CSPRNG
// (crypto.getRandomValues). In the Expo app, importing
// "react-native-get-random-values" at the entry point polyfills this on RN.
export function randomBytes(n: number): Uint8Array {
  return nobleRandomBytes(n);
}
