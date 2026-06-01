import { describe, expect, it } from "vitest";
import { isMasterPlaylist, parseMaster, parseMedia, resolveUrl } from "../src/platform/hls";

describe("resolveUrl", () => {
  it("returns absolute URLs unchanged", () => {
    expect(resolveUrl("https://x.com/a/b.m3u8", "https://cdn.com/c.ts")).toBe("https://cdn.com/c.ts");
  });
  it("resolves root-relative against the origin", () => {
    expect(resolveUrl("https://x.com/a/b.m3u8", "/v/seg.ts")).toBe("https://x.com/v/seg.ts");
  });
  it("resolves directory-relative paths", () => {
    expect(resolveUrl("https://x.com/a/b/index.m3u8", "seg0.ts")).toBe("https://x.com/a/b/seg0.ts");
  });
  it("collapses .. segments", () => {
    expect(resolveUrl("https://x.com/a/b/index.m3u8", "../c/seg.ts")).toBe("https://x.com/a/c/seg.ts");
  });
  it("keeps the scheme for protocol-relative refs", () => {
    expect(resolveUrl("https://x.com/a.m3u8", "//cdn.com/s.ts")).toBe("https://cdn.com/s.ts");
  });
});

const MASTER = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=300000,RESOLUTION=426x240
240/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360
360/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720
720/index.m3u8
`;

describe("parseMaster", () => {
  it("detects a master playlist", () => {
    expect(isMasterPlaylist(MASTER)).toBe(true);
    expect(isMasterPlaylist("#EXTM3U\n#EXTINF:9,\nseg.ts")).toBe(false);
  });

  it("lists variants highest-first with resolution labels", () => {
    const v = parseMaster(MASTER, "https://x.com/hls/master.m3u8");
    expect(v.map((x) => x.label)).toEqual(["720p", "360p", "240p"]);
    expect(v[0].url).toBe("https://x.com/hls/720/index.m3u8");
    expect(v[0].height).toBe(720);
    expect(v[2].bandwidth).toBe(300000);
  });
});

const MEDIA = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:10
#EXTINF:9.0,
seg0.ts
#EXTINF:9.0,
seg1.ts
#EXT-X-ENDLIST
`;

describe("parseMedia", () => {
  it("collects ordered, absolute segment URLs", () => {
    const m = parseMedia(MEDIA, "https://x.com/hls/720/index.m3u8");
    expect(m.segments).toEqual([
      "https://x.com/hls/720/seg0.ts",
      "https://x.com/hls/720/seg1.ts",
    ]);
    expect(m.initUrl).toBeUndefined();
  });

  it("captures an fMP4 init segment from EXT-X-MAP", () => {
    const fmp4 = `#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:6,\nseg0.m4s\n`;
    const m = parseMedia(fmp4, "https://x.com/v/index.m3u8");
    expect(m.initUrl).toBe("https://x.com/v/init.mp4");
    expect(m.segments).toEqual(["https://x.com/v/seg0.m4s"]);
  });
});
