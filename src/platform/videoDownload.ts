// Download orchestration for the in-app browser's video grabber. Pure HLS
// parsing lives in ./hls; this layer adds the network + filesystem work.
//
// Honest scope: we can grab plain video files (.mp4/.webm/…) and non-DRM HLS
// (.m3u8) streams that expose their segments. We CANNOT grab MediaSource/`blob:`
// streams or DRM-protected video (YouTube, Netflix, etc.) — those are encrypted
// or never expose a fetchable URL.
import * as FileSystem from "expo-file-system";
import { fromB64 } from "../crypto/b64";
import { isMasterPlaylist, parseMaster, parseMedia, type HlsVariant } from "./hls";

export interface DetectedVideo {
  url: string;
  kind: "progressive" | "hls";
}

export type Progress = (fraction: number) => void;

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}

/**
 * Quality choices for a detected source. For an HLS master playlist these are
 * the real resolution variants (144p/240p/…); for a media playlist or a plain
 * file there's a single "Original" choice.
 */
export async function qualityOptions(v: DetectedVideo): Promise<HlsVariant[]> {
  if (v.kind === "hls") {
    const text = await fetchText(v.url);
    if (isMasterPlaylist(text)) {
      const variants = parseMaster(text, v.url);
      if (variants.length) return variants;
    }
    return [{ url: v.url, label: "Original" }];
  }
  const name = filenameFromUrl(v.url);
  return [{ url: v.url, label: name || "Original" }];
}

export function filenameFromUrl(url: string): string {
  const tail = url.split("#")[0].split("?")[0].split("/").pop() || "";
  return decodeURIComponent(tail);
}

async function readBytes(uri: string): Promise<Uint8Array> {
  const b64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return fromB64(b64);
}

let counter = 0;
function tmpPath(tag: string): string {
  counter += 1;
  return `${FileSystem.cacheDirectory}vdl_${tag}_${counter}`;
}

/** Download a plain progressive video file, reporting 0..1 progress. */
export async function downloadProgressive(url: string, onProgress?: Progress): Promise<Uint8Array> {
  const tmp = tmpPath("p");
  const task = FileSystem.createDownloadResumable(url, tmp, {}, (p) => {
    if (onProgress && p.totalBytesExpectedToWrite > 0) {
      onProgress(p.totalBytesWritten / p.totalBytesExpectedToWrite);
    }
  });
  const out = await task.downloadAsync();
  if (!out) throw new Error("Download was interrupted");
  const bytes = await readBytes(out.uri);
  await FileSystem.deleteAsync(out.uri, { idempotent: true });
  return bytes;
}

/**
 * Download an HLS variant: fetch its media playlist, pull every segment (plus
 * the fMP4 init segment, if any), and concatenate into one byte array. The
 * result is a playable .ts/.mp4 stream (expo-av handles concatenated segments).
 * Progress is per-segment.
 */
export async function downloadHls(variantUrl: string, onProgress?: Progress): Promise<Uint8Array> {
  const text = await fetchText(variantUrl);
  const media = parseMedia(text, variantUrl);
  const urls = media.initUrl ? [media.initUrl, ...media.segments] : media.segments;
  if (urls.length === 0) throw new Error("This stream exposes no downloadable segments");

  const parts: Uint8Array[] = [];
  let total = 0;
  for (let i = 0; i < urls.length; i++) {
    const tmp = tmpPath(`s${i}`);
    const out = await FileSystem.downloadAsync(urls[i], tmp);
    const bytes = await readBytes(out.uri);
    await FileSystem.deleteAsync(out.uri, { idempotent: true });
    parts.push(bytes);
    total += bytes.length;
    onProgress?.((i + 1) / urls.length);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    merged.set(part, offset);
    offset += part.length;
  }
  return merged;
}

/** A sensible default filename + mime for a chosen download. */
export function describeDownload(v: DetectedVideo, label: string): { name: string; mime: string } {
  if (v.kind === "hls") {
    const base = filenameFromUrl(v.url).replace(/\.m3u8$/i, "") || "stream";
    return { name: `${base}_${label}.mp4`, mime: "video/mp4" };
  }
  const name = filenameFromUrl(v.url) || "video.mp4";
  const mime = /\.webm$/i.test(name)
    ? "video/webm"
    : /\.mov$/i.test(name)
      ? "video/quicktime"
      : "video/mp4";
  return { name, mime };
}
