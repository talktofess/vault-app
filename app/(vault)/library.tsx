// The unified vault library: one place for every kind of item — images, video,
// audio, documents, APKs, archives, notes, anything. Browse with search +
// type filters + sort, import from anywhere, open type-aware previews, and
// manage in bulk (multi-select delete / export / move-to-album).
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
  TextInput,
  View,
} from "react-native";
import { router, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { ResizeMode, Video } from "expo-av";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import { useVault } from "../../src/state/VaultContext";
import { Button, Field, Muted, Screen, Title } from "../../src/ui/components";
import { Markdown } from "../../src/ui/Markdown";
import { theme } from "../../src/ui/theme";
import { makeViewableUri, releaseViewableUri, saveBytes } from "../../src/platform/io";
import { compressImage, readFileBytes, deleteFromGallery } from "../../src/platform/media";
import { readBytesFromUri } from "../../src/platform/io";
import { streamRemoteToUri } from "../../src/platform/streamMedia";
import { syncIfLinked } from "../../src/cloud/autosync";
import { folderImportSupported, pickFolder } from "../../src/platform/folderPicker";
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
  const [grid, setGrid] = useState(false);

  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [importMenu, setImportMenu] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const syncingRef = useRef(false); // guards against overlapping syncs

  const [preview, setPreview] = useState<Preview | null>(null);
  const [textView, setTextView] = useState<TextView | null>(null);
  const [noteEdit, setNoteEdit] = useState<NoteEdit | null>(null);
  const [noteBodies, setNoteBodies] = useState<Record<string, string>>({}); // id -> lowercased body, for content search
  const [notePreview, setNotePreview] = useState(false);
  const noteSel = useRef({ start: 0, end: 0 }); // caret position for toolbar inserts
  const [details, setDetails] = useState<VaultItem | null>(null);
  const [albumTarget, setAlbumTarget] = useState<AlbumTarget | null>(null);
  const [currentAlbum, setCurrentAlbum] = useState<string | null>(null); // open folder
  const [renaming, setRenaming] = useState<VaultItem | null>(null);

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

  // ---- derived list: folder + filter + search + sort ----
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = items.filter((i) => {
      if (currentAlbum !== null && (i.album ?? "") !== currentAlbum) return false;
      if (filter !== "all" && categorize(i) !== filter) return false;
      if (q) {
        const inName = i.name.toLowerCase().includes(q);
        const inBody = i.type === "note" && (noteBodies[i.id] ?? "").includes(q);
        if (!inName && !inBody) return false;
      }
      return true;
    });
    list = [...list].sort((a, b) => {
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1; // pinned first
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "size") return b.size - a.size;
      return b.createdAt - a.createdAt;
    });
    return list;
  }, [items, query, filter, sort, currentAlbum, noteBodies]);

  // Cache decrypted note bodies (lowercased) so search can match note contents.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const missing = items.filter((i) => i.type === "note" && vault.isCached(i.id) && !(i.id in noteBodies));
      if (!missing.length) return;
      const next: Record<string, string> = {};
      for (const n of missing) {
        try {
          next[n.id] = bytesToUtf8(await vault.readItem(n.id)).toLowerCase();
        } catch {
          /* skip unreadable */
        }
      }
      if (!cancelled && Object.keys(next).length) setNoteBodies((prev) => ({ ...prev, ...next }));
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: items.length };
    for (const i of items) {
      const k = categorize(i);
      c[k] = (c[k] ?? 0) + 1;
    }
    return c;
  }, [items]);

  // Folders (albums) with their item counts, for the folder cards.
  const albums = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of items) if (i.album) m.set(i.album, (m.get(i.album) ?? 0) + 1);
    return [...m.entries()].map(([name, n]) => ({ name, n })).sort((a, b) => a.name.localeCompare(b.name));
  }, [items]);

  // ---- gallery review: step through previewable media in the current view ----
  const isPreviewable = (it: VaultItem) => {
    const c = categorize(it);
    return c === "image" || c === "video" || c === "audio";
  };
  async function gotoAdjacent(delta: number) {
    if (!preview) return;
    const media = visible.filter(isPreviewable);
    const idx = media.findIndex((i) => i.id === preview.item.id);
    const next = media[idx + delta];
    if (!next) return;
    await preview.release();
    setPreview(null);
    await open(next);
  }

  // ---- rename (edit) ----
  async function doRename(item: VaultItem, name: string) {
    const n = name.trim();
    if (!n) return;
    await vault.updateItemMeta(item.id, { name: n });
    if (item.remote && cloud) await vault.pushItemMeta(cloud.store, item.id).catch(() => {});
    setRenaming(null);
    setDetails(null);
    refresh();
  }

  async function togglePin(item: VaultItem) {
    await vault.updateItemMeta(item.id, { pinned: !item.pinned });
    setDetails(null);
    refresh();
  }

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
    let failed = 0;
    try {
      for (const asset of res.assets) {
        try {
          const hint = `${asset.fileName ?? ""} ${asset.uri ?? ""}`.toLowerCase();
          const isVideo =
            asset.type === "video" ||
            (asset.mimeType?.startsWith("video") ?? false) ||
            /\.(mp4|mov|webm|m4v|mkv|avi|3gp)(\?|$)/.test(hint);
          let bytes: Uint8Array;
          let mime: string | undefined;
          if (isVideo) {
            bytes = await readFileBytes(asset.uri); // never canvas-compress a video
            mime = asset.mimeType ?? "video/mp4";
          } else {
            // images are compressed; if that fails (e.g. odd format on web), store as-is
            try {
              bytes = await compressImage(asset.uri);
              mime = "image/jpeg";
            } catch {
              bytes = await readFileBytes(asset.uri);
              mime = asset.mimeType ?? "image/jpeg";
            }
          }
          const name = asset.fileName ?? `media_${Date.now()}`;
          await vault.addItem("media", name, bytes, { mime });
          if (asset.assetId) assetIds.push(asset.assetId);
        } catch {
          failed++;
        }
      }
      refresh();
      void runSync(true); // auto-upload new items when cloud is linked
      if (failed > 0) Alert.alert("Some items skipped", `${failed} item${failed === 1 ? "" : "s"} couldn't be read and ${failed === 1 ? "was" : "were"} skipped.`);
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
    let failed = 0;
    try {
      for (const asset of res.assets) {
        try {
          const bytes = await readBytesFromUri(asset.uri);
          // Infer the APK mime so Android offers "install" when this is exported.
          const mime =
            asset.mimeType ??
            (asset.name.toLowerCase().endsWith(".apk")
              ? "application/vnd.android.package-archive"
              : undefined);
          // Photos/videos/audio go in as media so they preview + thumbnail.
          const m = mime ?? "";
          const type = m.startsWith("image") || m.startsWith("video") || m.startsWith("audio") ? "media" : "file";
          await vault.addItem(type, asset.name, bytes, { mime });
        } catch {
          failed++;
        }
      }
      refresh();
      void runSync(true);
      if (failed > 0) Alert.alert("Some files skipped", `${failed} file${failed === 1 ? "" : "s"} couldn't be read.`);
    } catch (e) {
      Alert.alert("Import failed", e instanceof Error ? e.message : "Could not import.");
    } finally {
      setBusy(null);
    }
  }

  async function importFolder() {
    setImportMenu(false);
    let files;
    try {
      files = await pickFolder();
    } catch (e) {
      Alert.alert("Import failed", e instanceof Error ? e.message : "Could not read the folder.");
      return;
    }
    if (!files.length) return;
    setBusy(`Importing ${files.length} file${files.length === 1 ? "" : "s"}…`);
    let failed = 0;
    try {
      for (const f of files) {
        try {
          const m = f.mime ?? "";
          const type = m.startsWith("image") || m.startsWith("video") || m.startsWith("audio") ? "media" : "file";
          // preserve the folder layout: subfolders become the album
          const dir = f.relPath.split("/").slice(0, -1).join(" / ");
          await vault.addItem(type, f.name, f.bytes, { mime: f.mime, album: dir || undefined });
        } catch {
          failed++;
        }
      }
      refresh();
      void runSync(true);
      Alert.alert("Folder imported", `Added ${files.length - failed} file${files.length - failed === 1 ? "" : "s"}${failed ? `, skipped ${failed}` : ""}.`);
    } catch (e) {
      Alert.alert("Import failed", e instanceof Error ? e.message : "Could not import the folder.");
    } finally {
      setBusy(null);
    }
  }

  function newNote() {
    setImportMenu(false);
    setNotePreview(false); // new notes open in edit mode
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
        setNotePreview(true); // existing notes open rendered; tap Edit to change
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
    const created = await vault.addItem("note", name || "Untitled", utf8ToBytes(body), { isJson: json });
    if (item?.pinned) await vault.updateItemMeta(created.id, { pinned: true });
    closeNote();
    refresh();
    void runSync(true);
  }

  function closeNote() {
    setNoteEdit(null);
    setNotePreview(false);
  }

  // Insert a markdown snippet at the caret (or on a fresh line for block syntax).
  function insertMd(snippet: string, blockLevel = false) {
    if (!noteEdit) return;
    const { start, end } = noteSel.current;
    const body = noteEdit.body;
    let s = snippet;
    if (blockLevel && start > 0 && body[start - 1] !== "\n") s = "\n" + s;
    setNoteEdit({ ...noteEdit, body: body.slice(0, start) + s + body.slice(end) });
  }

  // Flip a task checkbox from the rendered preview, by source line index.
  function toggleNoteCheckbox(lineIndex: number) {
    if (!noteEdit) return;
    const lines = noteEdit.body.split("\n");
    const m = /^(\s*-\s\[)([ xX])(\]\s+.*)$/.exec(lines[lineIndex] ?? "");
    if (!m) return;
    lines[lineIndex] = m[1] + (m[2].toLowerCase() === "x" ? " " : "x") + m[3];
    setNoteEdit({ ...noteEdit, body: lines.join("\n") });
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
    for (const id of ids) {
      await vault.updateItemMeta(id, { album });
      const it = items.find((i) => i.id === id);
      if (it?.remote && cloud) await vault.pushItemMeta(cloud.store, id).catch(() => {});
    }
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
          {!selectMode && (
            <Pressable onPress={() => setGrid((g) => !g)} hitSlop={8}>
              <Ionicons name={grid ? "list-outline" : "grid-outline"} size={20} color={theme.accent} />
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
                <Text style={{ color: active ? theme.accentText : theme.text, fontWeight: "600", fontSize: 13 }}>
                  {f.label} {n > 0 ? n : ""}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* folders (albums): cards to open, or a breadcrumb when inside one */}
      {currentAlbum !== null ? (
        <Pressable onPress={() => setCurrentAlbum(null)} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Ionicons name="chevron-back" size={18} color={theme.accent} />
          <Ionicons name="folder-open" size={16} color={theme.accent} />
          <Text style={{ color: theme.text, fontWeight: "700" }} numberOfLines={1}>{currentAlbum}</Text>
          <Text style={{ color: theme.muted }}>· back to all</Text>
        </Pressable>
      ) : albums.length > 0 && filter === "all" && !query.trim() ? (
        <View style={{ height: 88 }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
            {albums.map((a) => (
              <Pressable
                key={a.name}
                onPress={() => setCurrentAlbum(a.name)}
                style={{
                  width: 124,
                  borderRadius: theme.radius,
                  padding: 12,
                  backgroundColor: theme.surface,
                  borderWidth: 1,
                  borderColor: theme.border,
                  justifyContent: "space-between",
                }}
              >
                <Ionicons name="folder" size={26} color={theme.accent} />
                <View style={{ marginTop: 10 }}>
                  <Text numberOfLines={1} style={{ color: theme.text, fontWeight: "600", fontSize: 13 }}>{a.name}</Text>
                  <Text style={{ color: theme.muted, fontSize: 11 }}>{a.n} item{a.n === 1 ? "" : "s"}</Text>
                </View>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}

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
          key={grid ? "grid" : "list"}
          numColumns={grid ? 3 : 1}
          columnWrapperStyle={grid ? { gap: 8 } : undefined}
          contentContainerStyle={{ gap: 8, paddingBottom: selectMode ? 90 : 80 }}
          removeClippedSubviews
          renderItem={({ item }) => {
            const cat = categorize(item);
            const isSel = selected.has(item.id);
            if (grid) {
              return (
                <Pressable
                  onPress={() => (selectMode ? toggleSelect(item.id) : open(item))}
                  onLongPress={() => !selectMode && startSelect(item.id)}
                  style={{
                    flex: 1 / 3,
                    aspectRatio: 1,
                    backgroundColor: theme.surface,
                    borderRadius: theme.radius,
                    borderWidth: 1,
                    borderColor: isSel ? theme.accent : theme.border,
                    overflow: "hidden",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {cat === "image" && vault.isCached(item.id) ? (
                    <Thumb item={item} getBytes={readBytes} fill />
                  ) : (
                    <Ionicons name={CATEGORY_ICON[cat]} size={36} color={CATEGORY_COLOR[cat]} />
                  )}
                  <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.55)", paddingHorizontal: 6, paddingVertical: 4 }}>
                    <Text numberOfLines={1} style={{ color: "#fff", fontSize: 10 }}>{item.name}</Text>
                  </View>
                  {item.remote && (
                    <Ionicons
                      name={item.cached === false ? "cloud-outline" : "cloud-done-outline"}
                      size={14}
                      color={item.cached === false ? "#fff" : theme.good}
                      style={{ position: "absolute", top: 6, right: 6 }}
                    />
                  )}
                  {selectMode && (
                    <Ionicons
                      name={isSel ? "checkmark-circle" : "ellipse-outline"}
                      size={22}
                      color={isSel ? theme.accent : "#fff"}
                      style={{ position: "absolute", top: 6, left: 6 }}
                    />
                  )}
                </Pressable>
              );
            }
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
                {cat === "image" && vault.isCached(item.id) ? (
                  <Thumb item={item} getBytes={readBytes} />
                ) : (
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
                )}
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={1} style={{ color: theme.text, fontWeight: "600" }}>
                    {item.name}
                  </Text>
                  <Text style={{ color: theme.muted, fontSize: 12 }}>
                    {cat.toUpperCase()} · {fmtSize(item.size)} · {new Date(item.createdAt).toLocaleDateString()}
                    {item.album ? ` · ${item.album}` : ""}
                  </Text>
                </View>
                {item.pinned && <Ionicons name="star" size={14} color={theme.accent} />}
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

      {/* compact floating add button */}
      {!selectMode && (
        <Pressable
          onPress={() => setImportMenu(true)}
          style={{
            position: "absolute",
            right: 18,
            bottom: 22,
            width: 58,
            height: 58,
            borderRadius: 29,
            backgroundColor: theme.accent,
            alignItems: "center",
            justifyContent: "center",
            shadowColor: "#000",
            shadowOpacity: 0.4,
            shadowRadius: 8,
            shadowOffset: { width: 0, height: 4 },
            elevation: 8,
          }}
        >
          <Ionicons name="add" size={32} color={theme.accentText} />
        </Pressable>
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
        <SheetRow icon="images-outline" label="Photos / videos" sub="Pick one or many; images are compressed" onPress={importPhotos} />
        <SheetRow icon="document-outline" label="Any file(s)" sub="Pick one or many — documents, APKs, archives, any format" onPress={importFiles} />
        {folderImportSupported && (
          <SheetRow icon="folder-outline" label="Whole folder" sub="Imports every file (and subfolders) — kept as albums" onPress={importFolder} />
        )}
        <SheetRow icon="camera-outline" label="Camera" sub="Capture straight into the vault" onPress={goCamera} />
        <SheetRow icon="create-outline" label="New note" sub="Encrypted text or JSON" onPress={newNote} />
      </Sheet>

      {/* image / video / audio preview — swipe through the current view */}
      <Modal visible={!!preview} onRequestClose={closePreview} animationType="fade">
        <View style={{ flex: 1, backgroundColor: "#000", justifyContent: "center" }}>
          {preview && !preview.av && <Image source={{ uri: preview.uri }} style={{ flex: 1 }} resizeMode="contain" />}
          {preview && preview.av && (
            <Video source={{ uri: preview.uri }} style={{ flex: 1 }} useNativeControls resizeMode={ResizeMode.CONTAIN} shouldPlay />
          )}

          {/* title + position */}
          {preview && (
            <View style={{ position: "absolute", top: 44, left: 16, right: 16, alignItems: "center" }}>
              <Text numberOfLines={1} style={{ color: "#fff", fontWeight: "700" }}>{preview.item.name}</Text>
              {(() => {
                const media = visible.filter(isPreviewable);
                const i = media.findIndex((m) => m.id === preview.item.id);
                return media.length > 1 ? (
                  <Text style={{ color: "rgba(255,255,255,0.6)", fontSize: 12 }}>{i + 1} / {media.length}</Text>
                ) : null;
              })()}
            </View>
          )}

          {/* prev / next */}
          <Pressable onPress={() => gotoAdjacent(-1)} hitSlop={6} style={{ position: "absolute", left: 0, top: 70, bottom: 90, width: 64, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="chevron-back" size={36} color="rgba(255,255,255,0.6)" />
          </Pressable>
          <Pressable onPress={() => gotoAdjacent(1)} hitSlop={6} style={{ position: "absolute", right: 0, top: 70, bottom: 90, width: 64, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="chevron-forward" size={36} color="rgba(255,255,255,0.6)" />
          </Pressable>

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

      {/* note editor — markdown with live preview + checklists */}
      <Modal visible={!!noteEdit} onRequestClose={closeNote} animationType="slide">
        {noteEdit && (
          <Screen>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Pressable onPress={closeNote} hitSlop={8}>
                <Text style={{ color: theme.muted, fontSize: 16 }}>Cancel</Text>
              </Pressable>
              <Pressable onPress={() => setNotePreview((p) => !p)} hitSlop={8} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Ionicons name={notePreview ? "create-outline" : "eye-outline"} size={18} color={theme.accent} />
                <Text style={{ color: theme.accent, fontSize: 14 }}>{notePreview ? "Edit" : "Preview"}</Text>
              </Pressable>
              <Pressable onPress={saveNote} hitSlop={8}>
                <Text style={{ color: theme.accent, fontSize: 16, fontWeight: "700" }}>Save</Text>
              </Pressable>
            </View>
            <TextInput
              value={noteEdit.name}
              onChangeText={(t) => setNoteEdit({ ...noteEdit, name: t })}
              placeholder="Title"
              placeholderTextColor={theme.muted}
              style={{ color: theme.text, fontSize: 22, fontWeight: "700", paddingVertical: 6 }}
            />

            {notePreview ? (
              <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 30 }}>
                {noteEdit.body.trim() ? (
                  <Markdown source={noteEdit.body} onToggleCheckbox={toggleNoteCheckbox} />
                ) : (
                  <Muted>Nothing to preview yet — tap Edit and start writing.</Muted>
                )}
              </ScrollView>
            ) : (
              <>
                <TextInput
                  value={noteEdit.body}
                  onChangeText={(t) => setNoteEdit({ ...noteEdit, body: t })}
                  onSelectionChange={(e) => (noteSel.current = e.nativeEvent.selection)}
                  placeholder="Start writing… use the bar below for headings, lists and checkboxes."
                  placeholderTextColor={theme.muted}
                  multiline
                  autoFocus={!noteEdit.item}
                  textAlignVertical="top"
                  style={{ flex: 1, color: theme.text, fontSize: 17, lineHeight: 25 }}
                />
                {/* formatting toolbar */}
                <View style={{ flexDirection: "row", gap: 6, paddingTop: 8, borderTopWidth: 1, borderTopColor: theme.border }}>
                  <MdBtn label="H1" onPress={() => insertMd("# ", true)} />
                  <MdBtn label="H2" onPress={() => insertMd("## ", true)} />
                  <MdBtn icon="text" onPress={() => insertMd("**bold**")} />
                  <MdBtn icon="list" onPress={() => insertMd("- ", true)} />
                  <MdBtn icon="checkbox-outline" onPress={() => insertMd("- [ ] ", true)} />
                  <MdBtn icon="code-slash" onPress={() => insertMd("`code`")} />
                  <MdBtn icon="remove" onPress={() => insertMd("\n---\n")} />
                </View>
              </>
            )}
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
            <SheetRow icon="create-outline" label="Rename" onPress={() => setRenaming(details)} />
            <SheetRow icon={details.pinned ? "star" : "star-outline"} label={details.pinned ? "Unpin" : "Pin to top"} onPress={() => togglePin(details)} />
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

      {/* rename */}
      <RenameModal item={renaming} onCancel={() => setRenaming(null)} onSave={(name) => renaming && doRename(renaming, name)} />
    </Screen>
  );
}

function RenameModal({ item, onCancel, onSave }: { item: VaultItem | null; onCancel: () => void; onSave: (name: string) => void }) {
  const [name, setName] = useState("");
  useEffect(() => {
    if (item) setName(item.name);
  }, [item]);
  return (
    <Modal visible={!!item} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", padding: 20 }}>
        <View style={{ backgroundColor: theme.bg, borderRadius: theme.radius, borderWidth: 1, borderColor: theme.border, padding: 20, gap: 12 }}>
          <Text style={{ color: theme.text, fontSize: 18, fontWeight: "700" }}>Rename</Text>
          <Field value={name} onChangeText={setName} placeholder="Name" autoFocus />
          <View style={{ flexDirection: "row", gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Button label="Save" onPress={() => onSave(name)} />
            </View>
            <View style={{ flex: 1 }}>
              <Button label="Cancel" variant="outline" onPress={onCancel} />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ---- small presentational helpers ----

// Lazy thumbnail for a cached/local image: decrypt to a viewable URI on mount,
// release it on unmount. Falls back to an icon while loading / on failure.
function Thumb({ item, getBytes, fill }: { item: VaultItem; getBytes: (i: VaultItem) => Promise<Uint8Array>; fill?: boolean }) {
  const [uri, setUri] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    let made: string | null = null;
    (async () => {
      try {
        const data = await getBytes(item);
        const u = await makeViewableUri(item.id + "_thumb", data, viewExt(item));
        if (active) {
          setUri(u);
          made = u;
        } else {
          releaseViewableUri(u);
        }
      } catch {
        /* show the icon fallback */
      }
    })();
    return () => {
      active = false;
      if (made) releaseViewableUri(made);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  const box = fill ? { width: "100%" as const, height: "100%" as const } : { width: 46, height: 46, borderRadius: 12 };
  if (!uri) {
    return (
      <View style={{ ...box, backgroundColor: CATEGORY_COLOR.image + "22", alignItems: "center", justifyContent: "center" }}>
        <Ionicons name="image" size={fill ? 34 : 24} color={CATEGORY_COLOR.image} />
      </View>
    );
  }
  return <Image source={{ uri }} style={box} resizeMode="cover" />;
}

function MdBtn({ label, icon, onPress }: { label?: string; icon?: keyof typeof Ionicons.glyphMap; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={{ flex: 1, height: 40, borderRadius: theme.radiusSm, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, alignItems: "center", justifyContent: "center" }}
    >
      {icon ? <Ionicons name={icon} size={18} color={theme.text} /> : <Text style={{ color: theme.text, fontWeight: "700", fontSize: 13 }}>{label}</Text>}
    </Pressable>
  );
}

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
