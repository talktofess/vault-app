// In-app camera: capture a photo straight into the encrypted vault. The image
// never touches the device gallery / camera roll, so there's nothing to delete
// afterward — it goes from sensor to ciphertext.
import { useRef, useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { CameraView, useCameraPermissions, type CameraType } from "expo-camera";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useVault } from "../../src/state/VaultContext";
import { Button, Muted, Screen, Title } from "../../src/ui/components";
import { theme } from "../../src/ui/theme";
import { compressImage } from "../../src/platform/media";

export default function Camera() {
  const { vault } = useVault();
  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState<CameraType>("back");
  const [busy, setBusy] = useState(false);
  const camRef = useRef<CameraView>(null);

  if (!permission) {
    return (
      <Screen>
        <Title>Camera</Title>
        <Muted>Checking camera permission…</Muted>
      </Screen>
    );
  }

  if (!permission.granted) {
    return (
      <Screen>
        <Title>Camera</Title>
        <Muted>Allow camera access to capture photos directly into the vault.</Muted>
        <Button label="Grant camera access" onPress={requestPermission} />
      </Screen>
    );
  }

  async function capture() {
    if (!camRef.current || busy) return;
    setBusy(true);
    try {
      const photo = await camRef.current.takePictureAsync({ quality: 1 });
      const uri = photo?.uri;
      if (!uri) return;
      const bytes = await compressImage(uri); // compress before encrypting
      await vault.addItem("media", `camera_${Date.now()}.jpg`, bytes, { mime: "image/jpeg" });
      Alert.alert("Saved", "Photo encrypted and stored in Media.", [
        { text: "Take another" },
        { text: "Done", onPress: () => router.replace("/(vault)/media") },
      ]);
    } catch (e) {
      Alert.alert("Capture failed", e instanceof Error ? e.message : "Could not capture.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <CameraView ref={camRef} style={{ flex: 1 }} facing={facing} />
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-around",
          paddingVertical: 24,
          backgroundColor: theme.bg,
        }}
      >
        <Pressable onPress={() => setFacing(facing === "back" ? "front" : "back")}>
          <Ionicons name="camera-reverse-outline" size={30} color={theme.text} />
        </Pressable>
        <Pressable
          onPress={capture}
          disabled={busy}
          style={{
            width: 68,
            height: 68,
            borderRadius: 34,
            backgroundColor: busy ? theme.muted : theme.accent,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons name="camera" size={32} color="#0e0f13" />
        </Pressable>
        <Pressable onPress={() => router.replace("/(vault)/media")}>
          <Ionicons name="close" size={30} color={theme.text} />
        </Pressable>
      </View>
    </View>
  );
}
