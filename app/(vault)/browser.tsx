import { useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { WebView, type WebViewNavigation } from "react-native-webview";
import { Ionicons } from "@expo/vector-icons";
import * as FileSystem from "expo-file-system";
import { router } from "expo-router";
import { useVault } from "../../src/state/VaultContext";
import { VideoPlayer } from "../../src/ui/VideoPlayer";
import { theme } from "../../src/ui/theme";
import { fromB64 } from "../../src/crypto/b64";
import type { HlsVariant } from "../../src/platform/hls";
import {
  describeDownload,
  downloadHls,
  downloadProgressive,
  qualityOptions,
  type DetectedVideo,
} from "../../src/platform/videoDownload";

// In-app browser. Two privacy goals:
//  1) Nothing leaks to Chrome / the system browser. The WebView runs in
//     `incognito` (no persisted history, cookies, or cache), third-party and
//     shared cookies are off, and we refuse to hand any URL to an external app
//     (intent://, market://, mailto:, tel:, …) — every http(s) page stays inside.
//  2) Downloads land ENCRYPTED in the vault's hidden folder, never the gallery.
//     You can stream a found video, queue it to download, or do both at once and
//     watch the downloads list fill up.
function normalizeUrl(input: string): string {
  const t = input.trim();
  if (/^https?:\/\//i.test(t)) return t;
  if (t.includes(".") && !t.includes(" ")) return "https://" + t;
  return "https://duckduckgo.com/?q=" + encodeURIComponent(t);
}

// Injected into every page: scan the DOM for real (fetchable) video URLs and
// report them back. Re-runs on mutations + a timer to catch lazily-loaded media.
// blob:/MediaSource streams are intentionally skipped — they can't be fetched.
const DETECT_JS = `
(function(){
  function add(map, u, kind){
    if(!u) return;
    if(u.indexOf('blob:')===0) return;
    if(!/^https?:|^\\/\\//i.test(u)) return;
    map[u] = /\\.m3u8/i.test(u) ? 'hls' : kind;
  }
  function collect(){
    try {
      var map = {};
      var vids = document.querySelectorAll('video');
      for(var i=0;i<vids.length;i++){
        add(map, vids[i].currentSrc || vids[i].src, 'progressive');
        var ss = vids[i].querySelectorAll('source');
        for(var j=0;j<ss.length;j++) add(map, ss[j].src || ss[j].getAttribute('src'), 'progressive');
      }
      var srcs = document.querySelectorAll('source');
      for(var k=0;k<srcs.length;k++) add(map, srcs[k].src || srcs[k].getAttribute('src'), 'progressive');
      var html = document.documentElement.innerHTML;
      var re = /https?:\\/\\/[^"'\\s<>\\\\)]+\\.(m3u8|mp4|webm|m4v|mov)(\\?[^"'\\s<>\\\\)]*)?/gi, m;
      while((m = re.exec(html))) add(map, m[0], 'progressive');
      var list = [];
      for(var u in map) list.push({url:u, kind:map[u]});
      if(list.length) window.ReactNativeWebView.postMessage(JSON.stringify({type:'videos', list:list}));
    } catch(e){}
  }
  collect();
  var t = setInterval(collect, 2500);
  try {
    var obs = new MutationObserver(collect);
    obs.observe(document.documentElement, {childList:true, subtree:true, attributes:true, attributeFilter:['src']});
  } catch(e){}
  document.addEventListener('play', collect, true);
})();
true;
`;

// A queued/in-flight/finished download, shown in the downloads list.
type DownloadJob = {
  id: string;
  name: string;
  url: string; // resolved media URL (progressive file or chosen HLS variant)
  kind: "progressive" | "hls";
  mime?: string;
  sourceUrl: string;
  fraction: number;
  status: "downloading" | "done" | "error";
  error?: string;
};

export default function Browser() {
  const { vault } = useVault();
  const webRef = useRef<WebView>(null);
  const [input, setInput] = useState("");
  const [current, setCurrent] = useState("https://duckduckgo.com");
  const [uri, setUri] = useState("https://duckduckgo.com");
  const [loading, setLoading] = useState(false);
  const [canBack, setCanBack] = useState(false);
  const [downloadingCurrent, setDownloadingCurrent] = useState(false);

  // detected videos on the current page
  const [found, setFound] = useState<DetectedVideo[]>([]);
  const [grabberOpen, setGrabberOpen] = useState(false);
  // quality sub-sheet (HLS sources offer multiple resolutions)
  const [quality, setQuality] = useState<{ v: DetectedVideo; options: HlsVariant[] } | null>(null);
  const [resolving, setResolving] = useState<string | null>(null); // url being resolved
  // streaming overlay — watch a found video (optionally while it downloads)
  const [streaming, setStreaming] = useState<{ url: string; name: string } | null>(null);
  // the downloads list
  const [downloads, setDownloads] = useState<DownloadJob[]>([]);
  const [downloadsOpen, setDownloadsOpen] = useState(false);
  const idRef = useRef(0);

  const active = downloads.filter((d) => d.status === "downloading").length;

  function go() {
    setUri(normalizeUrl(input));
  }

  function onNav(nav: WebViewNavigation) {
    setCurrent(nav.url);
    setInput(nav.url);
    setCanBack(nav.canGoBack);
  }

  function onMessage(e: { nativeEvent: { data: string } }) {
    try {
      const msg = JSON.parse(e.nativeEvent.data);
      if (msg.type !== "videos" || !Array.isArray(msg.list)) return;
      setFound((prev) => {
        const map = new Map(prev.map((v) => [v.url, v]));
        for (const v of msg.list as DetectedVideo[]) map.set(v.url, v);
        return [...map.values()];
      });
    } catch {
      /* ignore malformed messages */
    }
  }

  // Keep every navigation inside the WebView; never hand off to an external app
  // (which would leak history into Chrome / that app). Allow only web schemes.
  function allowRequest(req: { url: string }): boolean {
    return /^(https?:|about:|data:|blob:)/i.test(req.url);
  }

  // ---- downloads queue ----
  function enqueue(job: Omit<DownloadJob, "id" | "fraction" | "status">) {
    const full: DownloadJob = { ...job, id: `j${idRef.current++}`, fraction: 0, status: "downloading" };
    setDownloads((d) => [full, ...d]);
    setDownloadsOpen(true);
    void runJob(full);
  }

  async function runJob(job: DownloadJob) {
    const onProgress = (f: number) =>
      setDownloads((d) => d.map((x) => (x.id === job.id ? { ...x, fraction: f } : x)));
    try {
      const bytes =
        job.kind === "hls" ? await downloadHls(job.url, onProgress) : await downloadProgressive(job.url, onProgress);
      await vault.addItem("media", job.name, bytes, { mime: job.mime, sourceUrl: job.sourceUrl });
      setDownloads((d) => d.map((x) => (x.id === job.id ? { ...x, fraction: 1, status: "done" } : x)));
    } catch (e) {
      setDownloads((d) =>
        d.map((x) => (x.id === job.id ? { ...x, status: "error", error: e instanceof Error ? e.message : "Failed" } : x))
      );
    }
  }

  // Resolve a detected video's qualities. Progressive sources have a single
  // "Original" option → queue immediately; HLS opens the quality sub-sheet.
  async function downloadFound(v: DetectedVideo) {
    setResolving(v.url);
    try {
      const options = await qualityOptions(v);
      if (options.length <= 1) {
        const opt = options[0];
        const { name, mime } = describeDownload(v, opt?.label);
        enqueue({ name, url: opt?.url ?? v.url, kind: v.kind, mime, sourceUrl: v.url });
        setGrabberOpen(false);
      } else {
        setQuality({ v, options });
      }
    } catch (e) {
      Alert.alert("Couldn't read this video", e instanceof Error ? e.message : "Failed to load qualities.");
    } finally {
      setResolving(null);
    }
  }

  function pickQuality(v: DetectedVideo, opt: HlsVariant) {
    const { name, mime } = describeDownload(v, opt.label);
    enqueue({ name, url: opt.url, kind: v.kind, mime, sourceUrl: v.url });
    setQuality(null);
    setGrabberOpen(false);
  }

  // Generic: download whatever the address bar points at (a direct file link).
  async function downloadCurrent() {
    setDownloadingCurrent(true);
    try {
      const name = current.split("/").pop()?.split("?")[0] || `download_${Date.now()}`;
      const tmp = FileSystem.cacheDirectory + `dl_${Date.now()}_${name}`;
      const res = await FileSystem.downloadAsync(current, tmp);
      const b64 = await FileSystem.readAsStringAsync(res.uri, { encoding: FileSystem.EncodingType.Base64 });
      const mime = res.headers["Content-Type"] || res.headers["content-type"];
      const isMedia = /image|video|audio/i.test(mime || "");
      await vault.addItem(isMedia ? "media" : "file", name, fromB64(b64), { mime, sourceUrl: current });
      await FileSystem.deleteAsync(res.uri, { idempotent: true });
      Alert.alert("Saved to vault", `"${name}" is now stored encrypted${isMedia ? " in Media" : " in Files"}.`);
    } catch (e) {
      Alert.alert("Download failed", e instanceof Error ? e.message : "Could not download this URL.");
    } finally {
      setDownloadingCurrent(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, padding: 10 }}>
        <Pressable onPress={() => webRef.current?.goBack()} disabled={!canBack}>
          <Ionicons name="chevron-back" size={24} color={canBack ? theme.text : theme.muted} />
        </Pressable>
        <TextInput
          value={input}
          onChangeText={setInput}
          onSubmitEditing={go}
          placeholder="Search or enter address"
          placeholderTextColor={theme.muted}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          style={{
            flex: 1,
            backgroundColor: theme.surface,
            color: theme.text,
            borderRadius: 10,
            paddingHorizontal: 12,
            paddingVertical: 8,
            borderWidth: 1,
            borderColor: theme.border,
          }}
        />
        {/* downloads tray — badge shows how many are still running */}
        {downloads.length > 0 && (
          <Pressable onPress={() => setDownloadsOpen(true)}>
            <View>
              <Ionicons name="cloud-download-outline" size={24} color={theme.accent} />
              {active > 0 && (
                <View style={badgeStyle}>
                  <Text style={badgeText}>{active}</Text>
                </View>
              )}
            </View>
          </Pressable>
        )}
        <Pressable onPress={downloadCurrent} disabled={downloadingCurrent}>
          {downloadingCurrent ? (
            <ActivityIndicator color={theme.accent} />
          ) : (
            <Ionicons name="download-outline" size={24} color={theme.accent} />
          )}
        </Pressable>
      </View>

      {loading && (
        <ActivityIndicator color={theme.accent} style={{ position: "absolute", top: 56, alignSelf: "center", zIndex: 10 }} />
      )}

      <WebView
        ref={webRef}
        source={{ uri }}
        onNavigationStateChange={onNav}
        onLoadStart={() => {
          setLoading(true);
          setFound([]); // reset detections for the new page
        }}
        onLoadEnd={() => setLoading(false)}
        onMessage={onMessage}
        injectedJavaScript={DETECT_JS}
        onShouldStartLoadWithRequest={allowRequest}
        // ---- keep all browsing data in-house ----
        incognito
        cacheEnabled={false}
        thirdPartyCookiesEnabled={false}
        sharedCookiesEnabled={false}
        setSupportMultipleWindows={false}
        javaScriptCanOpenWindowsAutomatically={false}
        // ----
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        style={{ flex: 1, backgroundColor: theme.bg }}
      />

      {/* floating "videos found" pill — tap to grab/stream them */}
      {found.length > 0 && !streaming && (
        <Pressable
          onPress={() => setGrabberOpen(true)}
          style={{
            position: "absolute",
            right: 16,
            bottom: 20,
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            backgroundColor: theme.accent,
            paddingHorizontal: 16,
            height: 50,
            borderRadius: 25,
            shadowColor: "#000",
            shadowOpacity: 0.4,
            shadowRadius: 8,
            shadowOffset: { width: 0, height: 4 },
            elevation: 8,
          }}
        >
          <Ionicons name="film" size={20} color={theme.accentText} />
          <Text style={{ color: theme.accentText, fontWeight: "800", fontSize: 14 }}>
            {found.length} video{found.length === 1 ? "" : "s"}
          </Text>
        </Pressable>
      )}

      {/* video grabber: each found video can be streamed or downloaded */}
      <Modal visible={grabberOpen} transparent animationType="slide" onRequestClose={() => setGrabberOpen(false)}>
        <Pressable
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" }}
          onPress={() => {
            setGrabberOpen(false);
            setQuality(null);
          }}
        >
          <Pressable style={sheetStyle} onPress={() => {}}>
            {!quality ? (
              <>
                <Text style={{ color: theme.text, fontSize: 18, fontWeight: "700", marginBottom: 4 }}>Videos on this page</Text>
                <Text style={{ color: theme.muted, fontSize: 13, marginBottom: 12 }}>
                  {found.length} found · stream it, or download it to your vault (encrypted, never the gallery).
                </Text>
                <ScrollView>
                  {found.map((v) => (
                    <View
                      key={v.url}
                      style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.border }}
                    >
                      <Ionicons name={v.kind === "hls" ? "albums-outline" : "videocam-outline"} size={22} color={theme.accent} />
                      <View style={{ flex: 1 }}>
                        <Text numberOfLines={1} style={{ color: theme.text, fontSize: 14 }}>{titleFor(v)}</Text>
                        <Text style={{ color: theme.muted, fontSize: 11 }}>{v.kind === "hls" ? "Adaptive stream" : "Direct file"}</Text>
                      </View>
                      <Pressable
                        onPress={() => {
                          setGrabberOpen(false);
                          setStreaming({ url: v.url, name: titleFor(v) });
                        }}
                        style={actionBtn}
                      >
                        <Ionicons name="play" size={16} color={theme.accent} />
                        <Text style={actionText}>Play</Text>
                      </Pressable>
                      <Pressable onPress={() => downloadFound(v)} style={actionBtn}>
                        {resolving === v.url ? (
                          <ActivityIndicator size="small" color={theme.accent} />
                        ) : (
                          <>
                            <Ionicons name="download" size={16} color={theme.accent} />
                            <Text style={actionText}>Save</Text>
                          </>
                        )}
                      </Pressable>
                    </View>
                  ))}
                </ScrollView>
              </>
            ) : (
              <>
                <Pressable onPress={() => setQuality(null)} style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 }}>
                  <Ionicons name="chevron-back" size={18} color={theme.accent} />
                  <Text style={{ color: theme.accent, fontSize: 14 }}>Back</Text>
                </Pressable>
                <Text style={{ color: theme.text, fontSize: 18, fontWeight: "700", marginBottom: 12 }}>Choose quality</Text>
                <ScrollView>
                  {quality.options.map((opt) => (
                    <Pressable
                      key={opt.url + opt.label}
                      onPress={() => pickQuality(quality.v, opt)}
                      style={({ pressed }) => ({
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 12,
                        paddingVertical: 12,
                        paddingHorizontal: 8,
                        borderRadius: 10,
                        backgroundColor: pressed ? theme.surface : "transparent",
                      })}
                    >
                      <Ionicons name="download-outline" size={22} color={theme.accent} />
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: theme.text, fontSize: 15 }}>{opt.label}</Text>
                        {opt.bandwidth ? (
                          <Text style={{ color: theme.muted, fontSize: 12 }}>
                            ~{Math.round(opt.bandwidth / 1000)} kbps{opt.width ? ` · ${opt.width}×${opt.height}` : ""}
                          </Text>
                        ) : null}
                      </View>
                      <Ionicons name="chevron-forward" size={18} color={theme.muted} />
                    </Pressable>
                  ))}
                </ScrollView>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      {/* streaming overlay — watch now, and download the same clip while watching */}
      <Modal visible={!!streaming} animationType="fade" onRequestClose={() => setStreaming(null)}>
        {streaming && (
          <View style={{ flex: 1, backgroundColor: "#000" }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingTop: 40, paddingHorizontal: 14, paddingBottom: 8 }}>
              <Pressable onPress={() => setStreaming(null)} hitSlop={8}>
                <Ionicons name="close" size={28} color="#fff" />
              </Pressable>
              <Text numberOfLines={1} style={{ flex: 1, color: "#fff", fontWeight: "700", fontSize: 16 }}>{streaming.name}</Text>
              <Pressable
                onPress={() => {
                  const v = found.find((f) => f.url === streaming.url);
                  if (v) downloadFound(v);
                }}
                hitSlop={8}
                style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
              >
                <Ionicons name="download" size={20} color={theme.accent2} />
                <Text style={{ color: theme.accent2, fontWeight: "800", fontSize: 14 }}>Download</Text>
              </Pressable>
            </View>
            <View style={{ flex: 1 }}>
              <VideoPlayer uri={streaming.url} />
            </View>
            <Text style={{ color: "rgba(255,255,255,0.5)", fontSize: 12, textAlign: "center", paddingVertical: 12 }}>
              Streaming from the source. Tap Download to also keep an encrypted copy in your vault.
            </Text>
          </View>
        )}
      </Modal>

      {/* downloads list */}
      <Modal visible={downloadsOpen} transparent animationType="slide" onRequestClose={() => setDownloadsOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" }} onPress={() => setDownloadsOpen(false)}>
          <Pressable style={sheetStyle} onPress={() => {}}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <Text style={{ color: theme.text, fontSize: 18, fontWeight: "700" }}>Downloads</Text>
              {downloads.some((d) => d.status !== "downloading") && (
                <Pressable onPress={() => setDownloads((d) => d.filter((x) => x.status === "downloading"))}>
                  <Text style={{ color: theme.accent, fontSize: 14 }}>Clear finished</Text>
                </Pressable>
              )}
            </View>
            {downloads.length === 0 ? (
              <Text style={{ color: theme.muted, fontSize: 13, paddingVertical: 20, textAlign: "center" }}>No downloads yet.</Text>
            ) : (
              <FlatList
                data={downloads}
                keyExtractor={(d) => d.id}
                style={{ maxHeight: 360 }}
                renderItem={({ item: d }) => (
                  <View style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.border }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                      <Ionicons
                        name={d.status === "done" ? "checkmark-circle" : d.status === "error" ? "alert-circle" : "cloud-download-outline"}
                        size={20}
                        color={d.status === "done" ? theme.good : d.status === "error" ? theme.danger : theme.accent}
                      />
                      <Text numberOfLines={1} style={{ flex: 1, color: theme.text, fontSize: 14 }}>{d.name}</Text>
                      {d.status === "downloading" && (
                        <Text style={{ color: theme.muted, fontSize: 12 }}>{Math.round(d.fraction * 100)}%</Text>
                      )}
                      {d.status === "done" && (
                        <Pressable onPress={() => { setDownloadsOpen(false); router.replace("/(vault)/library"); }}>
                          <Text style={{ color: theme.accent, fontSize: 13, fontWeight: "700" }}>Open</Text>
                        </Pressable>
                      )}
                    </View>
                    {d.status === "downloading" && (
                      <View style={{ height: 4, borderRadius: 2, backgroundColor: theme.surfaceAlt, marginTop: 8, overflow: "hidden" }}>
                        <View style={{ height: 4, width: `${Math.max(2, Math.round(d.fraction * 100))}%`, backgroundColor: theme.accent }} />
                      </View>
                    )}
                    {d.status === "error" && <Text style={{ color: theme.danger, fontSize: 11, marginTop: 4 }}>{d.error}</Text>}
                  </View>
                )}
              />
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function titleFor(v: DetectedVideo): string {
  const tail = v.url.split("#")[0].split("?")[0].split("/").pop() || v.url;
  return decodeURIComponent(tail) || v.url;
}

const badgeStyle = {
  position: "absolute" as const,
  top: -6,
  right: -8,
  backgroundColor: theme.accent,
  borderRadius: 8,
  minWidth: 16,
  height: 16,
  alignItems: "center" as const,
  justifyContent: "center" as const,
  paddingHorizontal: 3,
};
const badgeText = { color: theme.accentText, fontSize: 10, fontWeight: "700" as const };
const sheetStyle = {
  backgroundColor: theme.bg,
  borderTopLeftRadius: 18,
  borderTopRightRadius: 18,
  borderWidth: 1,
  borderColor: theme.border,
  padding: 18,
  maxHeight: "75%" as const,
};
const actionBtn = {
  flexDirection: "row" as const,
  alignItems: "center" as const,
  gap: 5,
  backgroundColor: theme.surfaceAlt,
  paddingVertical: 7,
  paddingHorizontal: 11,
  borderRadius: 10,
};
const actionText = { color: theme.accent, fontWeight: "700" as const, fontSize: 13 };
