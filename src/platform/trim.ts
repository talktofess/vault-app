// Video trimming. The real implementation lives in trim.web.ts (ffmpeg.wasm);
// native builds don't ship a transcoder yet, so trimming is reported as
// unsupported and the UI hides the Trim control there.
export const trimSupported = false;

export async function trimVideo(
  _bytes: Uint8Array,
  _mime: string | undefined,
  _startSec: number,
  _endSec: number,
  _onProgress?: (ratio: number) => void
): Promise<Uint8Array> {
  throw new Error("Video trimming isn't supported on this platform yet.");
}
