import { useCallback, useState } from "react";
import { Alert, FlatList, Pressable, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import * as Clipboard from "expo-clipboard";
import { Ionicons } from "@expo/vector-icons";
import { useVault } from "../../src/state/VaultContext";
import { Button, Field, Muted, Screen, Title } from "../../src/ui/components";
import { theme } from "../../src/ui/theme";
import type { Credential, VaultItem } from "../../src/vault/types";

type Editing = { id?: string } & Credential;

export default function Passwords() {
  const { vault, unlocked } = useVault();
  const [items, setItems] = useState<VaultItem[]>([]);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [reveal, setReveal] = useState(false);

  const refresh = useCallback(() => {
    if (unlocked) setItems(vault.listCredentials());
  }, [vault, unlocked]);

  useFocusEffect(useCallback(() => refresh(), [refresh]));

  function openNew() {
    setReveal(false);
    setEditing({ title: "", username: "", password: "", url: "", notes: "" });
  }

  async function openExisting(id: string) {
    const c = await vault.readCredential(id);
    setReveal(false);
    setEditing({ id, ...c });
  }

  async function save() {
    if (!editing) return;
    const cred: Credential = {
      title: editing.title || "Untitled",
      username: editing.username,
      password: editing.password,
      url: editing.url,
      notes: editing.notes,
    };
    if (editing.id) await vault.updateCredential(editing.id, cred);
    else await vault.addCredential(cred);
    setEditing(null);
    refresh();
  }

  function remove(id: string) {
    Alert.alert("Delete", "Delete this credential?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          await vault.deleteItem(id);
          refresh();
        },
      },
    ]);
  }

  async function copy(value: string, label: string) {
    await Clipboard.setStringAsync(value);
    setTimeout(() => Clipboard.setStringAsync(""), 30_000); // auto-clear in 30s
    Alert.alert("Copied", `${label} copied — clipboard clears in 30s.`);
  }

  if (editing) {
    return (
      <Screen>
        <Title>{editing.id ? "Edit credential" : "New credential"}</Title>
        <Field value={editing.title} onChangeText={(t) => setEditing({ ...editing, title: t })} placeholder="Title (e.g. Email)" />
        <Field value={editing.username} onChangeText={(t) => setEditing({ ...editing, username: t })} placeholder="Username / email" />
        <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
          <View style={{ flex: 1 }}>
            <Field
              value={editing.password}
              onChangeText={(t) => setEditing({ ...editing, password: t })}
              placeholder="Password"
              secureTextEntry={!reveal}
            />
          </View>
          <Pressable onPress={() => setReveal(!reveal)}>
            <Ionicons name={reveal ? "eye-off" : "eye"} size={24} color={theme.muted} />
          </Pressable>
        </View>
        <Field value={editing.url ?? ""} onChangeText={(t) => setEditing({ ...editing, url: t })} placeholder="URL (optional)" />
        <Field value={editing.notes ?? ""} onChangeText={(t) => setEditing({ ...editing, notes: t })} placeholder="Notes (optional)" multiline />
        <View style={{ flexDirection: "row", gap: 10 }}>
          <View style={{ flex: 1 }}><Button label="Save" onPress={save} /></View>
          <View style={{ flex: 1 }}><Button label="Cancel" onPress={() => setEditing(null)} variant="outline" /></View>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <Title>Passwords</Title>
      <Button label="+ New credential" onPress={openNew} />
      {items.length === 0 ? (
        <Muted>No credentials yet. Stored encrypted; copy auto-clears the clipboard.</Muted>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => i.id}
          contentContainerStyle={{ gap: 10, paddingBottom: 40 }}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => openExisting(item.id)}
              onLongPress={() => remove(item.id)}
              style={{
                backgroundColor: theme.surface,
                borderRadius: theme.radius,
                padding: 16,
                borderWidth: 1,
                borderColor: theme.border,
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
              }}
            >
              <Ionicons name="key" size={22} color={theme.accent} />
              <Text style={{ color: theme.text, fontWeight: "600", flex: 1 }}>{item.name}</Text>
              <Pressable
                onPress={async () => {
                  const c = await vault.readCredential(item.id);
                  copy(c.password, "Password");
                }}
              >
                <Ionicons name="copy-outline" size={20} color={theme.muted} />
              </Pressable>
            </Pressable>
          )}
        />
      )}
    </Screen>
  );
}
