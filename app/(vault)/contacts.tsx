// Encrypted contacts. Import a .vcf (vCard) export — from a phone, Google
// Contacts, iCloud, etc. — parse it, and store the contacts sealed under the
// vault DEK. Read them back as a searchable list. Cross-platform (the picker +
// text read work on web and native).
import { useCallback, useMemo, useState } from "react";
import { Alert, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { useVault } from "../../src/state/VaultContext";
import { Button, Field, Muted, Screen, Title } from "../../src/ui/components";
import { theme } from "../../src/ui/theme";
import { readBytesFromUri } from "../../src/platform/io";
import { bytesToUtf8 } from "../../src/crypto/b64";

type Contact = { id: string; name: string; phones: string[]; emails: string[]; org?: string; note?: string };

// Minimal vCard parser: split into cards, unfold folded lines, read the fields
// we show. Handles 3.0/4.0-ish exports from common sources.
function parseVcards(text: string): Contact[] {
  const out: Contact[] = [];
  const blocks = text.split(/BEGIN:VCARD/i).slice(1);
  for (const block of blocks) {
    const body = block.split(/END:VCARD/i)[0];
    // unfold continuation lines (a leading space/tab continues the previous)
    const lines = body.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "").split(/\r?\n/);
    let fn = "";
    let n = "";
    let org = "";
    let note = "";
    const phones: string[] = [];
    const emails: string[] = [];
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      const idx = line.indexOf(":");
      if (idx < 0) continue;
      const key = line.slice(0, idx).toUpperCase();
      const val = line.slice(idx + 1).trim();
      const base = key.split(";")[0];
      if (base === "FN") fn = decodeVal(val);
      else if (base === "N") n = decodeVal(val).split(";").filter(Boolean).reverse().join(" ").trim();
      else if (base === "ORG") org = decodeVal(val).replace(/;/g, " ").trim();
      else if (base === "NOTE") note = decodeVal(val);
      else if (base === "TEL") phones.push(decodeVal(val));
      else if (base === "EMAIL") emails.push(decodeVal(val));
    }
    const name = fn || n || phones[0] || emails[0] || "Unknown";
    if (name || phones.length || emails.length) {
      out.push({ id: `c${Math.random().toString(36).slice(2)}`, name, phones, emails, org: org || undefined, note: note || undefined });
    }
  }
  return out;
}
const decodeVal = (v: string) => v.replace(/\\n/gi, " ").replace(/\\,/g, ",").replace(/\\;/g, ";").trim();

