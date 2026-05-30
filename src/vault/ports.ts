// The two seams the vault depends on. The app provides Expo-backed
// implementations; tests provide in-memory ones. VaultService never imports
// Expo directly — so the entire security core is testable on desktop.

export interface Storage {
  readManifest(): Promise<string | null>;
  writeManifest(json: string): Promise<void>;
  readBlob(id: string): Promise<Uint8Array | null>;
  writeBlob(id: string, data: Uint8Array): Promise<void>;
  deleteBlob(id: string): Promise<void>;
  clearAll(): Promise<void>;
}

// Hardware-backed secret storage (OS keychain / keystore). Used to hold the
// biometric-unlock secret so day-to-day unlock doesn't need the password.
export interface Keychain {
  setItem(key: string, value: string): Promise<void>;
  getItem(key: string): Promise<string | null>;
  deleteItem(key: string): Promise<void>;
}
