// Native video poster frames via expo-video-thumbnails: grab a frame a little
// past the start (to dodge a black first frame) and return it as JPEG bytes.
import * as VideoThumbnails from "expo-video-thumbnails";
import * as FileSystem from "expo-file-system";
import { fromB64 } from "../crypto/b64";

export const posterSupported = true;

export async function makeVideoPoster(uri: string): Promise<Uint8Array | null> {
  try {
    const { uri: thumbUri } = await VideoThumbnails.getThumbnailAsync(uri, {
      time: 800, // ms in — past any black lead frame
      quality: 0.7,
    });
    const b64 = await FileSystem.readAsStringAsync(thumbUri, { encoding: FileSystem.EncodingType.Base64 });
    await FileSystem.deleteAsync(thumbUri, { idempotent: true }).catch(() => {});
    return fromB64(b64);
  } catch {
    return null; // fall back to the video icon
  }
}
