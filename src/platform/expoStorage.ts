// Expo-backed Storage: encrypted blobs live as files in the app's private
// sandbox (FileSystem.documentDirectory), which the OS isolates from other
// apps. Only imported by the running app, never by tests.
import * as FileSystem from "expo-file-system";
import { fromB64, toB64 } from "../crypto/b64";
import type { Storage } from "../vault/ports";

const ROOT = FileSystem.documentDirectory + "vault/";
const MANIFEST = ROOT + "manifest.json";
const BLOBS = ROOT + "blobs/";

async function ensureDirs(): Promise<void> {
  await FileSystem.makeDirectoryAsync(BLOBS, { intermediates: true }).catch(() => {});
}

export class ExpoStorage implements Storage {
  async readManifest(): Promise<string | null> {
    try {
      const info = await FileSystem.getInfoAsync(MANIFEST);
      if (!info.exists) return null;
      return await FileSystem.readAsStringAsync(MANIFEST);
    } catch {
      return null;
    }
  }

  async writeManifest(json: string): Promise<void> {
    await ensureDirs();
    await FileSystem.writeAsStringAsync(MANIFEST, json);
  }

  async readBlob(id: string): Promise<Uint8Array | null> {
    try {
      const info = await FileSystem.getInfoAsync(BLOBS + id);
      if (!info.exists) return null;
      const b64 = await FileSystem.readAsStringAsync(BLOBS + id, {
        encoding: FileSystem.EncodingType.Base64,
      });
      return fromB64(b64);
    } catch {
      return null;
    }
  }

  async writeBlob(id: string, data: Uint8Array): Promise<void> {
    await ensureDirs();
    await FileSystem.writeAsStringAsync(BLOBS + id, toB64(data), {
      encoding: FileSystem.EncodingType.Base64,
    });
  }

  async deleteBlob(id: string): Promise<void> {
    await FileSystem.deleteAsync(BLOBS + id, { idempotent: true });
  }

  async clearAll(): Promise<void> {
    await FileSystem.deleteAsync(ROOT, { idempotent: true });
  }
}

// Decrypt an item to a temporary plaintext file so the OS viewer/player can read
// it; callers delete it when done. (Trade-off: brief plaintext on disk in the
// private sandbox — documented in the threat model.)
export async function writeTempPlaintext(id: string, data: Uint8Array, ext: string): Promise<string> {
  const path = FileSystem.cacheDirectory + `tmp_${id}.${ext}`;
  await FileSystem.writeAsStringAsync(path, toB64(data), {
    encoding: FileSystem.EncodingType.Base64,
  });
  return path;
}

export async function deleteTemp(path: string): Promise<void> {
  await FileSystem.deleteAsync(path, { idempotent: true });
}
