// Media helpers: compress images before encrypting (saves space), and delete an
// imported asset from the device's own gallery after it's safely in the vault.
import * as FileSystem from "expo-file-system";
import * as ImageManipulator from "expo-image-manipulator";
import * as MediaLibrary from "expo-media-library";
import { fromB64 } from "../crypto/b64";

// Re-encode an image at reduced quality/size. Returns the compressed bytes.
// Videos are returned unchanged (Expo can't transcode video) — caller decides.
export async function compressImage(uri: string): Promise<Uint8Array> {
  const result = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: 1600 } }], // cap long edge; keeps aspect ratio
    { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG, base64: true }
  );
  return fromB64(result.base64 ?? "");
}

export async function readFileBytes(uri: string): Promise<Uint8Array> {
  const b64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return fromB64(b64);
}

// Delete the original asset(s) from the phone's gallery. The OS shows a
// system confirmation dialog — no app can delete a user's photos silently.
// Returns true if the user approved the deletion.
export async function deleteFromGallery(assetIds: string[]): Promise<boolean> {
  if (assetIds.length === 0) return true;
  try {
    const perm = await MediaLibrary.requestPermissionsAsync();
    if (!perm.granted) return false;
    return await MediaLibrary.deleteAssetsAsync(assetIds);
  } catch {
    return false;
  }
}