export default function ContactsScreen() {
  const { vault, unlocked, withoutAutoLock } = useVault();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Contact | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    if (!unlocked) return;
    vault.getAppData<Contact[]>("contacts").then((c) => setContacts(c ?? []));
  }, [vault, unlocked]);
  useFocusEffect(load);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? contacts.filter((c) => c.name.toLowerCase().includes(q) || c.phones.some((p) => p.includes(q)) || c.emails.some((e) => e.toLowerCase().includes(q)))
      : contacts;
    return [...list].sort((a, b) => a.name.localeCompare(b.name));
  }, [contacts, query]);

  async function importVcf() {
    const res = await withoutAutoLock(() => DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true }));
    if (res.canceled) return;
    setBusy(true);
    try {
      let parsed: Contact[] = [];
      for (const asset of res.assets) {
        const text = bytesToUtf8(await readBytesFromUri(asset.uri));
        parsed = parsed.concat(parseVcards(text));
      }
      if (!parsed.length) {
        Alert.alert("No contacts found", "That file didn't contain any vCard (.vcf) contacts.");
        return;
      }
      // de-dupe against existing by name+first phone
      const seen = new Set(contacts.map((c) => `${c.name}|${c.phones[0] ?? ""}`));
      const fresh = parsed.filter((c) => !seen.has(`${c.name}|${c.phones[0] ?? ""}`));
      const next = [...contacts, ...fresh];
      setContacts(next);
      await vault.setAppData("contacts", next);
      Alert.alert("Contacts imported", `Added ${fresh.length} contact${fresh.length === 1 ? "" : "s"} — encrypted in your vault.`);
    } catch (e) {
      Alert.alert("Import failed", e instanceof Error ? e.message : "Couldn't read that file.");
    } finally {
      setBusy(false);
    }
  }

  async function removeContact(id: string) {
    const next = contacts.filter((c) => c.id !== id);
    setContacts(next);
    await vault.setAppData("contacts", next);
    setOpen(null);
  }

  return (
    <Screen>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Title>People</Title>
        <Pressable testID="contacts-import" onPress={importVcf} hitSlop={8} disabled={busy}>
          <Ionicons name="cloud-upload-outline" size={26} color={theme.accent} />
        </Pressable>
      </View>
      <Field value={query} onChangeText={setQuery} placeholder="Search contacts…" />

      {contacts.length === 0 ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingBottom: 60 }}>
          <Ionicons name="people-outline" size={52} color={theme.accent} />
          <Text style={{ color: theme.text, fontSize: 16, fontWeight: "700" }}>No contacts yet</Text>
          <Muted>Export your contacts as a .vcf file and tap the upload icon to import them — they’re stored encrypted.</Muted>
          <View style={{ marginTop: 8, width: 220 }}>
            <Button label="Import .vcf" onPress={importVcf} />
          </View>
        </View>
      ) : (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 30 }}>
          {visible.map((c) => (
            <Pressable
              key={c.id}
              onPress={() => setOpen(c)}
              style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.border }}
            >
              <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: theme.surfaceAlt, alignItems: "center", justifyContent: "center" }}>
                <Text style={{ color: theme.accent, fontWeight: "800" }}>{c.name.slice(0, 1).toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text numberOfLines={1} style={{ color: theme.text, fontWeight: "600" }}>{c.name}</Text>
                <Text numberOfLines={1} style={{ color: theme.muted, fontSize: 12 }}>{c.phones[0] ?? c.emails[0] ?? c.org ?? ""}</Text>
              </View>
            </Pressable>
          ))}
        </ScrollView>
      )}

      <Modal visible={!!open} transparent animationType="slide" onRequestClose={() => setOpen(null)}>
        <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" }} onPress={() => setOpen(null)}>
          <Pressable style={{ backgroundColor: theme.bg, borderTopLeftRadius: 18, borderTopRightRadius: 18, borderWidth: 1, borderColor: theme.border, padding: 20, maxHeight: "75%" }} onPress={() => {}}>
            {open && (
              <>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 14 }}>
                  <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: theme.surfaceAlt, alignItems: "center", justifyContent: "center" }}>
                    <Text style={{ color: theme.accent, fontWeight: "800", fontSize: 20 }}>{open.name.slice(0, 1).toUpperCase()}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: theme.text, fontWeight: "800", fontSize: 18 }}>{open.name}</Text>
                    {open.org ? <Text style={{ color: theme.muted, fontSize: 13 }}>{open.org}</Text> : null}
                  </View>
                  <Pressable onPress={() => removeContact(open.id)} hitSlop={8}>
                    <Ionicons name="trash-outline" size={22} color={theme.danger} />
                  </Pressable>
                </View>
                <ScrollView>
                  {open.phones.map((p, i) => (
                    <Row key={`p${i}`} icon="call-outline" value={p} />
                  ))}
                  {open.emails.map((e, i) => (
                    <Row key={`e${i}`} icon="mail-outline" value={e} />
                  ))}
                  {open.note ? <Row icon="document-text-outline" value={open.note} /> : null}
                </ScrollView>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </Screen>
  );
}

function Row({ icon, value }: { icon: keyof typeof Ionicons.glyphMap; value: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.border }}>
      <Ionicons name={icon} size={20} color={theme.accent} />
      <Text selectable style={{ color: theme.text, fontSize: 15, flex: 1 }}>{value}</Text>
    </View>
  );
}
