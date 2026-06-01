// Platform file I/O used by the screens, kept behind one interface so the web
// build can swap in a browser-native implementation (see io.web.ts). Native
// uses expo-file-system + the OS share sheet.
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";
import { fromB64, toB64 } from "../crypto/b64";

/** Read a picked file URI (document/image picker) as raw bytes. */
export async function readBytesFromUri(uri: string): Promise<Uint8Array> {
  const b64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return fromB64(b64);
}

/** Read a picked file URI as text (e.g. a backup archive). */
export async function readTextFromUri(uri: string): Promise<string> {
  return FileSystem.readAsStringAsync(uri);
}

/**
 * Decrypt-to-temp so the OS viewer/player can read an item; the returned URI
 * must be released with releaseViewableUri() when done. (Brief plaintext in the
 * private sandbox — documented in the threat model.)
 */
export async function makeViewableUri(id: string, data: Uint8Array, ext: string): Promise<string> {
  const path = FileSystem.cacheDirectory + `tmp_${id}.${ext}`;
  await FileSystem.writeAsStringAsync(path, toB64(data), {
    encoding: FileSystem.EncodingType.Base64,
  });
  return path;
}

export async function releaseViewableUri(uri: string): Promise<void> {
  await FileSystem.deleteAsync(uri, { idempotent: true });
}

/** Export bytes out of the vault via the OS share sheet (the "download" path). */
export async function saveBytes(name: string, mime: string | undefined, bytes: Uint8Array): Promise<void> {
  const safe = name.replace(/[^\w.\-]+/g, "_");
  const uri = FileSystem.cacheDirectory + safe;
  await FileSystem.writeAsStringAsync(uri, toB64(bytes), {
    encoding: FileSystem.EncodingType.Base64,
  });
  try {
    if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: mime });
  } finally {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  }
}

/** Export text out of the vault (e.g. an encrypted backup archive). */
export async function saveText(name: string, text: string): Promise<void> {
  const uri = FileSystem.cacheDirectory + name.replace(/[^\w.\-]+/g, "_");
  await FileSystem.writeAsStringAsync(uri, text);
  try {
    if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri);
  } finally {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  }
}

/** Whether exporting/sharing files is supported (always true on native). */
export const canSaveOut = true;
