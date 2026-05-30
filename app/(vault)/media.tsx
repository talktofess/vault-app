import { useCallback, useState } from "react";
import { Alert, FlatList, Image, Modal, Pressable, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system";
import { useVault } from "../../src/state/VaultContext";
import { Button, Muted, Screen, Title } from "../../src/ui/components";
import { theme } from "../../src/ui/theme";
import { fromB64, toB64 } from "../../src/crypto/b64";
import { writeTempPlaintext, deleteTemp } from "../../src/platform/expoStorage";
import type { VaultItem } from "../../src/vault/types";

export default function Media() {
  const { vault, unlocked } = useVault();
  const [items, setItems] = useState<VaultItem[]>([]);
  const [preview, setPreview] = useState<{ uri: string; item: VaultItem } | null>(null);

  const refresh = useCallback(() => {
    if (unlocked) setItems(vault.listItems().filter((i) => i.type === "media"));
  }, [vault, unlocked]);

  useFocusEffect(useCallback(() => refresh(), [refresh]));

  async function importMedia() {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.All,
      quality: 1,
      base64: false,
    });
    if (res.canceled) return;
    for (const asset of res.assets) {
      const b64 = await FileSystem.readAsStringAsync(asset.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const name = asset.fileName ?? `media_${Date.now()}`;
      const mime = asset.mimeType ?? (asset.type === "video" ? "video/mp4" : "image/jpeg");
      await vault.addItem("media", name, fromB64(b64), { mime });
    }
    refresh();
  }

  async function openItem(item: VaultItem) {
    const data = await vault.readItem(item.id);
    const ext = item.mime?.includes("video") ? "mp4" : "jpg";
    const uri = await writeTempPlaintext(item.id, data, ext);
    setPreview({ uri, item });
  }

  async function closePreview() {
    if (preview) await deleteTemp(preview.uri); // wipe decrypted temp
    setPreview(null);
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
      <Title>Media</Title>
      <Button label="+ Import photo / video" onPress={importMedia} />
      {items.length === 0 ? (
        <Muted>No media yet. Import encrypted photos and videos from your library.</Muted>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => i.id}
          numColumns={3}
          columnWrapperStyle={{ gap: 8 }}
          contentContainerStyle={{ gap: 8, paddingBottom: 40 }}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => openItem(item)}
              onLongPress={() => remove(item)}
              style={{
                flex: 1 / 3,
                aspectRatio: 1,
                backgroundColor: theme.surface,
                borderRadius: 10,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text style={{ fontSize: 28 }}>
                {item.mime?.includes("video") ? "🎬" : "🖼️"}
              </Text>
              <Text numberOfLines={1} style={{ color: theme.muted, fontSize: 10, padding: 4 }}>
                {item.name}
              </Text>
            </Pressable>
          )}
        />
      )}

      <Modal visible={!!preview} onRequestClose={closePreview} animationType="fade">
        <View style={{ flex: 1, backgroundColor: "#000", justifyContent: "center" }}>
          {preview && !preview.item.mime?.includes("video") && (
            <Image source={{ uri: preview.uri }} style={{ flex: 1 }} resizeMode="contain" />
          )}
          {preview && preview.item.mime?.includes("video") && (
            <View style={{ padding: 20 }}>
              <Muted>
                Video decrypted to a temporary file. (Add expo-av to play inline;
                file is wiped on close.)
              </Muted>
            </View>
          )}
          <View style={{ padding: 20 }}>
            <Button label="Close" onPress={closePreview} variant="outline" />
          </View>
        </View>
      </Modal>
    </Screen>
  );
}
