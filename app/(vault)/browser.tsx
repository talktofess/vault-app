import { useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, TextInput, View } from "react-native";
import { WebView, type WebViewNavigation } from "react-native-webview";
import { Ionicons } from "@expo/vector-icons";
import * as FileSystem from "expo-file-system";
import { useVault } from "../../src/state/VaultContext";
import { theme } from "../../src/ui/theme";
import { fromB64 } from "../../src/crypto/b64";

// In-app browser: watch/stream content inline (the WebView plays it), and save
// a copy of the current URL into the encrypted vault. Browsing history is NOT
// persisted anywhere — it lives only in WebView memory and is gone on lock.
function normalizeUrl(input: string): string {
  const t = input.trim();
  if (/^https?:\/\//i.test(t)) return t;
  if (t.includes(".") && !t.includes(" ")) return "https://" + t;
  return "https://duckduckgo.com/?q=" + encodeURIComponent(t);
}

export default function Browser() {
  const { vault } = useVault();
  const webRef = useRef<WebView>(null);
  const [input, setInput] = useState("");
  const [current, setCurrent] = useState("https://duckduckgo.com");
  const [uri, setUri] = useState("https://duckduckgo.com");
  const [loading, setLoading] = useState(false);
  const [canBack, setCanBack] = useState(false);
  const [downloading, setDownloading] = useState(false);

  function go() {
    const u = normalizeUrl(input);
    setUri(u);
  }

  function onNav(nav: WebViewNavigation) {
    setCurrent(nav.url);
    setInput(nav.url);
    setCanBack(nav.canGoBack);
  }

  // Download the current URL straight into the encrypted vault.
  async function download() {
    setDownloading(true);
    try {
      const name = current.split("/").pop()?.split("?")[0] || `download_${Date.now()}`;
      const tmp = FileSystem.cacheDirectory + `dl_${Date.now()}_${name}`;
      const res = await FileSystem.downloadAsync(current, tmp);
      const b64 = await FileSystem.readAsStringAsync(res.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const mime = res.headers["Content-Type"] || res.headers["content-type"];
      const isMedia = /image|video|audio/i.test(mime || "");
      await vault.addItem(isMedia ? "media" : "file", name, fromB64(b64), {
        mime,
        sourceUrl: current,
      });
      await FileSystem.deleteAsync(res.uri, { idempotent: true });
      Alert.alert("Saved to vault", `"${name}" is now stored encrypted${isMedia ? " in Media" : " in Files"}.`);
    } catch (e) {
      Alert.alert("Download failed", e instanceof Error ? e.message : "Could not download this URL.");
    } finally {
      setDownloading(false);
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
        <Pressable onPress={download} disabled={downloading}>
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
      <WebView
        ref={webRef}
        source={{ uri }}
        onNavigationStateChange={onNav}
        onLoadStart={() => setLoading(true)}
        onLoadEnd={() => setLoading(false)}
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        style={{ flex: 1, backgroundColor: theme.bg }}
      />
    </View>
  );
}
