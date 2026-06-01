// Gate screen: decides where to send the user on launch.
import { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";
import { router } from "expo-router";
import { useVault } from "../src/state/VaultContext";
import { theme } from "../src/ui/theme";

export default function Index() {
  const { vault, unlocked } = useVault();

  useEffect(() => {
    let active = true;
    (async () => {
      const exists = await vault.exists();
      if (!active) return;
      if (!exists) router.replace("/onboarding");
      else if (unlocked) router.replace("/(vault)/library");
      // When locked, show the chess disguise — not the unlock screen. The
      // secret tap sequence on the board leads to /unlock.
      else router.replace("/chess");
    })();
    return () => {
      active = false;
    };
  }, [vault, unlocked]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, justifyContent: "center" }}>
      <ActivityIndicator color={theme.accent} size="large" />
    </View>
  );
}
