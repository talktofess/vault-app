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

  async function readStream(res: Response): Promise<{ bytes: Uint8Array; mime?: string }> {
    const mime = res.headers.get("content-type") || undefined;
    const total = Number(res.headers.get("content-length")) || 0;
    const reader = res.body?.getReader();
    if (!reader) return { bytes: new Uint8Array(await res.arrayBuffer()), mime };
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

  // Try the server proxy first (fetches server-side, bypassing CORS), then fall
  // back to a direct browser fetch (works for CORS-friendly hosts, and for local
  // dev where the /api function isn't deployed).
  async function fetchBytes(target: string): Promise<{ bytes: Uint8Array; mime?: string }> {
    const sources = [`/api/grab?url=${encodeURIComponent(target)}`, target];
    let lastErr: unknown;
    for (const src of sources) {
      try {
        const res = await fetch(src);
        if (!res.ok) {
          lastErr = new Error(`HTTP ${res.status}`);
          continue;
        }
        return await readStream(res);
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error("Could not fetch this URL.");
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
          ? "Couldn't fetch that link. Direct file URLs work (the proxy bypasses CORS); pages that need a login, or DRM/streaming sites (YouTube, etc.), won't — grab those from the phone app's in-app browser."
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
        Paste a direct link to a file or video — it&apos;s fetched (through a lightweight
        proxy on this site, so cross-origin/CORS blocks don&apos;t matter), then stored
        encrypted in the vault. The web can&apos;t embed and browse other sites, so
        DRM/streaming pages (YouTube, etc.) still won&apos;t work here — use the phone
        app&apos;s in-app browser for those.
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
