import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { VaultProvider } from "../src/state/VaultContext";
import { theme } from "../src/ui/theme";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <VaultProvider>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: theme.bg },
            headerTintColor: theme.text,
            contentStyle: { backgroundColor: theme.bg },
            headerShadowVisible: false,
          }}
        >
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="chess" options={{ headerShown: false }} />
          <Stack.Screen name="onboarding" options={{ title: "Create your vault" }} />
          <Stack.Screen name="unlock" options={{ headerShown: false }} />
          <Stack.Screen name="(vault)" options={{ headerShown: false }} />
        </Stack>
      </VaultProvider>
    </SafeAreaProvider>
  );
}
