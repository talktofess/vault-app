import { useCallback, useState } from "react";
import { Alert, FlatList, Pressable, Switch, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { useVault } from "../../src/state/VaultContext";
import { Button, Field, Muted, Screen, Title } from "../../src/ui/components";
import { theme } from "../../src/ui/theme";
import { bytesToUtf8, utf8ToBytes } from "../../src/crypto/b64";
import type { VaultItem } from "../../src/vault/types";

export default function Notes() {
  const { vault, unlocked } = useVault();
  const [items, setItems] = useState<VaultItem[]>([]);
  const [editing, setEditing] = useState<{ item?: VaultItem; name: string; body: string; json: boolean } | null>(null);

  const refresh = useCallback(() => {
    if (unlocked) setItems(vault.listItems().filter((i) => i.type === "note"));
  }, [vault, unlocked]);

  useFocusEffect(useCallback(() => refresh(), [refresh]));

  async function openNew() {
    setEditing({ name: "", body: "", json: false });
  }

  async function openExisting(item: VaultItem) {
    const body = bytesToUtf8(await vault.readItem(item.id));
    setEditing({ item, name: item.name, body, json: !!item.isJson });
  }

  async function save() {
    if (!editing) return;
    const { item, name, body, json } = editing;
    if (json) {
      try {
        JSON.parse(body);
      } catch {
        Alert.alert("Invalid JSON", "Fix the JSON before saving, or turn off JSON mode.");
        return;
      }
    }
    if (item) await vault.deleteItem(item.id); // simplest update: replace
    await vault.addItem("note", name || "Untitled", utf8ToBytes(body), { isJson: json });
    setEditing(null);
    refresh();
  }

  async function remove(item: VaultItem) {
    await vault.deleteItem(item.id);
    refresh();
  }

  if (editing) {
    return (
      <Screen>
        <Title>{editing.item ? "Edit note" : "New note"}</Title>
        <Field value={editing.name} onChangeText={(t) => setEditing({ ...editing, name: t })} placeholder="Title" />
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Switch value={editing.json} onValueChange={(v) => setEditing({ ...editing, json: v })} />
          <Muted>JSON mode (validates on save)</Muted>
        </View>
        <Field
          value={editing.body}
          onChangeText={(t) => setEditing({ ...editing, body: t })}
          placeholder={editing.json ? '{ "key": "value" }' : "Your secure note…"}
          multiline
        />
        <View style={{ flexDirection: "row", gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Button label="Save" onPress={save} />
          </View>
          <View style={{ flex: 1 }}>
            <Button label="Cancel" onPress={() => setEditing(null)} variant="outline" />
          </View>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <Title>Notes</Title>
      <Button label="+ New note" onPress={openNew} />
      {items.length === 0 ? (
        <Muted>No notes yet. Create encrypted text or JSON entries.</Muted>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => i.id}
          contentContainerStyle={{ gap: 10, paddingBottom: 40 }}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => openExisting(item)}
              onLongPress={() => remove(item)}
              style={{
                backgroundColor: theme.surface,
                borderRadius: theme.radius,
                padding: 16,
                borderWidth: 1,
                borderColor: theme.border,
              }}
            >
              <Text style={{ color: theme.text, fontSize: 16, fontWeight: "600" }}>
                {item.isJson ? "{ } " : "📝 "}
                {item.name}
              </Text>
              <Text style={{ color: theme.muted, fontSize: 12 }}>
                {new Date(item.createdAt).toLocaleString()}
              </Text>
            </Pressable>
          )}
        />
      )}
    </Screen>
  );
}
