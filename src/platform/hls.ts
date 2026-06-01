// Pure HLS (.m3u8) parsing — no Expo / network imports, so it's unit-testable.
// We support the common case: a master playlist that lists variant streams at
// different resolutions, and a media playlist that lists .ts (or fMP4) segments.

export interface HlsVariant {
  url: string; // absolute URL of the variant's media playlist
  bandwidth?: number; // bits per second, if advertised
  width?: number;
  height?: number; // vertical resolution, e.g. 240, 360, 720
  label: string; // human label, e.g. "360p" or "1280×720"
}

/** Resolve a possibly-relative URI against a base URL (no URL() dependency). */
export function resolveUrl(base: string, ref: string): string {
  if (/^https?:\/\//i.test(ref)) return ref;
  // strip query/hash from base for path math
  const hashless = base.split("#")[0].split("?")[0];
  if (ref.startsWith("//")) {
    const scheme = base.match(/^(https?:)/i)?.[1] ?? "https:";
    return scheme + ref;
  }
  const m = hashless.match(/^(https?:\/\/[^/]+)(\/.*)?$/i);
  if (!m) return ref;
  const origin = m[1];
  const path = m[2] ?? "/";
  if (ref.startsWith("/")) return origin + ref;
  // relative to the current "directory"
  const dir = path.slice(0, path.lastIndexOf("/") + 1);
  const segments = (dir + ref).split("/");
  const out: string[] = [];
  for (const s of segments) {
    if (s === "." || s === "") continue;
    if (s === "..") out.pop();
    else out.push(s);
  }
  return origin + "/" + out.join("/");
}

export function isMasterPlaylist(text: string): boolean {
  return /#EXT-X-STREAM-INF/i.test(text);
}

function labelFor(height?: number, width?: number, bandwidth?: number): string {
  if (height) return `${height}p`;
  if (width && height) return `${width}×${height}`;
  if (bandwidth) return `${Math.round(bandwidth / 1000)} kbps`;
  return "stream";
}

/** Parse a master playlist into its variant streams, best (highest) first. */
export function parseMaster(text: string, baseUrl: string): HlsVariant[] {
  const lines = text.split(/\r?\n/);
  const variants: HlsVariant[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!/^#EXT-X-STREAM-INF/i.test(line)) continue;
    const bandwidth = Number(line.match(/[^A-Z]BANDWIDTH=(\d+)/i)?.[1] ?? line.match(/BANDWIDTH=(\d+)/i)?.[1]) || undefined;
    const res = line.match(/RESOLUTION=(\d+)x(\d+)/i);
    const width = res ? Number(res[1]) : undefined;
    const height = res ? Number(res[2]) : undefined;
    // the URI is on the next non-comment line
    let uri = "";
    for (let j = i + 1; j < lines.length; j++) {
      const cand = lines[j].trim();
      if (cand && !cand.startsWith("#")) {
        uri = cand;
        break;
      }
    }
    if (!uri) continue;
    variants.push({
      url: resolveUrl(baseUrl, uri),
      bandwidth,
      width,
      height,
      label: labelFor(height, width, bandwidth),
    });
  }
  // de-dupe by label, sort by height (then bandwidth) descending
  const seen = new Set<string>();
  return variants
    .sort((a, b) => (b.height ?? 0) - (a.height ?? 0) || (b.bandwidth ?? 0) - (a.bandwidth ?? 0))
    .filter((v) => {
      const k = v.label + v.url;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}

export interface HlsMedia {
  initUrl?: string; // EXT-X-MAP (fMP4 init segment), if present
  segments: string[]; // absolute segment URLs in play order
}

/** Parse a media playlist into its ordered segment URLs. */
export function parseMedia(text: string, baseUrl: string): HlsMedia {
  const lines = text.split(/\r?\n/);
  const segments: string[] = [];
  let initUrl: string | undefined;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (/^#EXT-X-MAP:/i.test(line)) {
      const uri = line.match(/URI="([^"]+)"/i)?.[1];
      if (uri) initUrl = resolveUrl(baseUrl, uri);
      continue;
    }
    if (line.startsWith("#")) continue;
    segments.push(resolveUrl(baseUrl, line));
  }
  return { initUrl, segments };
}
