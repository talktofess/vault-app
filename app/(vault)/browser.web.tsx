// Web has no in-app browser / downloader by design — grabbing videos happens on
// the phone (a real embedded browser). On the computer you simply open synced
// items and cache them to local disk. This stub keeps the route resolvable on
// web (so the native browser.tsx, which needs react-native-webview, is never
// bundled here) but the tab itself is hidden from the web tab bar.
import { Ionicons } from "@expo/vector-icons";
import { View } from "react-native";
import { router } from "expo-router";
import { Button, Muted, Screen, Title } from "../../src/ui/components";
import { theme } from "../../src/ui/theme";

export default function BrowserWeb() {
  return (
    <Screen>
      <View style={{ alignItems: "center", gap: 14, marginTop: 24 }}>
        <Ionicons name="phone-portrait-outline" size={48} color={theme.accent} />
        <Title>Downloads happen on your phone</Title>
        <Muted>
          Grab videos in the phone app&apos;s in-app browser. Once they sync, they show up
          in your Vault here — open one to cache it to this computer.
        </Muted>
        <Button label="Go to Vault" onPress={() => router.replace("/(vault)/library")} />
      </View>
    </Screen>
  );
}
