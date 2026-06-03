// Web video trimming via ffmpeg.wasm. The ffmpeg "core" (the ~30 MB wasm) is the
// heavy part; we don't bundle it — it's fetched once from a CDN at first use and
// cached as a blob URL, so the app bundle stays small. The single-threaded core
// is used deliberately: it doesn't need SharedArrayBuffer / cross-origin
// isolation, so it works on a plain Vercel static deploy with no extra headers.
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { toBlobURL } from "@ffmpeg/util";

export const trimSupported = true;

// ESM build of @ffmpeg/core so the module worker can `import()` it (the worker is
// always type:"module"). The single-threaded core needs no cross-origin isolation.
const CORE_BASE = "https://unpkg.com/@ffmpeg/core@0.12.10/dist/esm";
const FF_BASE = "https://unpkg.com/@ffmpeg/ffmpeg@0.12.15/dist/esm";

let ff: FFmpeg | null = null;
let loading: Promise<FFmpeg> | null = null;

// The FFmpeg class spawns a *module* worker. Its worker.js has relative imports
// (`./const.js`, `./errors.js`); if we just blob-URL'd worker.js those would
// resolve against the blob origin and 404, so the worker would silently never
// signal ready and load() would hang forever. Instead we fetch the worker and
// its two tiny dependency modules, strip the relative imports, and concatenate
// them into one self-contained module — which blob-URLs cleanly.
async function buildWorkerBlobURL(): Promise<string> {
  const [constSrc, errSrc, workerSrc] = await Promise.all(
    ["const.js", "errors.js", "worker.js"].map((f) => fetch(`${FF_BASE}/${f}`).then((r) => r.text()))
  );
  const stripImports = (s: string) => s.replace(/^\s*import\s[^\n]*$/gm, "");
  const merged = [stripImports(constSrc), stripImports(errSrc), stripImports(workerSrc)].join("\n");
  return URL.createObjectURL(new Blob([merged], { type: "text/javascript" }));
}

async function getFF(): Promise<FFmpeg> {
  if (ff) return ff;
  if (!loading) {
    loading = (async () => {
      const inst = new FFmpeg();
      const [classWorkerURL, coreURL, wasmURL] = await Promise.all([
        buildWorkerBlobURL(),
        toBlobURL(`${CORE_BASE}/ffmpeg-core.js`, "text/javascript"),
        toBlobURL(`${CORE_BASE}/ffmpeg-core.wasm`, "application/wasm"),
      ]);
      await inst.load({ classWorkerURL, coreURL, wasmURL });
      ff = inst;
      return inst;
    })();
  }
  return loading;
}

function extFor(mime: string | undefined): string {
  if (!mime) return "mp4";
  if (mime.includes("webm")) return "webm";
  if (mime.includes("quicktime") || mime.includes("mov")) return "mov";
  if (mime.includes("matroska")) return "mkv";
  if (mime.includes("avi")) return "avi";
  return "mp4";
}

/**
 * Cut [startSec, endSec] out of a video. Uses stream copy (no re-encode) so it's
 * fast and lossless; cuts land on the nearest keyframe at/after the start. The
 * returned bytes are a self-contained clip in the same container.
 */
export async function trimVideo(
  bytes: Uint8Array,
  mime: string | undefined,
  startSec: number,
  endSec: number,
  onProgress?: (ratio: number) => void
): Promise<Uint8Array> {
  const inst = await getFF();
  const ext = extFor(mime);
  const inName = `in.${ext}`;
  const outName = `out.${ext}`;

  const handler = ({ progress }: { progress: number }) => {
    if (onProgress) onProgress(Math.max(0, Math.min(1, progress)));
  };
  inst.on("progress", handler);

  try {
    await inst.writeFile(inName, bytes);
    const dur = Math.max(0.1, endSec - startSec);
    // -ss before -i = fast input seek; -t = duration of the cut. faststart moves
    // the moov atom up so the clip is immediately seekable when played back.
    await inst.exec([
      "-ss", startSec.toFixed(3),
      "-i", inName,
      "-t", dur.toFixed(3),
      "-c", "copy",
      "-movflags", "+faststart",
      outName,
    ]);
    const out = (await inst.readFile(outName)) as Uint8Array;
    // Clean up the in-memory FS so repeated trims don't accumulate.
    try {
      await inst.deleteFile(inName);
      await inst.deleteFile(outName);
    } catch {
      /* best-effort */
    }
    if (!out || out.length === 0) throw new Error("Trim produced an empty file.");
    return out;
  } finally {
    inst.off("progress", handler);
  }
}
