// Web video trimmer. Uses a real <video> element (not expo-av) so we fully
// control sizing/centering, and read duration/position straight off the DOM.
// The cut runs in ffmpeg.wasm (src/platform/trim.web.ts). RN primitives render
// the chrome; the video is a host element since this app runs on React DOM.
import { createElement, useRef, useState } from "react";
import { ActivityIndicator, Modal, Pressable, Text, View, type DimensionValue } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { trimVideo } from "../platform/trim";
import { theme } from "./theme";

function fmt(ms: number): string {
  if (!isFinite(ms) || ms < 0) ms = 0;
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  const cs = Math.floor((ms % 1000) / 100);
  return `${m}:${s.toString().padStart(2, "0")}.${cs}`;
}

export function TrimModal({
  uri,
  bytes,
  mime,
  name,
  onCancel,
  onApply,
}: {
  uri: string;
  bytes: Uint8Array;
  mime?: string;
  name: string;
  onCancel: () => void;
  onApply: (out: Uint8Array) => void;
}) {
  const vid = useRef<HTMLVideoElement | null>(null);
  const [dur, setDur] = useState(0);
  const [pos, setPos] = useState(0);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  const [working, setWorking] = useState(false);
  const [progress, setProgress] = useState(0);
  const [err, setErr] = useState<string | null>(null);

  const seg = Math.max(0, end - start);
  const canApply = dur > 0 && seg >= 200 && !working;
  const pct = (ms: number): DimensionValue =>
    (dur > 0 ? `${Math.max(0, Math.min(100, (ms / dur) * 100))}%` : "0%") as DimensionValue;

  function onMeta() {
    const d = (vid.current?.duration ?? 0) * 1000;
    if (isFinite(d) && d > 0) {
      setDur(d);
      setEnd((e) => (e === 0 ? d : e));
    }
  }
  function onTime() {
    const p = (vid.current?.currentTime ?? 0) * 1000;
    setPos(p);
    if (end > 0 && p >= end && vid.current && !vid.current.paused) vid.current.pause();
  }
  function preview() {
    if (!vid.current) return;
    vid.current.currentTime = start / 1000;
    void vid.current.play();
  }

  async function apply() {
    if (!canApply) return;
    setErr(null);
    setWorking(true);
    setProgress(0);
    try {
      const out = await trimVideo(bytes, mime, start / 1000, end / 1000, setProgress);
      onApply(out);
    } catch (e: any) {
      setErr(e?.message || "Couldn't trim this video.");
      setWorking(false);
    }
  }

  const videoEl = createElement("video", {
    ref: vid,
    src: uri,
    controls: true,
    onLoadedMetadata: onMeta,
    onDurationChange: onMeta,
    onTimeUpdate: onTime,
    style: { width: "100%", height: "100%", objectFit: "contain", background: "#000" },
  });

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      <View style={{ flex: 1, backgroundColor: "#000" }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingTop: 40, paddingHorizontal: 14, paddingBottom: 8 }}>
          <Pressable onPress={onCancel} hitSlop={8} disabled={working}>
            <Ionicons name="close" size={28} color="#fff" />
          </Pressable>
          <Text numberOfLines={1} style={{ flex: 1, color: "#fff", fontWeight: "700", fontSize: 16 }}>
            Trim · {name}
          </Text>
          <Pressable onPress={apply} hitSlop={8} disabled={!canApply}>
            <Text style={{ color: canApply ? theme.accent2 : "rgba(255,255,255,0.4)", fontSize: 16, fontWeight: "800" }}>
              {working ? "Trimming…" : "Done"}
            </Text>
          </Pressable>
        </View>

        <View style={{ flex: 1, paddingHorizontal: 14 }}>{videoEl}</View>

        <View style={{ paddingHorizontal: 18, paddingTop: 14 }}>
          <View style={{ height: 8, borderRadius: 4, backgroundColor: "rgba(255,255,255,0.18)", justifyContent: "center" }}>
            <View style={{ position: "absolute", left: pct(start), width: pct(seg), height: 8, borderRadius: 4, backgroundColor: theme.accent2 }} />
            <View style={{ position: "absolute", left: pct(pos), width: 2, height: 16, marginTop: -4, backgroundColor: "#fff" }} />
          </View>
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 8 }}>
            <Text style={{ color: theme.accent2, fontSize: 12, fontWeight: "700" }}>Start {fmt(start)}</Text>
            <Text style={{ color: "#fff", fontSize: 12 }}>Selected {fmt(seg)}</Text>
            <Text style={{ color: theme.accent2, fontSize: 12, fontWeight: "700" }}>End {fmt(end)}</Text>
          </View>
        </View>

        <View style={{ flexDirection: "row", justifyContent: "center", gap: 10, paddingHorizontal: 14, paddingTop: 16, flexWrap: "wrap" }}>
          <TrimBtn label="Set start" sub="= playhead" onPress={() => setStart(Math.min(pos, end))} disabled={working} />
          <TrimBtn icon="play" label="Preview" onPress={preview} disabled={working} />
          <TrimBtn label="Set end" sub="= playhead" onPress={() => setEnd(Math.max(pos, start + 200))} disabled={working} />
        </View>

        <View style={{ paddingHorizontal: 18, paddingTop: 18, paddingBottom: 40 }}>
          {working ? (
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 }}>
              <ActivityIndicator color={theme.accent2} />
              <Text style={{ color: "#fff", fontSize: 13 }}>
                Trimming… {progress > 0 ? `${Math.round(progress * 100)}%` : "preparing"}
              </Text>
            </View>
          ) : (
            <Text style={{ color: "rgba(255,255,255,0.55)", fontSize: 12, textAlign: "center" }}>
              Scrub the video, then mark a start and end. The cut is lossless and lands on the nearest keyframe.
            </Text>
          )}
          {err ? <Text style={{ color: theme.danger, fontSize: 13, marginTop: 10, textAlign: "center" }}>{err}</Text> : null}
        </View>
      </View>
    </Modal>
  );
}

function TrimBtn({
  label,
  sub,
  icon,
  onPress,
  disabled,
}: {
  label: string;
  sub?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        backgroundColor: "rgba(255,255,255,0.1)",
        paddingVertical: 10,
        paddingHorizontal: 16,
        borderRadius: 12,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {icon ? <Ionicons name={icon} size={16} color="#fff" /> : null}
      <Text style={{ color: "#fff", fontWeight: "700", fontSize: 13 }}>{label}</Text>
      {sub ? <Text style={{ color: "rgba(255,255,255,0.5)", fontSize: 11 }}>{sub}</Text> : null}
    </Pressable>
  );
}
