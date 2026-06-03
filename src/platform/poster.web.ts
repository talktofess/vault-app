// Grab a representative frame from a video as a small JPEG, so videos show a
// real preview ("what the video is") instead of a blank icon. Loads the clip
// into an off-screen <video>, seeks a touch past the start (to dodge an all-
// black first frame), and draws that frame to a canvas.
export const posterSupported = true;

export async function makeVideoPoster(uri: string): Promise<Uint8Array | null> {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    v.muted = true;
    v.preload = "metadata";
    v.crossOrigin = "anonymous";
    v.src = uri;

    let settled = false;
    const finish = (val: Uint8Array | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        v.removeAttribute("src");
        v.load();
      } catch {
        /* ignore */
      }
      resolve(val);
    };

    const draw = () => {
      try {
        const w = v.videoWidth;
        const h = v.videoHeight;
        if (!w || !h) return finish(null);
        const scale = Math.min(1, 320 / Math.max(w, h));
        const cw = Math.max(1, Math.round(w * scale));
        const ch = Math.max(1, Math.round(h * scale));
        const c = document.createElement("canvas");
        c.width = cw;
        c.height = ch;
        const ctx = c.getContext("2d");
        if (!ctx) return finish(null);
        ctx.drawImage(v, 0, 0, cw, ch);
        c.toBlob(
          (b) => {
            if (!b) return finish(null);
            b.arrayBuffer().then((ab) => finish(new Uint8Array(ab))).catch(() => finish(null));
          },
          "image/jpeg",
          0.7
        );
      } catch {
        finish(null);
      }
    };

    v.onloadeddata = () => {
      const t = v.duration && isFinite(v.duration) ? Math.min(0.8, v.duration * 0.1) : 0.1;
      try {
        v.currentTime = t;
      } catch {
        draw(); // some sources can't seek; use the current frame
      }
    };
    v.onseeked = draw;
    v.onerror = () => finish(null);
    const timer = setTimeout(() => finish(null), 6000); // never hang the grid
  });
}
