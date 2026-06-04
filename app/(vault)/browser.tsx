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

// In-app browser. Privacy: the WebView runs incognito (no persisted history,
// cookies, cache), refuses external schemes, and downloads land ENCRYPTED in the
// vault. The video grabber is tied to PLAYBACK: instead of scraping every <video>
// (and every ad) on a page, an injected hook watches the network for the real
// media streams (m3u8/mp4/…) that load when you press play — so the download
// offer is about the clip you actually watched.
function normalizeUrl(input: string): string {
  const t = input.trim();
  if (/^https?:\/\//i.test(t)) return t;
  if (t.includes(".") && !t.includes(" ")) return "https://" + t;
  return "https://duckduckgo.com/?q=" + encodeURIComponent(t);
}

// Injected hook: wrap fetch + XHR to capture media URLs as the page requests
// them (this catches HLS/MSE streams the DOM never exposes), and report whether
// a <video> is actually playing. blob: URLs are skipped — they can't be fetched.
const DETECT_JS = `
(function(){
  if (window.__vaultGrab) return; window.__vaultGrab = 1;
  var caught = {};
  function note(u){
    if(!u || typeof u !== 'string') return;
    if(u.indexOf('blob:')===0) return;
    if(!/^https?:|^\\/\\//i.test(u)) return;
    if(/\\.(m3u8|mp4|webm|m4v|mov|m4a|mpd)(\\?|$)/i.test(u)) caught[u.split('#')[0]] = /\\.m3u8|\\.mpd/i.test(u) ? 'hls' : 'progressive';
  }
  try {
    var of = window.fetch;
    if (of) window.fetch = function(a){ try{ note(typeof a==='string'?a:(a&&a.url)); }catch(e){} return of.apply(this, arguments); };
  } catch(e){}
  try {
    var ox = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(m,u){ try{ note(u); }catch(e){} return ox.apply(this, arguments); };
  } catch(e){}
  function report(){
    try {
      var vids = document.querySelectorAll('video'), playing = false;
      for(var i=0;i<vids.length;i++){ var v=vids[i]; if(!v.paused && !v.ended && v.currentTime>0){ playing=true; note(v.currentSrc||v.src); } }
      var list=[]; for(var u in caught) list.push({url:u, kind:caught[u]});
      window.ReactNativeWebView.postMessage(JSON.stringify({type:'state', playing:playing, list:list}));
    } catch(e){}
  }
  setInterval(report, 1000);
  document.addEventListener('play', report, true);
  document.addEventListener('playing', report, true);
  document.addEventListener('pause', report, true);
})();
true;
`;

type DownloadJob = {
  id: string;
  name: string;
  url: string;
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
  const [chrome, setChrome] = useState(true); // address bar visible? (false = immersive)

  // playback-tied grabber
  const [playing, setPlaying] = useState(false);
  const [streams, setStreams] = useState<DetectedVideo[]>([]);
  const [grabberOpen, setGrabberOpen] = useState(false);
  const [quality, setQuality] = useState<{ v: DetectedVideo; options: HlsVariant[] } | null>(null);
  const [resolving, setResolving] = useState<string | null>(null);
  const [streamingUrl, setStreamingUrl] = useState<{ url: string; name: string } | null>(null);

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
      if (msg.type !== "state") return;
      setPlaying(!!msg.playing);
      if (Array.isArray(msg.list)) {
        setStreams((prev) => {
          const map = new Map(prev.map((v) => [v.url, v]));
          for (const v of msg.list as DetectedVideo[]) map.set(v.url, v);
          return [...map.values()].slice(-12); // keep it small; newest streams win
        });
      }
    } catch {
      /* ignore */
    }
  }
  function allowRequest(req: { url: string }): boolean {
    return /^(https?:|about:|data:|blob:)/i.test(req.url);
  }

  // ---- downloads ----
  function enqueue(job: Omit<DownloadJob, "id" | "fraction" | "status">) {
    const full: DownloadJob = { ...job, id: `j${idRef.current++}`, fraction: 0, status: "downloading" };
    setDownloads((d) => [full, ...d]);
    setDownloadsOpen(true);
    void runJob(full);
  }
  async function runJob(job: DownloadJob) {
    const onProgress = (f: number) => setDownloads((d) => d.map((x) => (x.id === job.id ? { ...x, fraction: f } : x)));
    try {
      const bytes = job.kind === "hls" ? await downloadHls(job.url, onProgress) : await downloadProgressive(job.url, onProgress);
      await vault.addItem("media", job.name, bytes, { mime: job.mime, sourceUrl: job.sourceUrl });
      setDownloads((d) => d.map((x) => (x.id === job.id ? { ...x, fraction: 1, status: "done" } : x)));
    } catch (e) {
      setDownloads((d) => d.map((x) => (x.id === job.id ? { ...x, status: "error", error: e instanceof Error ? e.message : "Failed" } : x)));
    }
  }

  // Resolve a stream's resolutions and let the user pick one (144p/360p/720p/…).
  async function chooseFormat(v: DetectedVideo) {
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
      Alert.alert("Couldn't read this video", e instanceof Error ? e.message : "Failed to load formats.");
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

  // open the grabber; if exactly one stream, go straight to its formats
  function openGrabber() {
    if (streams.length === 1) void chooseFormat(streams[0]);
    else setGrabberOpen(true);
  }

  async function downloadCurrent() {
    try {
      const name = current.split("/").pop()?.split("?")[0] || `download_${Date.now()}`;
      const tmp = FileSystem.cacheDirectory + `dl_${Date.now()}_${name}`;
      const res = await FileSystem.downloadAsync(current, tmp);
      const b64 = await FileSystem.readAsStringAsync(res.uri, { encoding: FileSystem.EncodingType.Base64 });
      const mime = res.headers["Content-Type"] || res.headers["content-type"];
      const isMedia = /image|video|audio/i.test(mime || "");
      await vault.addItem(isMedia ? "media" : "file", name, fromB64(b64), { mime, sourceUrl: current });
      await FileSystem.deleteAsync(res.uri, { idempotent: true });
      Alert.alert("Saved to vault", `"${name}" is encrypted in your vault.`);
    } catch (e) {
      Alert.alert("Download failed", e instanceof Error ? e.message : "Could not download this URL.");
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      {/* address bar — hidden in immersive mode for a fullscreen page */}
      {chrome && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 8, paddingVertical: 6, backgroundColor: theme.bgElevated, borderBottomWidth: 1, borderBottomColor: theme.border }}>
          <Pressable onPress={() => router.back()} hitSlop={8}>
            <Ionicons name="close" size={22} color={theme.text} />
          </Pressable>
          <Pressable onPress={() => webRef.current?.goBack()} disabled={!canBack} hitSlop={6}>
            <Ionicons name="chevron-back" size={22} color={canBack ? theme.text : theme.muted} />
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
            selectTextOnFocus
            style={{ flex: 1, backgroundColor: theme.surface, color: theme.text, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 7, fontSize: 14 }}
          />
          {downloads.length > 0 && (
            <Pressable onPress={() => setDownloadsOpen(true)} hitSlop={6}>
              <View>
                <Ionicons name="cloud-download-outline" size={22} color={theme.accent} />
                {active > 0 && <View style={badge}><Text style={badgeT}>{active}</Text></View>}
              </View>
            </Pressable>
          )}
          <Pressable onPress={() => setChrome(false)} hitSlop={6}>
            <Ionicons name="expand-outline" size={22} color={theme.accent} />
          </Pressable>
        </View>
      )}

      {loading && <ActivityIndicator color={theme.accent} style={{ position: "absolute", top: chrome ? 56 : 12, alignSelf: "center", zIndex: 10 }} />}

      <WebView
        ref={webRef}
        source={{ uri }}
        onNavigationStateChange={onNav}
        onLoadStart={() => { setLoading(true); setPlaying(false); setStreams([]); }}
        onLoadEnd={() => setLoading(false)}
        onMessage={onMessage}
        injectedJavaScript={DETECT_JS}
        onShouldStartLoadWithRequest={allowRequest}
        // Privacy: incognito keeps nothing PERSISTED across sessions. But video
        // players need JS, DOM storage, cookies (incl. third-party CDN cookies)
        // and inline playback to actually run — disabling those stopped videos
        // playing. Incognito still wipes it all when you leave.
        incognito
        javaScriptEnabled
        domStorageEnabled
        thirdPartyCookiesEnabled
        setSupportMultipleWindows={false}
        javaScriptCanOpenWindowsAutomatically={false}
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        allowsProtectedMedia
        allowsFullscreenVideo
        mixedContentMode="always"
        style={{ flex: 1, backgroundColor: "#000" }}
      />

      {/* immersive: a small floating handle to bring the address bar back */}
      {!chrome && (
        <Pressable onPress={() => setChrome(true)} style={{ position: "absolute", top: 8, left: 8, width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center" }}>
          <Ionicons name="contract-outline" size={20} color="#fff" />
        </Pressable>
      )}

      {/* play-tied download button: only while a video is actually playing */}
      {playing && streams.length > 0 && (
        <Pressable
          onPress={openGrabber}
          style={{ position: "absolute", right: 16, bottom: 22, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: theme.accent, paddingHorizontal: 16, height: 50, borderRadius: 25, shadowColor: "#000", shadowOpacity: 0.4, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 8 }}
        >
          {resolving ? <ActivityIndicator color={theme.accentText} /> : <Ionicons name="download" size={20} color={theme.accentText} />}
          <Text style={{ color: theme.accentText, fontWeight: "800", fontSize: 14 }}>Download this video</Text>
        </Pressable>
      )}

      {/* grabber: pick which stream (when more than one) then a format */}
      <Modal visible={grabberOpen} transparent animationType="slide" onRequestClose={() => setGrabberOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" }} onPress={() => { setGrabberOpen(false); setQuality(null); }}>
          <Pressable style={sheet} onPress={() => {}}>
            {!quality ? (
              <>
                <Text style={{ color: theme.text, fontSize: 18, fontWeight: "700", marginBottom: 4 }}>This video</Text>
                <Text style={{ color: theme.muted, fontSize: 13, marginBottom: 12 }}>Pick the stream to download — then choose a resolution.</Text>
                <ScrollView>
                  {streams.map((v) => (
                    <View key={v.url} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.border }}>
                      <Ionicons name={v.kind === "hls" ? "albums-outline" : "videocam-outline"} size={22} color={theme.accent} />
                      <Text numberOfLines={1} style={{ flex: 1, color: theme.text, fontSize: 13 }}>{titleFor(v)}</Text>
                      <Pressable onPress={() => { setGrabberOpen(false); setStreamingUrl({ url: v.url, name: titleFor(v) }); }} style={actBtn}>
                        <Ionicons name="play" size={16} color={theme.accent} />
                      </Pressable>
                      <Pressable onPress={() => chooseFormat(v)} style={actBtn}>
                        {resolving === v.url ? <ActivityIndicator size="small" color={theme.accent} /> : <Text style={actT}>Formats</Text>}
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
                <Text style={{ color: theme.text, fontSize: 18, fontWeight: "700", marginBottom: 12 }}>Choose resolution</Text>
                <ScrollView>
                  {quality.options.map((opt) => (
                    <Pressable key={opt.url + opt.label} onPress={() => pickQuality(quality.v, opt)} style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 13, paddingHorizontal: 8, borderRadius: 10, backgroundColor: pressed ? theme.surface : "transparent" })}>
                      <Ionicons name="download-outline" size={22} color={theme.accent} />
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: theme.text, fontSize: 16, fontWeight: "600" }}>{opt.label}</Text>
                        {opt.bandwidth ? <Text style={{ color: theme.muted, fontSize: 12 }}>~{Math.round(opt.bandwidth / 1000)} kbps{opt.width ? ` · ${opt.width}×${opt.height}` : ""}</Text> : null}
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

      {/* stream preview */}
      <Modal visible={!!streamingUrl} animationType="fade" onRequestClose={() => setStreamingUrl(null)}>
        {streamingUrl && (
          <View style={{ flex: 1, backgroundColor: "#000" }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingTop: 40, paddingHorizontal: 14, paddingBottom: 8 }}>
              <Pressable onPress={() => setStreamingUrl(null)} hitSlop={8}><Ionicons name="close" size={28} color="#fff" /></Pressable>
              <Text numberOfLines={1} style={{ flex: 1, color: "#fff", fontWeight: "700", fontSize: 16 }}>{streamingUrl.name}</Text>
              <Pressable onPress={() => { const v = streams.find((s) => s.url === streamingUrl.url); if (v) void chooseFormat(v); }} hitSlop={8} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Ionicons name="download" size={20} color={theme.accent2} />
                <Text style={{ color: theme.accent2, fontWeight: "800", fontSize: 14 }}>Download</Text>
              </Pressable>
            </View>
            <View style={{ flex: 1 }}><VideoPlayer uri={streamingUrl.url} /></View>
          </View>
        )}
      </Modal>

      {/* downloads list */}
      <Modal visible={downloadsOpen} transparent animationType="slide" onRequestClose={() => setDownloadsOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" }} onPress={() => setDownloadsOpen(false)}>
          <Pressable style={sheet} onPress={() => {}}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <Text style={{ color: theme.text, fontSize: 18, fontWeight: "700" }}>Downloads</Text>
              {downloads.some((d) => d.status !== "downloading") && (
                <Pressable onPress={() => setDownloads((d) => d.filter((x) => x.status === "downloading"))}>
                  <Text style={{ color: theme.accent, fontSize: 14 }}>Clear finished</Text>
                </Pressable>
              )}
            </View>
            <FlatList
              data={downloads}
              keyExtractor={(d) => d.id}
              style={{ maxHeight: 360 }}
              renderItem={({ item: d }) => (
                <View style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.border }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                    <Ionicons name={d.status === "done" ? "checkmark-circle" : d.status === "error" ? "alert-circle" : "cloud-download-outline"} size={20} color={d.status === "done" ? theme.good : d.status === "error" ? theme.danger : theme.accent} />
                    <Text numberOfLines={1} style={{ flex: 1, color: theme.text, fontSize: 14 }}>{d.name}</Text>
                    {d.status === "downloading" && <Text style={{ color: theme.muted, fontSize: 12 }}>{Math.round(d.fraction * 100)}%</Text>}
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

const badge = { position: "absolute" as const, top: -6, right: -8, backgroundColor: theme.accent, borderRadius: 8, minWidth: 16, height: 16, alignItems: "center" as const, justifyContent: "center" as const, paddingHorizontal: 3 };
const badgeT = { color: theme.accentText, fontSize: 10, fontWeight: "700" as const };
const sheet = { backgroundColor: theme.bg, borderTopLeftRadius: 18, borderTopRightRadius: 18, borderWidth: 1, borderColor: theme.border, padding: 18, maxHeight: "75%" as const };
const actBtn = { flexDirection: "row" as const, alignItems: "center" as const, gap: 5, backgroundColor: theme.surfaceAlt, paddingVertical: 7, paddingHorizontal: 11, borderRadius: 10 };
const actT = { color: theme.accent, fontWeight: "700" as const, fontSize: 13 };
