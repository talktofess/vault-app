import { useCallback, useState } from "react";
import { Alert, FlatList, Image, Modal, Pressable, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useVault } from "../../src/state/VaultContext";
import { Button, Muted, Screen, Title } from "../../src/ui/components";
import { theme } from "../../src/ui/theme";
import { writeTempPlaintext, deleteTemp } from "../../src/platform/expoStorage";
import { compressImage, readFileBytes, deleteFromGallery } from "../../src/platform/media";
import type { VaultItem } from "../../src/vault/types";

export default function Media() {
  const { vault, unlocked } = useVault();
  const [items, setItems] = useState<VaultItem[]>([]);
  const [preview, setPreview] = useState<{ uri: string; item: VaultItem } | null>(null);
  const [importing, setImporting] = useState(false);

  const refresh = useCallback(() => {
    if (unlocked) setItems(vault.listItems().filter((i) => i.type === "media"));
  }, [vault, unlocked]);

  useFocusEffect(useCallback(() => refresh(), [refresh]));

  async function importMedia() {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.All,
      quality: 1,
      allowsMultipleSelection: true,
    });
    if (res.canceled) return;
    setImporting(true);
    const importedAssetIds: string[] = [];
    try {
      for (const asset of res.assets) {
        const isVideo = asset.type === "video";
        // Images are compressed to save space; video is stored as-is (Expo
        // can't transcode video).
        const bytes = isVideo ? await readFileBytes(asset.uri) : await compressImage(asset.uri);
        const name = asset.fileName ?? `media_${Date.now()}`;
        const mime = isVideo ? asset.mimeType ?? "video/mp4" : "image/jpeg";
        await vault.addItem("media", name, bytes, { mime });
        if (asset.assetId) importedAssetIds.push(asset.assetId);
      }
      refresh();
      // Offer to remove the originals from the device gallery (OS will show its
      // own confirmation — no app can delete photos silently).
      if (importedAssetIds.length > 0) {
        Alert.alert(
          "Remove originals?",
          "Delete the imported items from your device gallery? They're safely stored here.",
          [
            { text: "Keep", style: "cancel" },
            {
              text: "Delete from gallery",
              style: "destructive",
              onPress: () => deleteFromGallery(importedAssetIds),
            },
          ]
        );
      }
    } catch (e) {
      Alert.alert("Import failed", e instanceof Error ? e.message : "Could not import.");
    } finally {
      setImporting(false);
    }
  }

  async function openItem(item: VaultItem) {
    const data = await vault.readItem(item.id);
    const ext = item.mime?.includes("video") ? "mp4" : "jpg";
    const uri = await writeTempPlaintext(item.id, data, ext);
    setPreview({ uri, item });
  }

  async function closePreview() {
    if (preview) await deleteTemp(preview.uri);
    setPreview(null);
  }

  function remove(item: VaultItem) {
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
      <Button
        label={importing ? "Importing…" : "Import photo / video"}
        onPress={importMedia}
        loading={importing}
      />
      {items.length === 0 ? (
        <Muted>Nothing here yet. Imported photos and videos are encrypted and compressed.</Muted>
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
                gap: 4,
              }}
            >
              <Ionicons
                name={item.mime?.includes("video") ? "videocam" : "image"}
                size={30}
                color={theme.accent}
              />
              <Text numberOfLines={1} style={{ color: theme.muted, fontSize: 10, paddingHorizontal: 4 }}>
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
              <Muted>Video decrypted to a temporary file (wiped on close). Inline playback needs expo-av.</Muted>
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
