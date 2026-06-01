// Web implementation of platform file I/O. Picked files arrive as blob:/data:
// URIs we can fetch; previews use object URLs; "export" becomes a browser
// download. Nothing here touches a server — it's all in the page.
const MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  m4v: "video/x-m4v",
};

export async function readBytesFromUri(uri: string): Promise<Uint8Array> {
  const res = await fetch(uri);
  return new Uint8Array(await res.arrayBuffer());
}

export async function readTextFromUri(uri: string): Promise<string> {
  const res = await fetch(uri);
  return await res.text();
}

export async function makeViewableUri(_id: string, data: Uint8Array, ext: string): Promise<string> {
  const mime = MIME_BY_EXT[ext.toLowerCase()] ?? "application/octet-stream";
  // Copy into a fresh ArrayBuffer so the Blob owns its bytes.
  const buf = data.slice().buffer;
  const blob = new Blob([buf], { type: mime });
  return URL.createObjectURL(blob);
}

export async function releaseViewableUri(uri: string): Promise<void> {
  try {
    URL.revokeObjectURL(uri);
  } catch {
    /* ignore */
  }
}

function triggerDownload(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function saveBytes(name: string, mime: string | undefined, bytes: Uint8Array): Promise<void> {
  const buf = bytes.slice().buffer;
  triggerDownload(new Blob([buf], { type: mime || "application/octet-stream" }), name);
}

export async function saveText(name: string, text: string): Promise<void> {
  triggerDownload(new Blob([text], { type: "application/json" }), name);
}

export const canSaveOut = true;
