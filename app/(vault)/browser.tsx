import { useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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
import { useVault } from "../../src/state/VaultContext";
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

export default function Browser() {
  const { vault } = useVault();
  const webRef = useRef<WebView>(null);
  const [input, setInput] = useState("");
  const [current, setCurrent] = useState("https://duckduckgo.com");
  const [uri, setUri] = useState("https://duckduckgo.com");
  const [loading, setLoading] = useState(false);
  const [canBack, setCanBack] = useState(false);
  const [downloading, setDownloading] = useState(false);

  // detected videos on the current page
  const [found, setFound] = useState<DetectedVideo[]>([]);
  // picker modal: either the list of sources, or the quality list for one source
  const [pickerOpen, setPickerOpen] = useState(false);
  const [quality, setQuality] = useState<{ v: DetectedVideo; options: HlsVariant[] } | null>(null);
  const [resolving, setResolving] = useState(false);
  // active background download
  const [dl, setDl] = useState<{ name: string; fraction: number } | null>(null);

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

  // Generic: download whatever the address bar points at (a direct file link).
  async function downloadCurrent() {
    setDownloading(true);
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
      setDownloading(false);
    }
  }

  // Step 1: user tapped a detected source → resolve its quality options.
  async function pickSource(v: DetectedVideo) {
    setResolving(true);
    try {
      const options = await qualityOptions(v);
      setQuality({ v, options });
    } catch (e) {
      Alert.alert("Couldn't read this video", e instanceof Error ? e.message : "Failed to load qualities.");
    } finally {
      setResolving(false);
    }
  }

  // Step 2: user picked a quality → download in the background into the vault.
  async function startDownload(v: DetectedVideo, opt: HlsVariant) {
    if (dl) {
      Alert.alert("Hold on", "A download is already running. Let it finish first.");
      return;
    }
    setPickerOpen(false);
    setQuality(null);
    const { name, mime } = describeDownload(v, opt.label);
    setDl({ name, fraction: 0 });
    try {
      const onProgress = (f: number) => setDl((d) => (d ? { ...d, fraction: f } : d));
      const bytes =
        v.kind === "hls"
          ? await downloadHls(opt.url, onProgress)
          : await downloadProgressive(opt.url, onProgress);
      await vault.addItem("media", name, bytes, { mime, sourceUrl: v.url });
      Alert.alert("Saved to vault", `"${name}" is encrypted in Media — it never appears in your gallery.`);
    } catch (e) {
      Alert.alert("Download failed", e instanceof Error ? e.message : "Could not download this video.");
    } finally {
      setDl(null);
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
        {/* Video grabber — only shown when fetchable videos are detected. */}
        {found.length > 0 && (
          <Pressable onPress={() => setPickerOpen(true)}>
            <View>
              <Ionicons name="film-outline" size={24} color={theme.accent} />
              <View
                style={{
                  position: "absolute",
                  top: -6,
                  right: -8,
                  backgroundColor: theme.accent,
                  borderRadius: 8,
                  minWidth: 16,
                  height: 16,
                  alignItems: "center",
                  justifyContent: "center",
                  paddingHorizontal: 3,
                }}
              >
                <Text style={{ color: "#0e0f13", fontSize: 10, fontWeight: "700" }}>{found.length}</Text>
              </View>
            </View>
          </Pressable>
        )}
        <Pressable onPress={downloadCurrent} disabled={downloading}>
          {downloading ? (
            <ActivityIndicator color={theme.accent} />
          ) : (
            <Ionicons name="download-outline" size={24} color={theme.accent} />
          )}
        </Pressable>
      </View>

      {loading && (
        <ActivityIndicator color={theme.accent} style={{ position: "absolute", top: 56, alignSelf: "center", zIndex: 10 }} />
      )}

      {/* Background-download progress banner — browsing/watching continues. */}
      {dl && (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            backgroundColor: theme.surface,
            paddingHorizontal: 12,
            paddingVertical: 8,
            borderBottomWidth: 1,
            borderBottomColor: theme.border,
          }}
        >
          <ActivityIndicator color={theme.accent} />
          <Text numberOfLines={1} style={{ color: theme.text, flex: 1, fontSize: 12 }}>
            Downloading {dl.name} · {Math.round(dl.fraction * 100)}%
          </Text>
        </View>
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

      {/* Video source / quality picker */}
      <Modal visible={pickerOpen} transparent animationType="slide" onRequestClose={() => setPickerOpen(false)}>
        <Pressable
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" }}
          onPress={() => {
            setPickerOpen(false);
            setQuality(null);
          }}
        >
          <Pressable
            style={{
              backgroundColor: theme.bg,
              borderTopLeftRadius: 18,
              borderTopRightRadius: 18,
              borderWidth: 1,
              borderColor: theme.border,
              padding: 18,
              maxHeight: "70%",
            }}
            onPress={() => {}}
          >
            {!quality ? (
              <>
                <Text style={{ color: theme.text, fontSize: 18, fontWeight: "700", marginBottom: 4 }}>
                  Download video
                </Text>
                <Text style={{ color: theme.muted, fontSize: 13, marginBottom: 12 }}>
                  {found.length} source{found.length === 1 ? "" : "s"} found on this page. Pick one
                  {resolving ? " · loading…" : ""}.
                </Text>
                <ScrollView>
                  {found.map((v) => (
                    <Row
                      key={v.url}
                      icon={v.kind === "hls" ? "albums-outline" : "videocam-outline"}
                      title={titleFor(v)}
                      subtitle={v.kind === "hls" ? "Adaptive stream · choose a quality" : "Direct file"}
                      onPress={() => pickSource(v)}
                    />
                  ))}
                </ScrollView>
              </>
            ) : (
              <>
                <Pressable onPress={() => setQuality(null)} style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 }}>
                  <Ionicons name="chevron-back" size={18} color={theme.accent} />
                  <Text style={{ color: theme.accent, fontSize: 14 }}>Back</Text>
                </Pressable>
                <Text style={{ color: theme.text, fontSize: 18, fontWeight: "700", marginBottom: 12 }}>
                  Choose quality
                </Text>
                <ScrollView>
                  {quality.options.map((opt) => (
                    <Row
                      key={opt.url + opt.label}
                      icon="download-outline"
                      title={opt.label}
                      subtitle={
                        opt.bandwidth ? `~${Math.round(opt.bandwidth / 1000)} kbps${opt.width ? ` · ${opt.width}×${opt.height}` : ""}` : undefined
                      }
                      onPress={() => startDownload(quality.v, opt)}
                    />
                  ))}
                </ScrollView>
              </>
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

function Row({
  icon,
  title,
  subtitle,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
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
      <Ionicons name={icon} size={22} color={theme.accent} />
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={{ color: theme.text, fontSize: 15 }}>
          {title}
        </Text>
        {subtitle ? <Text style={{ color: theme.muted, fontSize: 12 }}>{subtitle}</Text> : null}
      </View>
      <Ionicons name="chevron-forward" size={18} color={theme.muted} />
    </Pressable>
  );
}
