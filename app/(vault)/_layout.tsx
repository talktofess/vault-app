import { Platform, Pressable, Text, useWindowDimensions, View } from "react-native";
import { Redirect, Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useVault } from "../../src/state/VaultContext";
import { theme } from "../../src/ui/theme";

const isWeb = Platform.OS === "web";
const RAIL = 76; // width of the vertical tab rail (wide screens)
const BAR = 62; // height of the bottom tab bar (narrow screens / phones)
const NARROW = 720; // below this width, use a bottom bar instead of the side rail

// The visible destinations, in order. (Hidden routes like media/notes/files/
// cloud aren't listed; camera/browser are native-only.)
type Dest = { name: string; label: string; icon: keyof typeof Ionicons.glyphMap };
const DESTS: Dest[] = [
  { name: "library", label: "Vault", icon: "albums-outline" },
  { name: "passwords", label: "Keys", icon: "key-outline" },
  ...(!isWeb ? ([{ name: "camera", label: "Camera", icon: "camera-outline" }] as Dest[]) : []),
  ...(!isWeb ? ([{ name: "browser", label: "Browse", icon: "globe-outline" }] as Dest[]) : []),
  { name: "settings", label: "Settings", icon: "settings-outline" },
];

// One tab bar that adapts: a slim bottom bar on phones/narrow windows (so it
// doesn't eat horizontal space), a vertical rail on wide screens.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function AppTabBar({ state, navigation, bottom }: any) {
  const activeName: string | undefined = state.routes[state.index]?.name;
  const items = DESTS.map((d) => {
    const focused = activeName === d.name;
    return (
      <Pressable
        key={d.name}
        onPress={() => navigation.navigate(d.name)}
        style={{
          flex: bottom ? 1 : undefined,
          marginHorizontal: bottom ? 0 : 8,
          paddingVertical: bottom ? 6 : 12,
          borderRadius: theme.radiusSm,
          alignItems: "center",
          justifyContent: "center",
          gap: 3,
          backgroundColor: !bottom && focused ? theme.surfaceAlt : "transparent",
        }}
      >
        <Ionicons name={d.icon} size={focused ? 23 : 22} color={focused ? theme.accent : theme.muted} />
        <Text style={{ color: focused ? theme.accent : theme.muted, fontSize: 10, fontWeight: "600" }}>{d.label}</Text>
      </Pressable>
    );
  });

  if (bottom) {
    return (
      <View
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: BAR,
          flexDirection: "row",
          alignItems: "center",
          backgroundColor: theme.bgElevated,
          borderTopWidth: 1,
          borderTopColor: theme.border,
        }}
      >
        {items}
      </View>
    );
  }
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
      {items}
    </View>
  );
}

export default function VaultTabs() {
  const { unlocked } = useVault();
  const { width } = useWindowDimensions();
  const bottom = width < NARROW;
  // A direct page load (e.g. refreshing /library) starts locked with no key in
  // memory — bounce to the gate so the user unlocks and their items load,
  // instead of rendering an empty vault.
  if (!unlocked) return <Redirect href="/" />;

  return (
    <Tabs
      tabBar={(props) => <AppTabBar {...props} bottom={bottom} />}
      sceneContainerStyle={bottom ? { paddingBottom: BAR, backgroundColor: theme.bg } : { paddingLeft: RAIL, backgroundColor: theme.bg }}
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
