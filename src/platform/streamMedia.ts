// Native player source for a remote (cloud) media item. expo-av can't consume a
// custom chunk stream, so we decrypt the chunks (via Range requests, constant
// per-chunk memory) and write a single temp file, then hand expo-av its URI.
//
// This is buffered, not yet progressive on native — true play-while-download
// needs a loopback decrypt-server (deferred; see docs/cloud-architecture.md).
// The web build (streamMedia.web.ts) does stream progressively via MSE.
import * as FileSystem from "expo-file-system";
import { toB64 } from "../crypto/b64";
import type { RemoteStream } from "../cloud/stream";

function extFor(mime?: string): string {
  const m = (mime ?? "").toLowerCase();
  if (m.startsWith("audio/")) return m.includes("mpeg") ? "mp3" : "m4a";
  if (m.includes("webm")) return "webm";
  if (m.includes("quicktime")) return "mov";
  return "mp4";
}

export async function streamRemoteToUri(
  stream: RemoteStream
): Promise<{ uri: string; release: () => Promise<void> }> {
  const data = await stream.reader.readAll();
  const path = `${FileSystem.cacheDirectory}stream_${stream.plainSize}_${stream.chunkCount}.${extFor(stream.mime)}`;
  await FileSystem.writeAsStringAsync(path, toB64(data), { encoding: FileSystem.EncodingType.Base64 });
  return {
    uri: path,
    release: async () => {
      await FileSystem.deleteAsync(path, { idempotent: true });
    },
  };
}
