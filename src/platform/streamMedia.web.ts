// Web player source for a remote (cloud) media item — genuine
// watch-while-downloading via Media Source Extensions: decrypt chunk 0, append
// it, return the object URL so playback can start, then append the rest in the
// background. Falls back to a buffered Blob when MSE can't handle the container
// (e.g. a non-fragmented MP4), so playback always works, just without progress.
import type { RemoteStream } from "../cloud/stream";

function waitFor(target: EventTarget, event: string): Promise<void> {
  return new Promise((resolve) => target.addEventListener(event, () => resolve(), { once: true }));
}

function appendChunk(sb: SourceBuffer, bytes: Uint8Array): Promise<void> {
  return new Promise((resolve, reject) => {
    const ok = () => {
      cleanup();
      resolve();
    };
    const err = () => {
      cleanup();
      reject(new Error("appendBuffer failed"));
    };
    const cleanup = () => {
      sb.removeEventListener("updateend", ok);
      sb.removeEventListener("error", err);
    };
    sb.addEventListener("updateend", ok, { once: true });
    sb.addEventListener("error", err, { once: true });
    sb.appendBuffer(bytes.slice().buffer);
  });
}

async function blobFallback(stream: RemoteStream): Promise<{ uri: string; release: () => Promise<void> }> {
  const data = await stream.reader.readAll();
  const url = URL.createObjectURL(new Blob([data.slice().buffer], { type: stream.mime || "video/mp4" }));
  return { uri: url, release: async () => URL.revokeObjectURL(url) };
}

export async function streamRemoteToUri(
  stream: RemoteStream
): Promise<{ uri: string; release: () => Promise<void> }> {
  const type = stream.mime || "video/mp4";
  const canMse =
    typeof MediaSource !== "undefined" && MediaSource.isTypeSupported(type) && stream.chunkCount > 0;
  if (!canMse) return blobFallback(stream);

  try {
    const ms = new MediaSource();
    const url = URL.createObjectURL(ms);
    await waitFor(ms, "sourceopen");
    const sb = ms.addSourceBuffer(type); // throws if codec unsupported
    // Append the first chunk now so we can detect an incompatible container
    // (non-fragmented MP4) and fall back before returning a broken URL.
    await appendChunk(sb, await stream.reader.chunk(0));

    // Stream the remainder in the background; playback runs as data arrives.
    void (async () => {
      try {
        for (let i = 1; i < stream.chunkCount; i++) await appendChunk(sb, await stream.reader.chunk(i));
        if (ms.readyState === "open") ms.endOfStream();
      } catch {
        try {
          if (ms.readyState === "open") ms.endOfStream();
        } catch {
          /* ignore */
        }
      }
    })();

    return { uri: url, release: async () => URL.revokeObjectURL(url) };
  } catch {
    // MSE setup or first append failed -> safe buffered path.
    return blobFallback(stream);
  }
}
