import { Platform, Pressable, Text, View } from "react-native";
import { Redirect, Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useVault } from "../../src/state/VaultContext";
import { theme } from "../../src/ui/theme";

const isWeb = Platform.OS === "web";
const RAIL = 76; // width of the vertical tab rail

// The visible destinations, in order, for the side rail. (Hidden routes like
// media/notes/files/cloud aren't listed; camera/browser are native-only.)
type Dest = { name: string; label: string; icon: keyof typeof Ionicons.glyphMap };
const DESTS: Dest[] = [
  { name: "library", label: "Vault", icon: "albums-outline" },
  { name: "passwords", label: "Keys", icon: "key-outline" },
  ...(!isWeb ? ([{ name: "camera", label: "Camera", icon: "camera-outline" }] as Dest[]) : []),
  ...(!isWeb ? ([{ name: "browser", label: "Browse", icon: "globe-outline" }] as Dest[]) : []),
  { name: "settings", label: "Settings", icon: "settings-outline" },
];

// Vertical tab rail on the left, replacing the default bottom bar.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function SideRail({ state, navigation }: any) {
  const activeName: string | undefined = state.routes[state.index]?.name;
  return (
    <View
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        bottom: 0,
        width: RAIL,
        backgroundColor: theme.bgElevated,
        borderRightWidth: 1,
        borderRightColor: theme.border,
        paddingTop: 54,
        gap: 4,
      }}
    >
      {DESTS.map((d) => {
        const focused = activeName === d.name;
        return (
          <Pressable
            key={d.name}
            onPress={() => navigation.navigate(d.name)}
            style={{
              marginHorizontal: 8,
              paddingVertical: 12,
              borderRadius: theme.radiusSm,
              alignItems: "center",
              gap: 4,
              backgroundColor: focused ? theme.surfaceAlt : "transparent",
            }}
          >
            <Ionicons name={d.icon} size={22} color={focused ? theme.accent : theme.muted} />
            <Text style={{ color: focused ? theme.accent : theme.muted, fontSize: 10, fontWeight: "600" }}>{d.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function VaultTabs() {
  const { unlocked } = useVault();
  // A direct page load (e.g. refreshing /library) starts locked with no key in
  // memory — bounce to the gate so the user unlocks and their items load,
  // instead of rendering an empty vault.
  if (!unlocked) return <Redirect href="/" />;

  return (
    <Tabs
      tabBar={(props) => <SideRail {...props} />}
      sceneContainerStyle={{ paddingLeft: RAIL, backgroundColor: theme.bg }}
      screenOptions={{
        headerStyle: { backgroundColor: theme.bg },
        headerTintColor: theme.text,
        headerTitleStyle: { fontWeight: "800", letterSpacing: -0.3 },
        headerShadowVisible: false,
      }}
    >
      <Tabs.Screen name="library" options={{ title: "Vault", headerShown: false }} />
      {/* media / notes / files unified into Library; routes stay registered but hidden */}
      <Tabs.Screen name="media" options={{ href: null, title: "Media" }} />
      <Tabs.Screen name="notes" options={{ href: null, title: "Notes" }} />
      <Tabs.Screen name="files" options={{ href: null, title: "Files" }} />
      <Tabs.Screen name="cloud" options={{ href: null, title: "Cloud sync" }} />
      <Tabs.Screen name="passwords" options={{ title: "Keys", headerShown: false }} />
      <Tabs.Screen name="camera" options={{ title: "Camera", href: isWeb ? null : undefined }} />
      <Tabs.Screen name="browser" options={{ title: "Browse", href: isWeb ? null : undefined }} />
      <Tabs.Screen name="settings" options={{ title: "Settings", headerShown: false }} />
    </Tabs>
  );
}
