// react-native-web ships a no-op Alert (`static alert(){}`), so on the web every
// Alert.alert in the app — success notices, errors, confirmations — silently
// did nothing (e.g. "Cloud connected" never showed, so connecting looked like it
// did nothing). This routes Alert.alert to a real modal on web. Native keeps the
// OS alert untouched.
import { useEffect, useState } from "react";
import { Alert, Modal, Platform, Pressable, Text, View } from "react-native";
import { theme } from "./theme";

type Btn = { text?: string; onPress?: () => void; style?: "default" | "cancel" | "destructive" };
type AlertState = { title?: string; message?: string; buttons?: Btn[] };

let pushAlert: ((a: AlertState) => void) | null = null;
const pending: AlertState[] = [];

function show(title?: string, message?: string, buttons?: Btn[]) {
  const a: AlertState = { title, message, buttons };
  if (pushAlert) pushAlert(a);
  else pending.push(a); // host not mounted yet
}

let installed = false;
export function installWebAlert() {
  if (Platform.OS !== "web" || installed) return;
  installed = true;
  // RNW's Alert.alert is a no-op static — replace it with our modal.
  (Alert as unknown as { alert: typeof show }).alert = show;
}

export function AlertHost() {
  const [queue, setQueue] = useState<AlertState[]>([]);
  useEffect(() => {
    pushAlert = (a) => setQueue((q) => [...q, a]);
    if (pending.length) {
      setQueue((q) => [...q, ...pending]);
      pending.length = 0;
    }
    return () => {
      pushAlert = null;
    };
  }, []);

  if (Platform.OS !== "web" || queue.length === 0) return null;
  const current = queue[0];
  const buttons = current.buttons && current.buttons.length ? current.buttons : [{ text: "OK" }];
  const press = (b: Btn) => {
    setQueue((q) => q.slice(1));
    b.onPress?.();
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => setQueue((q) => q.slice(1))}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <View style={{ width: "100%", maxWidth: 400, backgroundColor: theme.bg, borderRadius: theme.radius, borderWidth: 1, borderColor: theme.border, padding: 20, gap: 8 }}>
          {current.title ? <Text style={{ color: theme.text, fontSize: 17, fontWeight: "800" }}>{current.title}</Text> : null}
          {current.message ? <Text style={{ color: theme.muted, fontSize: 14, lineHeight: 20 }}>{current.message}</Text> : null}
          <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
            {buttons.map((b, i) => (
              <Pressable
                key={i}
                onPress={() => press(b)}
                style={{
                  paddingVertical: 9,
                  paddingHorizontal: 16,
                  borderRadius: 10,
                  backgroundColor: b.style === "cancel" ? "transparent" : b.style === "destructive" ? theme.danger : theme.accent,
                  borderWidth: b.style === "cancel" ? 1 : 0,
                  borderColor: theme.border,
                }}
              >
                <Text style={{ color: b.style === "cancel" ? theme.muted : theme.accentText, fontWeight: "700", fontSize: 14 }}>{b.text ?? "OK"}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      </View>
    </Modal>
  );
}
