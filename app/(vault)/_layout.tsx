import { Platform } from "react-native";
import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "../../src/ui/theme";

const isWeb = Platform.OS === "web";

export default function VaultTabs() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: theme.bg },
        headerTintColor: theme.text,
        headerTitleStyle: { fontWeight: "800", letterSpacing: -0.3 },
        headerShadowVisible: false,
        tabBarStyle: {
          backgroundColor: theme.bgElevated,
          borderTopColor: theme.border,
          height: 64,
          paddingTop: 8,
          paddingBottom: 10,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
        tabBarActiveTintColor: theme.accent,
        tabBarInactiveTintColor: theme.muted,
      }}
    >
      <Tabs.Screen
        name="library"
        options={{
          title: "Vault",
          tabBarIcon: ({ color, size }) => <Ionicons name="albums-outline" size={size} color={color} />,
        }}
      />
      {/* media / notes / files are now unified into the Library ("Vault") tab.
          The routes stay registered (deep links / in-app navigation still work)
          but are hidden from the tab bar to keep one place for everything. */}
      <Tabs.Screen name="media" options={{ href: null, title: "Media" }} />
      <Tabs.Screen name="notes" options={{ href: null, title: "Notes" }} />
      <Tabs.Screen name="files" options={{ href: null, title: "Files" }} />
      {/* reachable from Settings via router.push, not a tab */}
      <Tabs.Screen name="cloud" options={{ href: null, title: "Cloud sync" }} />
      <Tabs.Screen
        name="passwords"
        options={{
          title: "Keys",
          tabBarIcon: ({ color, size }) => <Ionicons name="key-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="camera"
        options={{
          title: "Camera",
          // The in-app camera is native-only; hide its tab on web (the route
          // still exists as a placeholder).
          href: isWeb ? null : undefined,
          tabBarIcon: ({ color, size }) => <Ionicons name="camera-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="browser"
        options={{
          title: "Browse",
          // Downloading is phone-only; hide this tab on web (route still resolves
          // to the web stub so the native WebView screen isn't bundled there).
          href: isWeb ? null : undefined,
          tabBarIcon: ({ color, size }) => <Ionicons name="globe-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarIcon: ({ color, size }) => <Ionicons name="settings-outline" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
