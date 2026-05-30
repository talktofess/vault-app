// Expo-backed Keychain: the OS hardware-backed secure store (Keychain on iOS,
// Keystore on Android). We gate reads behind a biometric/passcode prompt so the
// stored DEK is only released after the user authenticates.
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import type { Keychain } from "../vault/ports";

export class ExpoKeychain implements Keychain {
  async setItem(key: string, value: string): Promise<void> {
    await SecureStore.setItemAsync(key, value, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  }

  async getItem(key: string): Promise<string | null> {
    return SecureStore.getItemAsync(key);
  }

  async deleteItem(key: string): Promise<void> {
    await SecureStore.deleteItemAsync(key);
  }
}

export async function biometricHardwareAvailable(): Promise<boolean> {
  const has = await LocalAuthentication.hasHardwareAsync();
  const enrolled = await LocalAuthentication.isEnrolledAsync();
  return has && enrolled;
}

/** Prompt the OS biometric/passcode gate. Returns true only on success. */
export async function promptBiometric(reason = "Unlock your vault"): Promise<boolean> {
  const res = await LocalAuthentication.authenticateAsync({
    promptMessage: reason,
    fallbackLabel: "Use passcode",
  });
  return res.success;
}
