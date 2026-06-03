// Web video player: a real <video> that fills the viewer (expo-av's web element
// won't stretch in a flex column, which left playback pinned tiny in a corner).
// The browser's own controls give scrub, fullscreen, volume and speed. We don't
// auto-advance on end — the user moves between clips via the "up next" list or
// the side arrows, so playback never jumps somewhere unexpected on its own.
import { createElement, useRef } from "react";
import { View } from "react-native";

export function VideoPlayer({ uri }: { uri: string; onRequestNext?: () => void }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const videoEl = createElement("video", {
    ref,
    src: uri,
    controls: true,
    autoPlay: true,
    playsInline: true,
    style: { width: "100%", height: "100%", objectFit: "contain", background: "#000" },
  });
  return <View style={{ flex: 1 }}>{videoEl}</View>;
}
