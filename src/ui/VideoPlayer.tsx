// Native video player over expo-av. Keeps the OS scrub bar / fullscreen / mute,
// and adds touch GESTURES over the left and right halves:
//   • vertical swipe on the RIGHT half  → volume
//   • vertical swipe on the LEFT half    → screen brightness
//   • horizontal swipe                   → previous / next clip
//   • double-tap left / right            → skip ∓10s
// A single tap falls through to the native controls (show/hide, play/pause).
import { useRef, useState } from "react";
import { PanResponder, Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ResizeMode, Video } from "expo-av";
import * as Brightness from "expo-brightness";
import { theme } from "./theme";

const RATES = [1, 1.25, 1.5, 2, 0.5];
const SWIPE = 70; // px of horizontal travel to count as a prev/next swipe

type Hud = { kind: "volume" | "brightness"; value: number } | null;

export function VideoPlayer({
  uri,
  onRequestNext,
  onRequestPrev,
}: {
  uri: string;
  onRequestNext?: () => void;
  onRequestPrev?: () => void;
}) {
  const ref = useRef<Video>(null);
  const [rate, setRate] = useState(1);
  const [loop, setLoop] = useState(false);
  const [autoNext, setAutoNext] = useState(false);
  const [volume, setVolume] = useState(1);
  const [hud, setHud] = useState<Hud>(null);
  const lastTap = useRef<{ side: "l" | "r" | ""; t: number }>({ side: "", t: 0 });
  const hudTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function cycleRate() {
    const next = RATES[(RATES.indexOf(rate) + 1) % RATES.length];
    setRate(next);
    ref.current?.setRateAsync(next, true).catch(() => {});
  }
  async function skip(deltaMs: number) {
    const s = await ref.current?.getStatusAsync();
    if (s?.isLoaded) {
      const pos = s.positionMillis ?? 0;
      const dur = s.durationMillis ?? Number.MAX_SAFE_INTEGER;
      await ref.current?.setPositionAsync(Math.max(0, Math.min(dur, pos + deltaMs)));
    }
  }
  function flashHud(h: Hud) {
    setHud(h);
    if (hudTimer.current) clearTimeout(hudTimer.current);
    hudTimer.current = setTimeout(() => setHud(null), 700);
  }

  // Build a pan responder for one side. Claims only on a real drag, so taps pass
  // through to the native controls underneath.
  function sideResponder(side: "l" | "r") {
    let startVol = 1;
    let startBright = 1;
    let mode: "" | "v" | "h" = "";
    return PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 8 || Math.abs(g.dy) > 8,
      onPanResponderGrant: async () => {
        mode = "";
        startVol = volume;
        try {
          startBright = await Brightness.getBrightnessAsync();
        } catch {
          startBright = 1;
        }
      },
      onPanResponderMove: (e, g) => {
        if (mode === "") mode = Math.abs(g.dy) > Math.abs(g.dx) ? "v" : "h";
        if (mode !== "v") return;
        const h = (e.nativeEvent as { layout?: { height?: number } }).layout?.height;
        const span = typeof h === "number" && h > 0 ? h : 260;
        const delta = -g.dy / span; // up = increase
        if (side === "r") {
          const v = Math.max(0, Math.min(1, startVol + delta));
          setVolume(v);
          flashHud({ kind: "volume", value: v });
        } else {
          const b = Math.max(0, Math.min(1, startBright + delta));
          Brightness.setBrightnessAsync(b).catch(() => {});
          flashHud({ kind: "brightness", value: b });
        }
      },
      onPanResponderRelease: (_e, g) => {
        if (mode === "h" && Math.abs(g.dx) > SWIPE) {
          if (g.dx < 0) onRequestNext?.(); // swipe left → next
          else onRequestPrev?.(); // swipe right → previous
        } else if (mode === "" || (mode === "v" && Math.abs(g.dx) < 6 && Math.abs(g.dy) < 6)) {
          // a tap that the responder claimed by accident → double-tap skip
          tapSide(side);
        }
      },
    });
  }
  function tapSide(side: "l" | "r") {
    const now = Date.now();
    if (lastTap.current.side === side && now - lastTap.current.t < 320) {
      void skip(side === "l" ? -10000 : 10000);
      lastTap.current = { side: "", t: 0 };
    } else {
      lastTap.current = { side, t: now };
    }
  }

  const left = useRef(sideResponder("l")).current;
  const right = useRef(sideResponder("r")).current;

  return (
    <View style={{ flex: 1 }}>
      <Video
        ref={ref}
        source={{ uri }}
        style={{ flex: 1 }}
        useNativeControls
        resizeMode={ResizeMode.CONTAIN}
        shouldPlay
        volume={volume}
        isLooping={loop}
        onPlaybackStatusUpdate={(s) => {
          if (s.isLoaded && s.didJustFinish && !loop && autoNext) onRequestNext?.();
        }}
      />

      {/* gesture zones — left half = brightness/prev, right half = volume/next.
          Sit clear of the center + bottom so the native controls stay tappable. */}
      <View {...left.panHandlers} style={{ position: "absolute", left: 0, top: 64, bottom: 120, width: "38%" }} />
      <View {...right.panHandlers} style={{ position: "absolute", right: 0, top: 64, bottom: 120, width: "38%" }} />

      {/* feature controls */}
      <View style={{ position: "absolute", top: 46, right: 14, flexDirection: "row", alignItems: "center", gap: 16 }}>
        <Pressable onPress={cycleRate} hitSlop={8}>
          <Text style={{ color: "#fff", fontWeight: "800", fontSize: 14 }}>{rate}×</Text>
        </Pressable>
        <Pressable onPress={() => setLoop((l) => !l)} hitSlop={8}>
          <Ionicons name="repeat" size={22} color={loop ? theme.accent2 : "#fff"} />
        </Pressable>
        {onRequestNext && (
          <Pressable onPress={() => setAutoNext((a) => !a)} hitSlop={8}>
            <Ionicons name="play-skip-forward" size={20} color={autoNext ? theme.accent2 : "#fff"} />
          </Pressable>
        )}
      </View>

      {/* on-screen feedback for volume / brightness while swiping */}
      {hud && (
        <View style={{ position: "absolute", alignSelf: "center", top: "44%", backgroundColor: "rgba(0,0,0,0.7)", borderRadius: 12, paddingHorizontal: 18, paddingVertical: 12, flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Ionicons name={hud.kind === "volume" ? (hud.value === 0 ? "volume-mute" : "volume-high") : "sunny"} size={22} color="#fff" />
          <View style={{ width: 90, height: 5, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.25)" }}>
            <View style={{ width: `${Math.round(hud.value * 100)}%`, height: 5, borderRadius: 3, backgroundColor: "#fff" }} />
          </View>
        </View>
      )}
    </View>
  );
}
