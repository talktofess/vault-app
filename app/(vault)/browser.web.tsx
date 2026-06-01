import { useState } from "react";
import { ActivityIndicator, Alert, Text, View } from "react-native";
import { useVault } from "../../src/state/VaultContext";
import { Button, Field, Muted, Screen, Title } from "../../src/ui/components";
import { theme } from "../../src/ui/theme";

// Web has no embeddable in-app browser (other sites refuse to load in a frame
// and the browser's same-origin policy blocks reading or fetching their video).
// So on web the "Browse" tab becomes a direct-URL grabber: paste a direct link
// to a file or video and it's fetched and stored ENCRYPTED in the vault. No
// server is involved — your browser does the fetch — so it only works for links
// whose host allows cross-origin requests (CORS). DRM/streaming sites won't.
function nameFromUrl(url: string): string {
  try {
    const tail = decodeURIComponent(url.split("#")[0].split("?")[0].split("/").pop() || "");
    return tail || `download_${Date.now()}`;
  } catch {
    return `download_${Date.now()}`;
  }
}

export default function BrowserWeb() {
  const { vault } = useVault();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);

  async function fetchBytes(target: string): Promise<{ bytes: Uint8Array; mime?: string }> {
    const res = await fetch(target);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const mime = res.headers.get("content-type") || undefined;
    const total = Number(res.headers.get("content-length")) || 0;
    const reader = res.body?.getReader();
    if (!reader) {
      const buf = new Uint8Array(await res.arrayBuffer());
      return { bytes: buf, mime };
    }
    const chunks: Uint8Array[] = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        received += value.length;
        if (total > 0) setProgress(received / total);
      }
    }
    let len = 0;
    for (const c of chunks) len += c.length;
    const bytes = new Uint8Array(len);
    let off = 0;
    for (const c of chunks) {
      bytes.set(c, off);
      off += c.length;
    }
    return { bytes, mime };
  }

  async function download() {
    const target = url.trim();
    if (!/^https?:\/\//i.test(target)) {
      Alert.alert("Enter a URL", "Paste a direct https:// link to a file or video.");
      return;
    }
    setBusy(true);
    setProgress(0);
    try {
      const { bytes, mime } = await fetchBytes(target);
      const name = nameFromUrl(target);
      const isMedia = /image|video|audio/i.test(mime || "") || /\.(mp4|webm|mov|m4v|jpg|jpeg|png|gif|webp|mp3|wav)$/i.test(name);
      await vault.addItem(isMedia ? "media" : "file", name, bytes, { mime, sourceUrl: target });
      setUrl("");
      Alert.alert("Saved to vault", `"${name}" is encrypted in ${isMedia ? "Media" : "Files"} — it never appears in your gallery.`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not download.";
      Alert.alert(
        "Download failed",
        /Failed to fetch|NetworkError|CORS/i.test(msg)
          ? "That host blocks cross-origin downloads (CORS), so the browser can't fetch it. Direct file links from CORS-friendly hosts work; DRM/streaming sites won't."
          : msg
      );
    } finally {
      setBusy(false);
      setProgress(0);
    }
  }

  return (
    <Screen>
      <Title>Download to vault</Title>
      <Muted>
        Paste a direct link to a file or video. It&apos;s fetched by your browser and
        stored encrypted in the vault — nothing goes through any server. Because the
        web can&apos;t embed other sites, this works only for direct links from hosts that
        allow cross-origin downloads; DRM/streaming sites (YouTube, etc.) won&apos;t.
      </Muted>
      <Field
        value={url}
        onChangeText={setUrl}
        placeholder="https://example.com/video.mp4"
      />
      <Button label={busy ? "Downloading…" : "Save to vault"} onPress={download} loading={busy} />
      {busy && progress > 0 && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <ActivityIndicator color={theme.accent} />
          <Text style={{ color: theme.muted }}>{Math.round(progress * 100)}%</Text>
        </View>
      )}
    </Screen>
  );
}
