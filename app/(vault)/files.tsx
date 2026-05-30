import { useCallback, useState } from "react";
import { Alert, FlatList, Pressable, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";
import { useVault } from "../../src/state/VaultContext";
import { Button, Muted, Screen, Title } from "../../src/ui/components";
import { theme } from "../../src/ui/theme";
import { fromB64 } from "../../src/crypto/b64";
import { writeTempPlaintext, deleteTemp } from "../../src/platform/expoStorage";
import type { VaultItem } from "../../src/vault/types";

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function Files() {
  const { vault, unlocked } = useVault();
  const [items, setItems] = useState<VaultItem[]>([]);

  const refresh = useCallback(() => {
    if (unlocked) setItems(vault.listItems().filter((i) => i.type === "file"));
  }, [vault, unlocked]);

  useFocusEffect(useCallback(() => refresh(), [refresh]));

  async function importFile() {
    const res = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
    if (res.canceled) return;
    for (const asset of res.assets) {
      const b64 = await FileSystem.readAsStringAsync(asset.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      await vault.addItem("file", asset.name, fromB64(b64), { mime: asset.mimeType });
    }
    refresh();
  }

  // Decrypt to a temp file and hand to the OS share sheet (the "download" path).
  async function exportFile(item: VaultItem) {
    const data = await vault.readItem(item.id);
    const ext = item.name.includes(".") ? item.name.split(".").pop()! : "bin";
    const uri = await writeTempPlaintext(item.id, data, ext);
    try {
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: item.mime });
      } else {
        Alert.alert("Saved", "Sharing is not available on this device.");
      }
    } finally {
      await deleteTemp(uri);
    }
  }

  async function remove(item: VaultItem) {
    Alert.alert("Delete", `Delete "${item.name}"?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          await vault.deleteItem(item.id);
          refresh();
        },
      },
    ]);
  }

  return (
    <Screen>
      <Title>Files</Title>
      <Button label="+ Import file" onPress={importFile} />
      {items.length === 0 ? (
        <Muted>No files yet. Import any document; export it back out anytime.</Muted>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => i.id}
          contentContainerStyle={{ gap: 10, paddingBottom: 40 }}
          renderItem={({ item }) => (
            <View
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
              <Text style={{ fontSize: 24 }}>📄</Text>
              <View style={{ flex: 1 }}>
                <Text numberOfLines={1} style={{ color: theme.text, fontWeight: "600" }}>
                  {item.name}
                </Text>
                <Text style={{ color: theme.muted, fontSize: 12 }}>{fmtSize(item.size)}</Text>
              </View>
              <Pressable onPress={() => exportFile(item)}>
                <Text style={{ color: theme.accent, fontWeight: "700" }}>Export</Text>
              </Pressable>
              <Pressable onPress={() => remove(item)}>
                <Text style={{ color: theme.danger }}>Delete</Text>
              </Pressable>
            </View>
          )}
        />
      )}
    </Screen>
  );
}
