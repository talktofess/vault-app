// The unified vault library: one place for every kind of item — images, video,
// audio, documents, APKs, archives, notes, anything. Browse with search +
// type filters + sort, import from anywhere, open type-aware previews, and
// manage in bulk (multi-select delete / export / move-to-album).
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Modal,
  Pressable,
  ScrollView,
  Switch,
  Text,
  View,
} from "react-native";
import { router, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { ResizeMode, Video } from "expo-av";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import { useVault } from "../../src/state/VaultContext";
import { Button, Field, Muted, Screen, Title } from "../../src/ui/components";
import { theme } from "../../src/ui/theme";
import { makeViewableUri, releaseViewableUri, saveBytes } from "../../src/platform/io";
import { compressImage, readFileBytes, deleteFromGallery } from "../../src/platform/media";
import { readBytesFromUri } from "../../src/platform/io";
import { streamRemoteToUri } from "../../src/platform/streamMedia";
import { syncIfLinked } from "../../src/cloud/autosync";
import { bytesToUtf8, utf8ToBytes } from "../../src/crypto/b64";
import {
  CATEGORY_COLOR,
  CATEGORY_ICON,
  FILTERS,
  type FileCategory,
  categorize,
  fmtSize,
  isTextLike,
  viewExt,
} from "../../src/vault/filetypes";
import type { VaultItem } from "../../src/vault/types";

type Sort = "new" | "name" | "size";
type Preview = { uri: string; item: VaultItem; av: boolean; release: () => Promise<void> | void };
type NoteEdit = { item?: VaultItem; name: string; body: string; json: boolean };
type TextView = { item: VaultItem; body: string };
type AlbumTarget = { ids: string[] };

export default function Library() {
  const { vault, unlocked, cloud } = useVault();
  const [items, setItems] = useState<VaultItem[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FileCategory | "all">("all");
  const [sort, setSort] = useState<Sort>("new");

  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [importMenu, setImportMenu] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const syncingRef = useRef(false); // guards against overlapping syncs

  const [preview, setPreview] = useState<Preview | null>(null);
  const [textView, setTextView] = useState<TextView | null>(null);
  const [noteEdit, setNoteEdit] = useState<NoteEdit | null>(null);
  const [details, setDetails] = useState<VaultItem | null>(null);
  const [albumTarget, setAlbumTarget] = useState<AlbumTarget | null>(null);

  const refresh = useCallback(() => {
    if (unlocked) setItems(vault.listItems().filter((i) => i.type !== "credential"));
  }, [vault, unlocked]);

  useFocusEffect(
    useCallback(() => {
      refresh();
      void runSync(true); // opportunistic background sync on entering the Library
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [refresh])
  );

  // ---- derived list: filter + search + sort ----
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = items.filter((i) => {
      if (filter !== "all" && categorize(i) !== filter) return false;
      if (q && !i.name.toLowerCase().includes(q)) return false;
      return true;
    });
    list = [...list].sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "size") return b.size - a.size;
      return b.createdAt - a.createdAt;
    });
    return list;
  }, [items, query, filter, sort]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: items.length };
    for (const i of items) {
      const k = categorize(i);
      c[k] = (c[k] ?? 0) + 1;
    }
    return c;
  }, [items]);

  // ---- import ----
  async function importPhotos() {
    setImportMenu(false);
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.All,
      quality: 1,
      allowsMultipleSelection: true,
    });
    if (res.canceled) return;
    setBusy("Importing media…");
    const assetIds: string[] = [];
    try {
      for (const asset of res.assets) {
        // asset.type can be undefined on web — fall back to the mime type.
        const isVideo = asset.type === "video" || (asset.mimeType?.startsWith("video") ?? false);
        const bytes = isVideo ? await readFileBytes(asset.uri) : await compressImage(asset.uri);
        const name = asset.fileName ?? `media_${Date.now()}`;
        const mime = isVideo ? asset.mimeType ?? "video/mp4" : "image/jpeg";
        await vault.addItem("media", name, bytes, { mime });
        if (asset.assetId) assetIds.push(asset.assetId);
      }
      refresh();
      void runSync(true); // auto-upload new items when cloud is linked
      if (assetIds.length > 0) {
        Alert.alert("Remove originals?", "Delete the imported items from your device gallery? They're safely stored here.", [
          { text: "Keep", style: "cancel" },
          { text: "Delete from gallery", style: "destructive", onPress: () => deleteFromGallery(assetIds) },
        ]);
      }
    } catch (e) {
      Alert.alert("Import failed", e instanceof Error ? e.message : "Could not import.");
    } finally {
      setBusy(null);
    }
  }

  async function importFiles() {
    setImportMenu(false);
    const res = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
    if (res.canceled) return;
    setBusy("Importing files…");
    try {
      for (const asset of res.assets) {
        const bytes = await readBytesFromUri(asset.uri);
        // Infer the APK mime so Android offers "install" when this is exported.
        const mime =
          asset.mimeType ??
          (asset.name.toLowerCase().endsWith(".apk")
            ? "application/vnd.android.package-archive"
            : undefined);
        await vault.addItem("file", asset.name, bytes, { mime });
      }
      refresh();
      void runSync(true);
    } catch (e) {
      Alert.alert("Import failed", e instanceof Error ? e.message : "Could not import.");
    } finally {
      setBusy(null);
    }
  }

  function newNote() {
    setImportMenu(false);
    setNoteEdit({ name: "", body: "", json: false });
  }

  function goCamera() {
    setImportMenu(false);
    router.push("/(vault)/camera");
  }

  // Read an item's bytes: from the local cache if present, otherwise stream the
  // cloud copy transiently (viewing an uncached item does NOT persist it —
  // caching is the explicit "Download" action).
  async function readBytes(item: VaultItem): Promise<Uint8Array> {
    if (vault.isCached(item.id) || !item.remote) return vault.readItem(item.id);
    if (!cloud) throw new Error("This item isn't downloaded and cloud isn't configured.");
    return vault.fetchRemoteBytes(cloud.store, item.id);
  }

  // ---- open (type-aware) ----
  async function open(item: VaultItem) {
    const cat = categorize(item);
    const needsFetch = item.remote && !vault.isCached(item.id);
    try {
      if (needsFetch) setBusy("Fetching from cloud…");
      if (item.type === "note") {
        setNoteEdit({ item, name: item.name, body: bytesToUtf8(await readBytes(item)), json: !!item.isJson });
        return;
      }
      if (cat === "image") {
        const data = await readBytes(item);
        const uri = await makeViewableUri(item.id, data, viewExt(item));
        setPreview({ uri, item, av: false, release: () => releaseViewableUri(uri) });
        return;
      }
      if (cat === "video" || cat === "audio") {
        // Remote + uncached -> stream (progressive on web); otherwise read the
        // local blob and play it directly.
        if (needsFetch && cloud) {
          const r = await streamRemoteToUri(vault.openRemoteStream(cloud.store, item.id));
          setPreview({ uri: r.uri, item, av: true, release: r.release });
        } else {
          const data = await readBytes(item);
          const uri = await makeViewableUri(item.id, data, viewExt(item));
          setPreview({ uri, item, av: true, release: () => releaseViewableUri(uri) });
        }
        return;
      }
      if (isTextLike(cat, item.name, item.mime)) {
        setTextView({ item, body: bytesToUtf8(await readBytes(item)) });
        return;
      }
      setDetails(item);
    } catch (e) {
      Alert.alert("Couldn't open", e instanceof Error ? e.message : "Failed to read item.");
    } finally {
      if (needsFetch) setBusy(null);
    }
  }

  // ---- cloud actions ----
  async function cacheItem(item: VaultItem) {
    if (!cloud || !item.remote) return;
    setBusy("Downloading…");
    try {
      await vault.cacheItem(cloud.store, item.id);
      refresh();
    } catch (e) {
      Alert.alert("Download failed", e instanceof Error ? e.message : "Could not cache.");
    } finally {
      setBusy(null);
      setDetails(null);
    }
  }

  async function uncacheItem(item: VaultItem) {
    try {
      await vault.uncacheItem(item.id);
      refresh();
    } catch (e) {
      Alert.alert("Can't remove download", e instanceof Error ? e.message : "Failed.");
    } finally {
      setDetails(null);
    }
  }

  // Push new local items + pull remote changes. silent = used for automatic
  // background syncs (on focus / after import); loud = the manual Sync button.
  const runSync = useCallback(
    async (silent: boolean) => {
      if (!cloud || syncingRef.current) return;
      syncingRef.current = true;
      setSyncing(true);
      try {
        const res = await syncIfLinked(vault, cloud);
        if (res) refresh();
        if (!silent) {
          if (!res) Alert.alert("Cloud not linked", "Open Settings → Cloud sync to sign in and link this device.");
          else Alert.alert("Synced", `Pushed ${res.pushed}, pulled ${res.added} new, removed ${res.removed}.`);
        }
      } catch (e) {
        if (!silent) Alert.alert("Sync failed", e instanceof Error ? e.message : "Failed.");
      } finally {
        syncingRef.current = false;
        setSyncing(false);
      }
    },
    [cloud, vault, refresh]
  );

  async function closePreview() {
    if (preview) await preview.release();
    setPreview(null);
  }

  async function exportItem(item: VaultItem) {
    try {
      const data = await readBytes(item);
      await saveBytes(item.name, item.mime, data);
    } catch (e) {
      Alert.alert("Export failed", e instanceof Error ? e.message : "Could not export.");
    }
  }

  async function saveNote() {
    if (!noteEdit) return;
    const { item, name, body, json } = noteEdit;
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
    setNoteEdit(null);
    refresh();
    void runSync(true);
  }

  // ---- selection ----
  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  function startSelect(id: string) {
    setSelectMode(true);
    setSelected(new Set([id]));
  }
  function clearSelect() {
    setSelectMode(false);
    setSelected(new Set());
  }

  function deleteIds(ids: string[]) {
    const anyRemote = cloud && ids.some((id) => items.find((i) => i.id === id)?.remote);
    const msg = anyRemote
      ? `Delete ${ids.length} item${ids.length === 1 ? "" : "s"} everywhere — this device AND the cloud? This can't be undone.`
      : `Delete ${ids.length} item${ids.length === 1 ? "" : "s"}? This can't be undone.`;
    Alert.alert("Delete", msg, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          for (const id of ids) {
            const it = items.find((i) => i.id === id);
            if (it?.remote && cloud) await vault.deleteEverywhere(cloud.store, id);
            else await vault.deleteItem(id);
          }
          clearSelect();
          setDetails(null);
          refresh();
        },
      },
    ]);
  }

  async function exportIds(ids: string[]) {
    for (const id of ids) {
      const item = items.find((i) => i.id === id);
      if (item) await exportItem(item);
    }
    clearSelect();
  }

  async function applyAlbum(ids: string[], album: string) {
    for (const id of ids) await vault.updateItemMeta(id, { album });
    setAlbumTarget(null);
    clearSelect();
    setDetails(null);
    refresh();
  }

  const selectedIds = [...selected];

  return (
    <Screen>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Title>Vault</Title>
        <View style={{ flexDirection: "row", gap: 16, alignItems: "center" }}>
          {cloud && !selectMode && (
            <Pressable onPress={() => runSync(false)} hitSlop={8} disabled={syncing}>
              {syncing ? (
                <ActivityIndicator size="small" color={theme.accent} />
              ) : (
                <Ionicons name="sync" size={20} color={theme.accent} />
              )}
            </Pressable>
          )}
          <Pressable onPress={() => setSort(sort === "new" ? "name" : sort === "name" ? "size" : "new")}>
            <Text style={{ color: theme.accent, fontWeight: "600" }}>
              {sort === "new" ? "Newest" : sort === "name" ? "A–Z" : "Largest"}
            </Text>
          </Pressable>
          <Pressable onPress={() => (selectMode ? clearSelect() : setSelectMode(true))}>
            <Text style={{ color: theme.accent, fontWeight: "600" }}>{selectMode ? "Done" : "Select"}</Text>
          </Pressable>
        </View>
      </View>

      {!selectMode && <Button label="+ Add to vault" onPress={() => setImportMenu(true)} />}
      <Field value={query} onChangeText={setQuery} placeholder="Search everything…" />

      {/* filter chips */}
      <View style={{ height: 38 }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {FILTERS.map((f) => {
            const active = filter === f.key;
            const n = counts[f.key] ?? 0;
            if (f.key !== "all" && n === 0) return null;
            return (
              <Pressable
                key={f.key}
                onPress={() => setFilter(f.key)}
                style={{
                  paddingHorizontal: 14,
                  height: 34,
                  borderRadius: 17,
                  justifyContent: "center",
                  backgroundColor: active ? theme.accent : theme.surface,
                  borderWidth: 1,
                  borderColor: active ? theme.accent : theme.border,
                }}
              >
                <Text style={{ color: active ? "#0e0f13" : theme.text, fontWeight: "600", fontSize: 13 }}>
                  {f.label} {n > 0 ? n : ""}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {visible.length === 0 ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 14, paddingBottom: 60 }}>
          <View
            style={{
              width: 88,
              height: 88,
              borderRadius: 44,
              backgroundColor: theme.surface,
              borderWidth: 1,
              borderColor: theme.border,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Ionicons name={items.length === 0 ? "lock-closed-outline" : "search-outline"} size={38} color={theme.accent} />
          </View>
          <Text style={{ color: theme.text, fontSize: 17, fontWeight: "700" }}>
            {items.length === 0 ? "Your vault is empty" : "Nothing here"}
          </Text>
          <Text style={{ color: theme.muted, fontSize: 14, lineHeight: 21, textAlign: "center", paddingHorizontal: 30 }}>
            {items.length === 0
              ? "Tap “Add to vault” to bring in photos, videos, documents, APKs — anything. It’s all encrypted."
              : "No items match this filter or search."}
          </Text>
        </View>
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(i) => i.id}
          contentContainerStyle={{ gap: 8, paddingBottom: selectMode ? 90 : 40 }}
          removeClippedSubviews
          renderItem={({ item }) => {
            const cat = categorize(item);
            const isSel = selected.has(item.id);
            return (
              <Pressable
                onPress={() => (selectMode ? toggleSelect(item.id) : open(item))}
                onLongPress={() => !selectMode && startSelect(item.id)}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 13,
                  backgroundColor: isSel ? theme.surfaceAlt : theme.surface,
                  borderRadius: theme.radius,
                  borderWidth: 1,
                  borderColor: isSel ? theme.accent : theme.border,
                  borderLeftWidth: 3,
                  borderLeftColor: CATEGORY_COLOR[cat],
                  paddingVertical: 12,
                  paddingHorizontal: 14,
                }}
              >
                <View
                  style={{
                    width: 46,
                    height: 46,
                    borderRadius: 12,
                    backgroundColor: CATEGORY_COLOR[cat] + "22",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Ionicons name={CATEGORY_ICON[cat]} size={24} color={CATEGORY_COLOR[cat]} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={1} style={{ color: theme.text, fontWeight: "600" }}>
                    {item.name}
                  </Text>
                  <Text style={{ color: theme.muted, fontSize: 12 }}>
                    {cat.toUpperCase()} · {fmtSize(item.size)} · {new Date(item.createdAt).toLocaleDateString()}
                    {item.album ? ` · ${item.album}` : ""}
                  </Text>
                </View>
                {item.remote && (
                  <Ionicons
                    name={item.cached === false ? "cloud-outline" : "cloud-done-outline"}
                    size={16}
                    color={item.cached === false ? theme.muted : theme.good}
                  />
                )}
                {selectMode ? (
                  <Ionicons
                    name={isSel ? "checkmark-circle" : "ellipse-outline"}
                    size={24}
                    color={isSel ? theme.accent : theme.muted}
                  />
                ) : (
                  <Pressable onPress={() => setDetails(item)} hitSlop={10}>
                    <Ionicons name="ellipsis-horizontal" size={20} color={theme.muted} />
                  </Pressable>
                )}
              </Pressable>
            );
          }}
        />
      )}

      {/* multi-select action bar */}
      {selectMode && selectedIds.length > 0 && (
        <View
          style={{
            position: "absolute",
            left: 16,
            right: 16,
            bottom: 16,
            flexDirection: "row",
            gap: 10,
            backgroundColor: theme.surfaceAlt,
            borderRadius: theme.radius,
            borderWidth: 1,
            borderColor: theme.border,
            padding: 10,
          }}
        >
          <BarBtn icon="albums-outline" label={`${selectedIds.length}`} onPress={() => setAlbumTarget({ ids: selectedIds })} />
          <BarBtn icon="share-outline" label="Export" onPress={() => exportIds(selectedIds)} />
          <BarBtn icon="trash-outline" label="Delete" danger onPress={() => deleteIds(selectedIds)} />
        </View>
      )}

      {busy && (
        <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center" }}>
          <View style={{ backgroundColor: theme.surface, padding: 20, borderRadius: theme.radius }}>
            <Text style={{ color: theme.text }}>{busy}</Text>
          </View>
        </View>
      )}

      {/* import menu */}
      <Sheet visible={importMenu} onClose={() => setImportMenu(false)} title="Add to vault">
        <SheetRow icon="images-outline" label="Photo / video" sub="From your gallery (images are compressed)" onPress={importPhotos} />
        <SheetRow icon="document-outline" label="Any file" sub="Documents, APKs, archives — any format" onPress={importFiles} />
        <SheetRow icon="camera-outline" label="Camera" sub="Capture straight into the vault" onPress={goCamera} />
        <SheetRow icon="create-outline" label="New note" sub="Encrypted text or JSON" onPress={newNote} />
      </Sheet>

      {/* image / video / audio preview */}
      <Modal visible={!!preview} onRequestClose={closePreview} animationType="fade">
        <View style={{ flex: 1, backgroundColor: "#000", justifyContent: "center" }}>
          {preview && !preview.av && <Image source={{ uri: preview.uri }} style={{ flex: 1 }} resizeMode="contain" />}
          {preview && preview.av && (
            <Video source={{ uri: preview.uri }} style={{ flex: 1 }} useNativeControls resizeMode={ResizeMode.CONTAIN} shouldPlay />
          )}
          <View style={{ padding: 20, flexDirection: "row", gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Button label="Export" variant="outline" onPress={() => preview && exportItem(preview.item)} />
            </View>
            <View style={{ flex: 1 }}>
              <Button label="Close" onPress={closePreview} />
            </View>
          </View>
        </View>
      </Modal>

      {/* text viewer (read-only) */}
      <Modal visible={!!textView} onRequestClose={() => setTextView(null)} animationType="slide">
        <Screen>
          <Title>{textView?.item.name}</Title>
          <ScrollView style={{ flex: 1 }}>
            <Text style={{ color: theme.text, fontFamily: "monospace", fontSize: 13, lineHeight: 19 }}>{textView?.body}</Text>
          </ScrollView>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Button label="Export" variant="outline" onPress={() => textView && exportItem(textView.item)} />
            </View>
            <View style={{ flex: 1 }}>
              <Button label="Close" onPress={() => setTextView(null)} />
            </View>
          </View>
        </Screen>
      </Modal>

      {/* note editor */}
      <Modal visible={!!noteEdit} onRequestClose={() => setNoteEdit(null)} animationType="slide">
        {noteEdit && (
          <Screen>
            <Title>{noteEdit.item ? "Edit note" : "New note"}</Title>
            <Field value={noteEdit.name} onChangeText={(t) => setNoteEdit({ ...noteEdit, name: t })} placeholder="Title" />
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <Switch value={noteEdit.json} onValueChange={(v) => setNoteEdit({ ...noteEdit, json: v })} />
              <Muted>JSON mode (validates on save)</Muted>
            </View>
            <Field
              value={noteEdit.body}
              onChangeText={(t) => setNoteEdit({ ...noteEdit, body: t })}
              placeholder={noteEdit.json ? '{ "key": "value" }' : "Your secure note…"}
              multiline
            />
            <View style={{ flexDirection: "row", gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Button label="Save" onPress={saveNote} />
              </View>
              <View style={{ flex: 1 }}>
                <Button label="Cancel" variant="outline" onPress={() => setNoteEdit(null)} />
              </View>
            </View>
          </Screen>
        )}
      </Modal>

      {/* details / actions for a single item */}
      <Sheet visible={!!details} onClose={() => setDetails(null)} title={details?.name ?? ""}>
        {details && (
          <>
            <Text style={{ color: theme.muted, fontSize: 13, marginBottom: 6 }}>
              {categorize(details).toUpperCase()} · {fmtSize(details.size)} · {new Date(details.createdAt).toLocaleString()}
              {details.album ? `\nAlbum: ${details.album}` : ""}
            </Text>
            <SheetRow icon="open-outline" label="Open" onPress={() => { const d = details; setDetails(null); d && open(d); }} />
            <SheetRow icon="share-outline" label="Export" onPress={() => { const d = details; setDetails(null); d && exportItem(d); }} />
            {details.remote && details.cached === false && (
              <SheetRow icon="cloud-download-outline" label="Download (cache offline)" sub="Keep a copy on this device" onPress={() => cacheItem(details)} />
            )}
            {details.remote && details.cached !== false && (
              <SheetRow icon="cloud-done-outline" label="Remove download" sub="Frees space; stays in the cloud" onPress={() => uncacheItem(details)} />
            )}
            <SheetRow icon="albums-outline" label="Move to album" onPress={() => setAlbumTarget({ ids: [details.id] })} />
            <SheetRow icon="trash-outline" label="Delete" danger onPress={() => deleteIds([details.id])} />
          </>
        )}
      </Sheet>

      {/* album picker */}
      <AlbumPicker
        target={albumTarget}
        albums={unlocked ? vault.albums() : []}
        onCancel={() => setAlbumTarget(null)}
        onPick={(name) => albumTarget && applyAlbum(albumTarget.ids, name)}
      />
    </Screen>
  );
}

// ---- small presentational helpers ----

function BarBtn({ icon, label, onPress, danger }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; danger?: boolean }) {
  return (
    <Pressable onPress={onPress} style={{ flex: 1, alignItems: "center", gap: 2, paddingVertical: 6 }}>
      <Ionicons name={icon} size={22} color={danger ? theme.danger : theme.accent} />
      <Text style={{ color: danger ? theme.danger : theme.text, fontSize: 12 }}>{label}</Text>
    </Pressable>
  );
}

function Sheet({ visible, onClose, title, children }: { visible: boolean; onClose: () => void; title: string; children: ReactNode }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" }}>
        <Pressable
          onPress={(e) => e.stopPropagation()}
          style={{ backgroundColor: theme.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, gap: 6, borderWidth: 1, borderColor: theme.border }}
        >
          <Text numberOfLines={1} style={{ color: theme.text, fontSize: 18, fontWeight: "700", marginBottom: 8 }}>{title}</Text>
          {children}
          <View style={{ height: 8 }} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function SheetRow({ icon, label, sub, onPress, danger }: { icon: keyof typeof Ionicons.glyphMap; label: string; sub?: string; onPress: () => void; danger?: boolean }) {
  return (
    <Pressable onPress={onPress} style={{ flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 12 }}>
      <Ionicons name={icon} size={22} color={danger ? theme.danger : theme.accent} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: danger ? theme.danger : theme.text, fontSize: 16, fontWeight: "600" }}>{label}</Text>
        {sub ? <Text style={{ color: theme.muted, fontSize: 12 }}>{sub}</Text> : null}
      </View>
    </Pressable>
  );
}

function AlbumPicker({ target, albums, onCancel, onPick }: { target: AlbumTarget | null; albums: string[]; onCancel: () => void; onPick: (name: string) => void }) {
  const [name, setName] = useState("");
  return (
    <Modal visible={!!target} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", padding: 20 }}>
        <View style={{ backgroundColor: theme.bg, borderRadius: theme.radius, borderWidth: 1, borderColor: theme.border, padding: 20, gap: 12 }}>
          <Text style={{ color: theme.text, fontSize: 18, fontWeight: "700" }}>Move to album</Text>
          {albums.length > 0 && (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {albums.map((a) => (
                <Pressable key={a} onPress={() => onPick(a)} style={{ paddingHorizontal: 12, height: 32, borderRadius: 16, justifyContent: "center", backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border }}>
                  <Text style={{ color: theme.text, fontSize: 13 }}>{a}</Text>
                </Pressable>
              ))}
            </View>
          )}
          <Field value={name} onChangeText={setName} placeholder="New album name (or blank to clear)" />
          <View style={{ flexDirection: "row", gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Button label="Apply" onPress={() => { onPick(name.trim()); setName(""); }} />
            </View>
            <View style={{ flex: 1 }}>
              <Button label="Cancel" variant="outline" onPress={() => { setName(""); onCancel(); }} />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}
