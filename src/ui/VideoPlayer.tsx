// A fuller video/audio player over expo-av: native scrub bar + fullscreen, plus
// playback speed, loop, auto-play-next, and double-tap-to-skip (±10s) on the
// left/right thirds (the center stays free to toggle the native controls).
import { useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ResizeMode, Video } from "expo-av";
import { theme } from "./theme";

const RATES = [1, 1.25, 1.5, 2, 0.5];

export function VideoPlayer({ uri, onRequestNext }: { uri: string; onRequestNext?: () => void }) {
  const ref = useRef<Video>(null);
  const [rate, setRate] = useState(1);
  const [loop, setLoop] = useState(false);
  const [autoNext, setAutoNext] = useState(false);
  const lastTap = useRef<{ side: "l" | "r" | ""; t: number }>({ side: "", t: 0 });

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

  function tapSide(side: "l" | "r") {
    const now = Date.now();
    if (lastTap.current.side === side && now - lastTap.current.t < 300) {
      void skip(side === "l" ? -10000 : 10000);
      lastTap.current = { side: "", t: 0 };
    } else {
      lastTap.current = { side, t: now };
    }
  }

  return (
    <View style={{ flex: 1 }}>
      <Video
        ref={ref}
        source={{ uri }}
        style={{ flex: 1 }}
        useNativeControls
        resizeMode={ResizeMode.CONTAIN}
        shouldPlay
        isLooping={loop}
        onPlaybackStatusUpdate={(s) => {
          if (s.isLoaded && s.didJustFinish && !loop && autoNext) onRequestNext?.();
        }}
      />

      {/* double-tap zones (center column left free for the native controls) */}
      <Pressable onPress={() => tapSide("l")} style={{ position: "absolute", left: 0, top: 70, bottom: 130, width: "30%" }} />
      <Pressable onPress={() => tapSide("r")} style={{ position: "absolute", right: 0, top: 70, bottom: 130, width: "30%" }} />

      {/* feature controls */}
      <View style={{ position: "absolute", top: 46, right: 14, flexDirection: "row", alignItems: "center", gap: 16 }}>
        <Pressable onPress={cycleRate} hitSlop={8}>
          <Text style={{ color: "#fff", fontWeight: "800", fontSize: 14 }}>{rate}×</Text>
        </Pressable>
        <Pressable onPress={() => setLoop((l) => !l)} hitSlop={8}>
          <Ionicons name="repeat" size={22} color={loop ? theme.accent : "#fff"} />
        </Pressable>
        {onRequestNext && (
          <Pressable onPress={() => setAutoNext((a) => !a)} hitSlop={8}>
            <Ionicons name="play-skip-forward" size={20} color={autoNext ? theme.accent : "#fff"} />
          </Pressable>
        )}
      </View>
    </View>
  );
}
