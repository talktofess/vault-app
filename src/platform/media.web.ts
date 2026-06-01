// Web media helpers. Mirrors media.ts's exports. Image compression is done with
// a <canvas> (no expo-image-manipulator on web); there's no device gallery to
// delete from, so deleteFromGallery is a no-op that reports success.

function loadImage(uri: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load image"));
    img.src = uri;
  });
}

function blobToBytes(blob: Blob): Promise<Uint8Array> {
  return blob.arrayBuffer().then((b) => new Uint8Array(b));
}

/** Re-encode an image at reduced size/quality via canvas; returns JPEG bytes. */
export async function compressImage(uri: string): Promise<Uint8Array> {
  const img = await loadImage(uri);
  const maxEdge = 1600;
  const scale = Math.min(1, maxEdge / Math.max(img.width, img.height || 1));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return readFileBytes(uri); // fallback: store original
  ctx.drawImage(img, 0, 0, w, h);
  const blob: Blob | null = await new Promise((resolve) =>
    canvas.toBlob((b) => resolve(b), "image/jpeg", 0.7)
  );
  if (!blob) return readFileBytes(uri);
  return blobToBytes(blob);
}

export async function readFileBytes(uri: string): Promise<Uint8Array> {
  const res = await fetch(uri);
  return new Uint8Array(await res.arrayBuffer());
}

export async function deleteFromGallery(_assetIds: string[]): Promise<boolean> {
  // Nothing to delete: a web file picker never imported the user's gallery.
  return true;
}
