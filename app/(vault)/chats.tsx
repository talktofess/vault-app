// Encrypted chat reader. Import a WhatsApp chat export (.txt — "Export chat
// without media"), parse the messages, and read them back as a conversation.
// Stored sealed under the vault DEK. Tap a sender to put their bubbles on the
// right ("me"). Cross-platform.
import { useCallback, useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { useVault } from "../../src/state/VaultContext";
import { Button, Field, Muted, Screen, Title } from "../../src/ui/components";
import { theme } from "../../src/ui/theme";
import { readBytesFromUri } from "../../src/platform/io";
import { bytesToUtf8 } from "../../src/crypto/b64";

type Msg = { time: string; sender: string; text: string };
type Chat = { id: string; title: string; msgs: Msg[]; importedAt: number };

const BRACKET = /^\[(.+?)\]\s?(.*)$/;
const DASH = /^(\d{1,2}[./-]\d{1,2}[./-]\d{2,4},?\s+\d{1,2}:\d{2}(?::\d{2})?\s?(?:[APap][Mm])?)\s+-\s+(.*)$/;

function parseWhatsapp(text: string): Msg[] {
  const msgs: Msg[] = [];
  for (const lineRaw of text.split(/\r?\n/)) {
    const line = lineRaw.replace(/‎/g, ""); // strip LTR marks WhatsApp adds
    let m = line.match(BRACKET) || line.match(DASH);
    if (m) {
      const rest = m[2];
      const ci = rest.indexOf(": ");
      if (ci > 0 && ci < 60) msgs.push({ time: m[1], sender: rest.slice(0, ci), text: rest.slice(ci + 2) });
      else msgs.push({ time: m[1], sender: "", text: rest }); // system line
    } else if (msgs.length) {
      msgs[msgs.length - 1].text += "\n" + line; // continuation of the previous message
    }
  }
  return msgs;
}

// stable-ish color per sender
function senderColor(name: string): string {
  const palette = ["#a9784f", "#4f9a5f", "#b07f2e", "#7f6ab0", "#b0566f", "#4f86a9"];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}

export default function ChatsScreen() {
  const { vault, unlocked, withoutAutoLock } = useVault();
  const [chats, setChats] = useState<Chat[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [me, setMe] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    if (!unlocked) return;
    vault.getAppData<Chat[]>("chats").then((c) => setChats(c ?? []));
  }, [vault, unlocked]);
  useFocusEffect(load);

  const openChat = chats.find((c) => c.id === openId) ?? null;

  async function importChat() {
    const res = await withoutAutoLock(() => DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true }));
    if (res.canceled) return;
    setBusy(true);
    try {
      const added: Chat[] = [];
      for (const asset of res.assets) {
        const text = bytesToUtf8(await readBytesFromUri(asset.uri));
        const msgs = parseWhatsapp(text);
        if (msgs.length) {
          const title = asset.name.replace(/^WhatsApp Chat with /i, "").replace(/\.txt$/i, "").trim() || "Chat";
          added.push({ id: `chat${Math.random().toString(36).slice(2)}`, title, msgs, importedAt: Date.now() });
        }
      }
      if (!added.length) {
        Alert.alert("Nothing to read", "That file didn't look like a WhatsApp chat export (.txt).");
        return;
      }
      const next = [...added, ...chats];
      setChats(next);
      await vault.setAppData("chats", next);
    } catch (e) {
      Alert.alert("Import failed", e instanceof Error ? e.message : "Couldn't read that file.");
    } finally {
      setBusy(false);
    }
  }

  async function removeChat(id: string) {
    const next = chats.filter((c) => c.id !== id);
    setChats(next);
    await vault.setAppData("chats", next);
    setOpenId(null);
  }

  // ---- conversation reader ----
  const senders = useMemo(() => (openChat ? [...new Set(openChat.msgs.map((m) => m.sender).filter(Boolean))] : []), [openChat]);
  if (openChat) {
    return (
      <Screen>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Pressable testID="chat-back" onPress={() => setOpenId(null)} hitSlop={8}>
            <Ionicons name="chevron-back" size={26} color={theme.text} />
          </Pressable>
          <Text numberOfLines={1} style={{ flex: 1, color: theme.text, fontSize: 20, fontWeight: "800" }}>{openChat.title}</Text>
          <Pressable onPress={() => removeChat(openChat.id)} hitSlop={8}>
            <Ionicons name="trash-outline" size={20} color={theme.danger} />
          </Pressable>
        </View>

        {/* pick which sender is "me" (right-aligned) */}
        {senders.length > 1 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, marginTop: 6 }} contentContainerStyle={{ gap: 6, paddingVertical: 6 }}>
            <Text style={{ color: theme.muted, fontSize: 12, alignSelf: "center", marginRight: 2 }}>I am:</Text>
            {senders.map((s) => (
              <Pressable key={s} onPress={() => setMe(me === s ? "" : s)} style={{ paddingVertical: 5, paddingHorizontal: 10, borderRadius: 999, backgroundColor: me === s ? theme.accent : theme.surface, borderWidth: 1, borderColor: me === s ? theme.accent : theme.border }}>
                <Text numberOfLines={1} style={{ color: me === s ? theme.accentText : theme.muted, fontSize: 12, fontWeight: "700", maxWidth: 120 }}>{s}</Text>
              </Pressable>
            ))}
          </ScrollView>
        )}

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 10, gap: 6, paddingBottom: 30 }}>
          {openChat.msgs.map((m, i) => {
            if (!m.sender) {
              return (
                <Text key={i} style={{ color: theme.muted, fontSize: 11, textAlign: "center", paddingVertical: 4 }}>{m.text}</Text>
              );
            }
            const mine = m.sender === me;
            const prev = openChat.msgs[i - 1];
            const showName = !mine && (!prev || prev.sender !== m.sender);
            return (
              <View key={i} style={{ alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "82%", backgroundColor: mine ? theme.accent : theme.surface, borderWidth: mine ? 0 : 1, borderColor: theme.border, borderRadius: 14, paddingHorizontal: 11, paddingVertical: 7 }}>
                {showName && <Text style={{ color: senderColor(m.sender), fontSize: 11, fontWeight: "800", marginBottom: 2 }}>{m.sender}</Text>}
                <Text style={{ color: mine ? theme.accentText : theme.text, fontSize: 14, lineHeight: 19 }}>{m.text}</Text>
                <Text style={{ color: mine ? "rgba(255,255,255,0.7)" : theme.muted, fontSize: 9, marginTop: 2, alignSelf: "flex-end" }}>{m.time}</Text>
              </View>
            );
          })}
        </ScrollView>
      </Screen>
    );
  }

  // ---- chat list ----
  return (
    <Screen>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Title>Chats</Title>
        <Pressable testID="chats-import" onPress={importChat} hitSlop={8} disabled={busy}>
          <Ionicons name="cloud-upload-outline" size={26} color={theme.accent} />
        </Pressable>
      </View>

      {chats.length === 0 ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingBottom: 60 }}>
          <Ionicons name="chatbubbles-outline" size={52} color={theme.accent} />
          <Text style={{ color: theme.text, fontSize: 16, fontWeight: "700" }}>No chats yet</Text>
          <Muted>In WhatsApp: a chat → ⋮ → More → Export chat → Without media. Import the .txt here and read it — stored encrypted.</Muted>
          <View style={{ marginTop: 8, width: 220 }}>
            <Button label="Import chat (.txt)" onPress={importChat} />
          </View>
        </View>
      ) : (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 30, paddingTop: 6 }}>
          {chats.map((c) => (
            <Pressable
              key={c.id}
              onPress={() => { setMe(""); setOpenId(c.id); }}
              style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: theme.border }}
            >
              <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: theme.surfaceAlt, alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="chatbubble-ellipses" size={20} color={theme.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text numberOfLines={1} style={{ color: theme.text, fontWeight: "600" }}>{c.title}</Text>
                <Text style={{ color: theme.muted, fontSize: 12 }}>{c.msgs.length} messages</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={theme.muted} />
            </Pressable>
          ))}
        </ScrollView>
      )}
    </Screen>
  );
}
