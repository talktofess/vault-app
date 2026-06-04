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
  useWindowDimensions,
  View,
} from "react-native";
import { router, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import { useVault } from "../../src/state/VaultContext";
import { Button, Field, Muted, Screen, Title } from "../../src/ui/components";
import { Markdown } from "../../src/ui/Markdown";
import { VideoPlayer } from "../../src/ui/VideoPlayer";
import { TrimModal } from "../../src/ui/TrimModal";
import { trimSupported } from "../../src/platform/trim";
import { makeVideoPoster, posterSupported } from "../../src/platform/poster";
import { theme } from "../../src/ui/theme";
import { makeViewableUri, releaseViewableUri, saveBytes } from "../../src/platform/io";
import { compressImage, readFileBytes, deleteFromGallery, probeMime } from "../../src/platform/media";
import { readBytesFromUri } from "../../src/platform/io";
import { streamRemoteToUri } from "../../src/platform/streamMedia";
import { syncIfLinked } from "../../src/cloud/autosync";
import { errorText } from "../../src/cloud/errors";
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
import type { ItemType, VaultItem } from "../../src/vault/types";

type Sort = "new" | "name" | "size";
type Preview = { uri: string; item: VaultItem; av: boolean; release: () => Promise<void> | void };
type NoteEdit = { item?: VaultItem; name: string; body: string; json: boolean };
type TextView = { item: VaultItem; body: string };
type AlbumTarget = { ids: string[] };
// An item picked but not yet saved — shown in the pre-upload review.
type Pending = {
  key: string;
  name: string;
  bytes: Uint8Array;
  mime?: string;
  type: ItemType;
  album?: string;
  uri?: string; // image preview / playable video (object URL) — released on save/discard
  poster?: string; // video poster-frame (object URL) for the review thumbnail
  posterBytes?: Uint8Array; // the same poster as bytes, stored with the item on save
  cat: FileCategory;
};

type Section = "home" | "all" | "folders" | FileCategory;
// The horizontal format tabs under the search bar — icon-only for a minimal
// look. Shown even when empty so a format is always one tap away.
const TABS: { key: Section; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: "home", label: "Home", icon: "home-outline" },
  { key: "all", label: "All", icon: "albums-outline" },
  { key: "image", label: "Images", icon: "image-outline" },
  { key: "video", label: "Videos", icon: "videocam-outline" },
  { key: "audio", label: "Audio", icon: "musical-notes-outline" },
  { key: "document", label: "Docs", icon: "document-text-outline" },
  { key: "note", label: "Notes", icon: "create-outline" },
  { key: "folders", label: "Folders", icon: "folder-outline" },
];

export default function Library() {
  const { vault, unlocked, cloud, withoutAutoLock } = useVault();
  const [items, setItems] = useState<VaultItem[]>([]);
  const [folders, setFolders] = useState<string[]>([]); // explicitly-created folders
  const [query, setQuery] = useState("");
  // "home" = the category tiles; "all"/"folders"/a category = a focused view.
  const [section, setSection] = useState<Section>("home");
  const [sort, setSort] = useState<Sort>("new");
  const [grid, setGrid] = useState(true); // everything is tiles by default
  const { width: winW } = useWindowDimensions();
  // Really tiny, fixed-size tiles; pack as many as fit (minus the side rail on
  // wide screens). Fixed width keeps them tiny even when a row isn't full.
  const TILE = winW >= 720 ? 88 : 80;
  const cols = Math.max(3, Math.floor((winW - (winW >= 720 ? 96 : 24)) / (TILE + 6)));

  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [importMenu, setImportMenu] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const syncingRef = useRef(false); // guards against overlapping syncs

  const [preview, setPreview] = useState<Preview | null>(null);
  const [playlistOpen, setPlaylistOpen] = useState(false); // "up next" drawer in the viewer
  const [textView, setTextView] = useState<TextView | null>(null);
  const [noteEdit, setNoteEdit] = useState<NoteEdit | null>(null);
  const [noteBodies, setNoteBodies] = useState<Record<string, string>>({}); // id -> lowercased body, for content search
  const [notePreview, setNotePreview] = useState(false);
  const noteSel = useRef({ start: 0, end: 0 }); // caret position for toolbar inserts
  const [details, setDetails] = useState<VaultItem | null>(null);
  const [albumTarget, setAlbumTarget] = useState<AlbumTarget | null>(null);
  const [currentAlbum, setCurrentAlbum] = useState<string | null>(null); // open folder
  const [newFolderOpen, setNewFolderOpen] = useState(false); // create-folder prompt
  const [renaming, setRenaming] = useState<VaultItem | null>(null);
  const [review, setReview] = useState<Pending[] | null>(null); // pre-upload review
  const [reviewBusy, setReviewBusy] = useState(false);
  const [trimming, setTrimming] = useState<Pending | null>(null); // video being trimmed
  const [cloudLinked, setCloudLinked] = useState<boolean | null>(null); // null = unknown
  const [syncBannerOff, setSyncBannerOff] = useState(false);
  const pendingAssetIds = useRef<string[]>([]); // gallery ids to optionally delete after saving

  const refresh = useCallback(() => {
    if (unlocked) {
      setItems(vault.listItems().filter((i) => i.type !== "credential"));
      setFolders(vault.listFolders());
    }
  }, [vault, unlocked]);

  useFocusEffect(
    useCallback(() => {
      refresh();
      void runSync(true); // opportunistic background sync on entering the Library
      // is this device linked to cloud sync? (drives the "connect" prompt)
      (async () => {
        if (!cloud) return; // no cloud configured -> no prompt
        try {
          const uid = await cloud.auth.currentUserId();
          setCloudLinked(!!uid && (await vault.cloudEnabled(cloud.store)));
        } catch {
          setCloudLinked(false);
        }
      })();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [refresh])
  );

  // ---- derived list: section + folder + search + sort ----
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const isCat = section !== "home" && section !== "all" && section !== "folders";
    let list = items.filter((i) => {
      if (currentAlbum !== null && (i.album ?? "") !== currentAlbum) return false;
      if (isCat && categorize(i) !== section) return false;
      if (q) {
        const inName = i.name.toLowerCase().includes(q);
        const inBody = i.type === "note" && (noteBodies[i.id] ?? "").toLowerCase().includes(q);
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
  }, [items, query, section, sort, currentAlbum, noteBodies]);

  // Cache decrypted note bodies (lowercased) so search can match note contents.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const missing = items.filter((i) => i.type === "note" && vault.isCached(i.id) && !(i.id in noteBodies));
      if (!missing.length) return;
      const next: Record<string, string> = {};
      for (const n of missing) {
        try {
          next[n.id] = bytesToUtf8(await vault.readItem(n.id)).slice(0, 280); // original case, for snippet + search
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

  // Folders (albums) with their item counts — explicitly-created folders are
  // included (count 0 until something is added), plus any content-derived ones.
  const albums = useMemo(() => {
    const m = new Map<string, number>();
    for (const f of folders) m.set(f, 0);
    for (const i of items) if (i.album) m.set(i.album, (m.get(i.album) ?? 0) + 1);
    return [...m.entries()].map(([name, n]) => ({ name, n })).sort((a, b) => a.name.localeCompare(b.name));
  }, [items, folders]);

  // Categories that actually have items, for the home tiles.
  const homeCats = useMemo(() => {
    const order: FileCategory[] = ["image", "video", "audio", "document", "apk", "archive", "note", "other"];
    return order.filter((c) => (counts[c] ?? 0) > 0);
  }, [counts]);

  const sectionLabel = (s: typeof section) =>
    s === "all" ? "All items" : s === "folders" ? "Folders" : FILTERS.find((f) => f.key === s)?.label ?? "Items";

  function openSection(s: typeof section) {
    setCurrentAlbum(null);
    setQuery("");
    setSection(s);
  }
  function goBack() {
    if (currentAlbum !== null) setCurrentAlbum(null);
    else {
      setSection("home");
      setQuery("");
    }
  }

  // Create a new (empty) folder and open it, so files can be added into it.
  async function makeFolder(name: string) {
    const n = name.trim();
    setNewFolderOpen(false);
    if (!n) return;
    await vault.createFolder(n);
    refresh();
    setSection("folders");
    setQuery("");
    setCurrentAlbum(n);
  }

  // The add action + label for the current section, so each format's view has
  // its own "Add videos" / "Add photos" / "Add files" button. Inside a folder,
  // adding drops the files into that folder; the Folders root creates one.
  function addForSection() {
    if (currentAlbum !== null) return setImportMenu(true); // add into the open folder
    if (section === "image") return importPhotos("image");
    if (section === "video") return importPhotos("video");
    if (section === "note") return newNote();
    if (section === "folders") return setNewFolderOpen(true);
    if (section === "home" || section === "all") return setImportMenu(true);
    return importFiles(); // audio / document / apk / archive / other
  }
  const addLabel =
    currentAlbum !== null
      ? "Add to folder"
      : section === "image"
        ? "Add photos"
        : section === "video"
          ? "Add videos"
          : section === "note"
            ? "Add note"
            : section === "folders"
              ? "New folder"
              : section === "audio"
                ? "Add audio"
                : section === "document"
                  ? "Add docs"
                  : "Add files";

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
  // Jump straight to a specific item from the "up next" playlist in the viewer.
  async function goToItem(item: VaultItem) {
    if (!preview || preview.item.id === item.id) return;
    await preview.release();
    setPreview(null);
    await open(item);
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

  // ---- import: pick -> review -> save ----
  // Build a not-yet-saved item (with an image preview) for the review screen.
  async function toPending(name: string, bytes: Uint8Array, mime: string | undefined, type: ItemType, album?: string): Promise<Pending> {
    const probe = { id: "", type, name, mime, size: bytes.length, createdAt: 0 } as VaultItem;
    const cat = categorize(probe);
    let uri: string | undefined;
    let poster: string | undefined;
    let posterBytes: Uint8Array | undefined;
    // Images get a thumbnail; videos get a playable URL so the trimmer can scrub
    // them before saving. (Both are object URLs on web, released on save/discard.)
    if (cat === "image" || cat === "video") {
      try {
        uri = await makeViewableUri(`rev_${Math.random().toString(36).slice(2)}`, bytes, viewExt(probe));
      } catch {
        /* no preview */
      }
    }
    // Grab a poster frame so the review shows what the video is, not a blank box.
    // The bytes are kept too, to store alongside the item (cheap grid previews).
    if (cat === "video" && uri && posterSupported) {
      try {
        posterBytes = (await makeVideoPoster(uri)) ?? undefined;
        if (posterBytes) poster = await makeViewableUri(`pos_${Math.random().toString(36).slice(2)}`, posterBytes, "jpg");
      } catch {
        /* fall back to the icon */
      }
    }
    return { key: `${name}_${Math.random().toString(36).slice(2)}`, name, bytes, mime, type, album, uri, poster, posterBytes, cat };
  }

  async function importPhotos(kind: "all" | "image" | "video" = "all") {
    setImportMenu(false);
    const res = await withoutAutoLock(() =>
      ImagePicker.launchImageLibraryAsync({
        mediaTypes:
          kind === "image"
            ? ImagePicker.MediaTypeOptions.Images
            : kind === "video"
              ? ImagePicker.MediaTypeOptions.Videos
              : ImagePicker.MediaTypeOptions.All,
        quality: 1,
        allowsMultipleSelection: true,
      })
    );
    if (res.canceled) return;
    setBusy("Reading…");
    const pend: Pending[] = [];
    const ids: string[] = [];
    try {
      for (const asset of res.assets) {
        try {
          // The web picker drops type/filename, so read the real mime off the blob.
          const realMime = asset.mimeType ?? (await probeMime(asset.uri));
          const hint = `${asset.fileName ?? ""} ${asset.uri ?? ""}`.toLowerCase();
          const isVideo =
            asset.type === "video" ||
            (realMime?.startsWith("video") ?? false) ||
            /\.(mp4|mov|webm|m4v|mkv|avi|3gp)(\?|$)/.test(hint);
          const isAudio = realMime?.startsWith("audio") ?? false;
          let bytes: Uint8Array;
          let mime: string | undefined;
          if (isVideo || isAudio) {
            bytes = await readFileBytes(asset.uri); // never canvas-compress a/v
            mime = realMime ?? (isVideo ? "video/mp4" : "audio/mpeg");
          } else {
            try {
              bytes = await compressImage(asset.uri);
              mime = "image/jpeg";
            } catch {
              bytes = await readFileBytes(asset.uri);
              mime = realMime ?? "image/jpeg";
            }
          }
          const ext = (mime?.split("/")[1] || "bin").replace("jpeg", "jpg").replace("quicktime", "mov");
          const name = asset.fileName ?? `${isVideo ? "video" : isAudio ? "audio" : "photo"}_${Date.now()}.${ext}`;
          pend.push(await toPending(name, bytes, mime, "media", currentAlbum ?? undefined));
          if (asset.assetId) ids.push(asset.assetId);
        } catch {
          /* skip unreadable */
        }
      }
    } finally {
      setBusy(null);
    }
    pendingAssetIds.current = ids;
    if (pend.length) setReview(pend);
  }

  async function importFiles() {
    setImportMenu(false);
    const res = await withoutAutoLock(() => DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true }));
    if (res.canceled) return;
    setBusy("Reading…");
    const pend: Pending[] = [];
    try {
      for (const asset of res.assets) {
        try {
          const bytes = await readBytesFromUri(asset.uri);
          const mime =
            asset.mimeType ??
            (asset.name.toLowerCase().endsWith(".apk") ? "application/vnd.android.package-archive" : undefined);
          const m = mime ?? "";
          const type = m.startsWith("image") || m.startsWith("video") || m.startsWith("audio") ? "media" : "file";
          pend.push(await toPending(asset.name, bytes, mime, type, currentAlbum ?? undefined));
        } catch {
          /* skip */
        }
      }
    } finally {
      setBusy(null);
    }
    if (pend.length) setReview(pend);
  }

  // Whole-folder import. A real folder can hold hundreds of files of every kind
  // (and nested subfolders), so we DON'T route it through the review screen or
  // hold it all in memory: we read + encrypt + store one file at a time, keeping
  // each subfolder as its own album, and report the result. Failures are
  // surfaced (it used to silently add nothing).
  async function importFolder() {
    setImportMenu(false);
    const baseAlbum = currentAlbum ?? ""; // if inside a folder, nest under it
    let files;
    try {
      files = await withoutAutoLock(() => pickFolder());
    } catch (e) {
      Alert.alert("Couldn't read folder", e instanceof Error ? e.message : "Failed.");
      return;
    }
    if (!files.length) return; // cancelled

    let added = 0;
    let failed = 0;
    const newAlbums = new Set<string>();
    try {
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        setBusy(`Importing ${i + 1} / ${files.length}…`);
        try {
          const bytes = await f.read();
          const m = f.mime ?? "";
          const type = m.startsWith("image") || m.startsWith("video") || m.startsWith("audio") ? "media" : "file";
          // subfolders -> album; drop the chosen folder's own top segment is kept
          const sub = f.relPath.split("/").slice(0, -1).join(" / ");
          const album = [baseAlbum, sub].filter(Boolean).join(" / ") || undefined;
          if (album) newAlbums.add(album);
          // a poster for videos (sequential, so memory stays bounded)
          let thumb: Uint8Array | undefined;
          const probe = { id: "", type, name: f.name, mime: f.mime, size: bytes.length, createdAt: 0 } as VaultItem;
          if (categorize(probe) === "video" && posterSupported) {
            try {
              const u = await makeViewableUri(`fi_${i}`, bytes, viewExt(probe));
              thumb = (await makeVideoPoster(u)) ?? undefined;
              releaseViewableUri(u);
            } catch {
              /* no poster */
            }
          }
          await vault.addItem(type, f.name, bytes, { mime: f.mime, album, thumb });
          added++;
        } catch {
          failed++;
        }
      }
      // remember the (sub)folders so they persist even if later emptied
      for (const a of newAlbums) await vault.createFolder(a).catch(() => {});
    } finally {
      setBusy(null);
    }
    refresh();
    void runSync(true);
    Alert.alert(
      "Folder imported",
      `Added ${added} file${added === 1 ? "" : "s"}${failed ? `, ${failed} skipped` : ""} — encrypted in your vault.`
    );
  }

  // ---- review actions ----
  function setReviewName(key: string, name: string) {
    setReview((r) => (r ? r.map((p) => (p.key === key ? { ...p, name } : p)) : r));
  }
  function removeReview(key: string) {
    setReview((r) => {
      const it = r?.find((p) => p.key === key);
      if (it?.uri) void releaseViewableUri(it.uri);
      if (it?.poster) void releaseViewableUri(it.poster);
      return r ? r.filter((p) => p.key !== key) : r;
    });
  }
  function discardReview() {
    review?.forEach((p) => {
      if (p.uri) void releaseViewableUri(p.uri);
      if (p.poster) void releaseViewableUri(p.poster);
    });
    pendingAssetIds.current = [];
    setReview(null);
  }
  // Replace a pending video's bytes with a trimmed cut, refreshing its preview
  // URL (the old object URL is freed) so re-opening the trimmer shows the clip.
  async function applyTrim(key: string, out: Uint8Array) {
    const old = review?.find((p) => p.key === key);
    let uri: string | undefined;
    let poster: string | undefined;
    let posterBytes: Uint8Array | undefined;
    if (old) {
      try {
        const probe = { id: "", type: old.type, name: old.name, mime: old.mime, size: out.length, createdAt: 0 } as VaultItem;
        uri = await makeViewableUri(`rev_${Math.random().toString(36).slice(2)}`, out, viewExt(probe));
        if (uri && posterSupported) {
          posterBytes = (await makeVideoPoster(uri)) ?? undefined;
          if (posterBytes) poster = await makeViewableUri(`pos_${Math.random().toString(36).slice(2)}`, posterBytes, "jpg");
        }
      } catch {
        /* keep playable-less */
      }
      if (old.uri) void releaseViewableUri(old.uri);
      if (old.poster) void releaseViewableUri(old.poster);
    }
    setReview((r) => (r ? r.map((p) => (p.key === key ? { ...p, bytes: out, uri, poster, posterBytes } : p)) : r));
    setTrimming(null);
  }
  async function commitReview() {
    if (!review) return;
    setReviewBusy(true);
    try {
      for (const p of review) {
        await vault.addItem(p.type, p.name.trim() || "Untitled", p.bytes, { mime: p.mime, album: p.album, thumb: p.posterBytes });
      }
      review.forEach((p) => {
        if (p.uri) void releaseViewableUri(p.uri);
        if (p.poster) void releaseViewableUri(p.poster);
      });
      setReview(null);
      refresh();
      void runSync(true);
      const ids = pendingAssetIds.current;
      pendingAssetIds.current = [];
      if (ids.length > 0) {
        Alert.alert("Remove originals?", "Delete the imported items from your device gallery? They're safely stored here.", [
          { text: "Keep", style: "cancel" },
          { text: "Delete from gallery", style: "destructive", onPress: () => deleteFromGallery(ids) },
        ]);
      }
    } catch (e) {
      Alert.alert("Couldn't save", e instanceof Error ? e.message : "Failed.");
    } finally {
      setReviewBusy(false);
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

  // Back this item up to Supabase now (encrypted).
  async function backupItem(item: VaultItem) {
    if (!cloud) return;
    setBusy("Backing up…");
    try {
      const uid = await cloud.auth.currentUserId();
      if (!uid) throw new Error("Connect cloud sync first (Settings → Cloud sync).");
      await vault.enableBackup(cloud.store, uid, item.id);
      refresh();
    } catch (e) {
      Alert.alert("Backup failed", e instanceof Error ? e.message : "Failed.");
    } finally {
      setBusy(null);
      setDetails(null);
    }
  }

  // Remove the Supabase backup but keep the file on this device.
  async function removeBackup(item: VaultItem) {
    if (!cloud) return;
    setBusy("Removing backup…");
    try {
      await vault.deleteFromCloud(cloud.store, item.id);
      refresh();
    } catch (e) {
      Alert.alert("Couldn't remove backup", e instanceof Error ? e.message : "Failed.");
    } finally {
      setBusy(null);
      setDetails(null);
    }
  }

  // Delete from both this device AND the cloud.
  function deleteEverywhere(item: VaultItem) {
    Alert.alert("Delete everywhere?", `"${item.name}" will be removed from this device and your Supabase backup.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete everywhere",
        style: "destructive",
        onPress: async () => {
          try {
            if (cloud) await vault.deleteEverywhere(cloud.store, item.id);
            else await vault.deleteItem(item.id);
            refresh();
          } catch (e) {
            Alert.alert("Delete failed", e instanceof Error ? e.message : "Failed.");
          } finally {
            setDetails(null);
          }
        },
      },
    ]);
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
        if (!silent) Alert.alert("Sync failed", errorText(e));
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
    setPlaylistOpen(false);
  }

  async function exportItem(item: VaultItem) {
    try {
      const data = await readBytes(item);
      // the share sheet backgrounds the app too — don't auto-lock during it
      await withoutAutoLock(() => saveBytes(item.name, item.mime, data));
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
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        {section === "home" ? (
          <Title>Vault</Title>
        ) : (
          <Pressable testID="nav-back" onPress={goBack} hitSlop={6} style={{ flexDirection: "row", alignItems: "center", gap: 4, flex: 1 }}>
            <Ionicons name="chevron-back" size={26} color={theme.text} />
            <Text numberOfLines={1} style={{ color: theme.text, fontSize: 24, fontWeight: "800", letterSpacing: -0.4 }}>
              {currentAlbum ?? sectionLabel(section)}
            </Text>
          </Pressable>
        )}
        <View style={{ flexDirection: "row", gap: 16, alignItems: "center" }}>
          {cloud && !selectMode && (
            <Pressable onPress={() => runSync(false)} hitSlop={8} disabled={syncing}>
              {syncing ? <ActivityIndicator size="small" color={theme.accent} /> : <Ionicons name="sync" size={20} color={theme.accent} />}
            </Pressable>
          )}
          {section !== "home" && !selectMode && (
            <Pressable onPress={() => setGrid((g) => !g)} hitSlop={8}>
              <Ionicons name={grid ? "list-outline" : "grid-outline"} size={20} color={theme.accent} />
            </Pressable>
          )}
          {section !== "home" && !selectMode && (
            <Pressable onPress={() => setSort(sort === "new" ? "name" : sort === "name" ? "size" : "new")} hitSlop={8}>
              <Ionicons name={sort === "new" ? "time-outline" : sort === "name" ? "text-outline" : "swap-vertical-outline"} size={20} color={theme.accent} />
            </Pressable>
          )}
          {section !== "home" && (
            <Pressable onPress={() => (selectMode ? clearSelect() : setSelectMode(true))} hitSlop={8}>
              <Ionicons name={selectMode ? "close-outline" : "checkmark-circle-outline"} size={22} color={theme.accent} />
            </Pressable>
          )}
        </View>
      </View>

      <Field value={query} onChangeText={setQuery} placeholder={section === "home" ? "Search everything…" : "Search…"} />

      {/* format tabs — icon-only quick-switch between every kind of item */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0, flexShrink: 0, marginBottom: 4 }}
        contentContainerStyle={{ gap: 8, paddingVertical: 8 }}
      >
        {TABS.map((t) => {
          const active = section === t.key;
          return (
            <Pressable
              key={t.key}
              onPress={() => openSection(t.key)}
              testID={`tab-${t.key}`}
              accessibilityLabel={t.label}
              style={{
                width: 40,
                height: 40,
                borderRadius: 20,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: active ? theme.accent : theme.surface,
                borderWidth: 1,
                borderColor: active ? theme.accent : theme.border,
              }}
            >
              <Ionicons name={t.icon} size={20} color={active ? theme.accentText : theme.muted} />
            </Pressable>
          );
        })}
      </ScrollView>

      {/* cloud-sync prompt — shown until this device is linked */}
      {section === "home" && cloud && cloudLinked === false && !syncBannerOff && (
        <Pressable
          onPress={() => router.push("/(vault)/cloud")}
          style={{ flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: theme.surfaceAlt, borderWidth: 1, borderColor: theme.border, borderRadius: theme.radius, padding: 12, marginBottom: 8 }}
        >
          <Ionicons name="cloud-outline" size={22} color={theme.accent} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: theme.text, fontWeight: "700", fontSize: 13 }}>Sync across your devices</Text>
            <Text style={{ color: theme.muted, fontSize: 12 }}>Connect with your safe words to see this vault on every device.</Text>
          </View>
          <Pressable onPress={() => setSyncBannerOff(true)} hitSlop={10}>
            <Ionicons name="close" size={18} color={theme.muted} />
          </Pressable>
        </Pressable>
      )}

      {section === "folders" && currentAlbum === null ? (
        // folders: a grid of album tiles, led by a "New folder" tile
        <ScrollView contentContainerStyle={{ paddingBottom: 90 }}>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            <Pressable
              onPress={() => setNewFolderOpen(true)}
              testID="new-folder-tile"
              style={{
                width: 104,
                aspectRatio: 1,
                borderRadius: theme.radiusSm,
                backgroundColor: theme.surface,
                borderWidth: 1.5,
                borderColor: theme.accent,
                borderStyle: "dashed",
                alignItems: "center",
                justifyContent: "center",
                gap: 4,
              }}
            >
              <Ionicons name="add-circle-outline" size={24} color={theme.accent} />
              <Text style={{ color: theme.accent, fontWeight: "700", fontSize: 11 }}>New folder</Text>
            </Pressable>
            {albums.map((a) => (
              <CategoryTile key={a.name} label={a.name} icon="folder" color="#c79a63" count={a.n} onPress={() => setCurrentAlbum(a.name)} />
            ))}
          </View>
          {albums.length === 0 && (
            <Muted>{"\n"}Create a folder above, then open it and tap “Add to folder”. On a computer you can also import a whole folder from “+ Add to vault”.</Muted>
          )}
        </ScrollView>
      ) : visible.length === 0 ? (
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
            <Ionicons name={currentAlbum !== null ? "folder-open-outline" : items.length === 0 ? "lock-closed-outline" : "search-outline"} size={38} color={theme.accent} />
          </View>
          <Text style={{ color: theme.text, fontSize: 17, fontWeight: "700" }}>
            {currentAlbum !== null ? "This folder is empty" : items.length === 0 ? "Your vault is empty" : "Nothing here"}
          </Text>
          <Text style={{ color: theme.muted, fontSize: 14, lineHeight: 21, textAlign: "center", paddingHorizontal: 30 }}>
            {currentAlbum !== null
              ? "Tap “Add to folder” to put photos, videos or files in here."
              : items.length === 0
                ? "Tap “Add to vault” to bring in photos, videos, documents, APKs — anything. It’s all encrypted."
                : "No items match this filter or search."}
          </Text>
        </View>
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(i) => i.id}
          key={grid ? `grid-${cols}` : "list"}
          numColumns={grid ? cols : 1}
          columnWrapperStyle={grid ? { gap: 6 } : undefined}
          contentContainerStyle={{ gap: 6, paddingBottom: selectMode ? 90 : 80 }}
          removeClippedSubviews
          renderItem={({ item }) => {
            const cat = categorize(item);
            const isSel = selected.has(item.id);
            if (grid) {
              return (
                <Pressable
                  onPress={() => (selectMode ? toggleSelect(item.id) : open(item))}
                  onLongPress={() => !selectMode && startSelect(item.id)}
                  testID={`tile-${cat}`}
                  style={{
                    width: TILE,
                    aspectRatio: 1,
                    backgroundColor: theme.surface,
                    borderRadius: theme.radiusSm,
                    borderWidth: 1,
                    borderColor: isSel ? theme.accent : theme.border,
                    overflow: "hidden",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {cat === "image" && vault.isCached(item.id) ? (
                    <Thumb item={item} getBytes={readBytes} fill />
                  ) : cat === "video" && vault.isCached(item.id) && posterSupported ? (
                    <VideoThumb item={item} getBytes={readBytes} getThumb={(id) => vault.readThumb(id)} fill />
                  ) : (
                    <Ionicons name={CATEGORY_ICON[cat]} size={28} color={CATEGORY_COLOR[cat]} />
                  )}
                  {item.remote && (
                    <Ionicons
                      name={item.cached === false ? "cloud-outline" : "cloud-done-outline"}
                      size={13}
                      color={item.cached === false ? "#fff" : theme.good}
                      style={{ position: "absolute", top: 4, right: 4 }}
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
                ) : cat === "video" && vault.isCached(item.id) && posterSupported ? (
                  <VideoThumb item={item} getBytes={readBytes} getThumb={(id) => vault.readThumb(id)} />
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
                    {item.name || "Untitled"}
                  </Text>
                  {item.type === "note" ? (
                    <Text numberOfLines={2} style={{ color: theme.muted, fontSize: 12, lineHeight: 17 }}>
                      {(noteBodies[item.id] ?? "").replace(/[#*`>[\]]|- \[[ x]\]/g, "").replace(/\s+/g, " ").trim() ||
                        "Empty note"}
                    </Text>
                  ) : (
                    <Text style={{ color: theme.muted, fontSize: 12 }}>
                      {cat.toUpperCase()} · {fmtSize(item.size)} · {new Date(item.createdAt).toLocaleDateString()}
                      {item.album ? ` · ${item.album}` : ""}
                    </Text>
                  )}
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

      {/* minimal floating add button — context comes from the active tab
          (adds that format; opens the menu on Home/All; new/into folder) */}
      {!selectMode && (
        <Pressable
          onPress={addForSection}
          testID="fab-add"
          accessibilityLabel={addLabel}
          style={{
            position: "absolute",
            right: 18,
            bottom: 22,
            width: 56,
            height: 56,
            borderRadius: 28,
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
          <Ionicons name={section === "folders" && currentAlbum === null ? "create-outline" : "add"} size={30} color={theme.accentText} />
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

      {/* pre-upload review: rename / remove before saving */}
      <Modal visible={!!review} animationType="slide" onRequestClose={discardReview}>
        {review && (
          <Screen>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Pressable onPress={discardReview} hitSlop={8}>
                <Text style={{ color: theme.muted, fontSize: 16 }}>Cancel</Text>
              </Pressable>
              <Text style={{ color: theme.text, fontSize: 16, fontWeight: "700" }}>
                Review {review.length} item{review.length === 1 ? "" : "s"}
              </Text>
              <Pressable onPress={commitReview} hitSlop={8} disabled={reviewBusy || review.length === 0}>
                <Text style={{ color: review.length && !reviewBusy ? theme.accent : theme.muted, fontSize: 16, fontWeight: "700" }}>
                  {reviewBusy ? "Saving…" : "Save"}
                </Text>
              </Pressable>
            </View>
            <Muted>
              Rename, trim or remove anything before it&apos;s saved &amp; synced.
              {trimSupported ? " Tap Trim on a video to cut it down." : ""}
            </Muted>
            <FlatList
              data={review}
              keyExtractor={(p) => p.key}
              contentContainerStyle={{ gap: 8, paddingBottom: 30 }}
              renderItem={({ item: p }) => (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: theme.surface, borderRadius: theme.radius, borderWidth: 1, borderColor: theme.border, padding: 10 }}>
                  {(p.cat === "image" && p.uri) || (p.cat === "video" && p.poster) ? (
                    <View style={{ width: 48, height: 48, borderRadius: 10, overflow: "hidden" }}>
                      <Image source={{ uri: p.cat === "video" ? p.poster : p.uri }} style={{ width: 48, height: 48 }} resizeMode="cover" />
                      {p.cat === "video" && (
                        <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" }}>
                          <Ionicons name="play-circle" size={22} color="rgba(255,255,255,0.92)" />
                        </View>
                      )}
                    </View>
                  ) : (
                    <View style={{ width: 48, height: 48, borderRadius: 10, backgroundColor: CATEGORY_COLOR[p.cat] + "22", alignItems: "center", justifyContent: "center" }}>
                      <Ionicons name={CATEGORY_ICON[p.cat]} size={24} color={CATEGORY_COLOR[p.cat]} />
                    </View>
                  )}
                  <View style={{ flex: 1 }}>
                    <TextInput
                      value={p.name}
                      onChangeText={(t) => setReviewName(p.key, t)}
                      style={{ color: theme.text, fontSize: 15, fontWeight: "600", paddingVertical: 2 }}
                    />
                    <Text style={{ color: theme.muted, fontSize: 11 }}>
                      {p.cat.toUpperCase()} · {fmtSize(p.bytes.length)}{p.album ? ` · ${p.album}` : ""}
                    </Text>
                  </View>
                  {p.cat === "video" && trimSupported && p.uri && (
                    <Pressable
                      onPress={() => setTrimming(p)}
                      hitSlop={8}
                      style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: theme.surfaceAlt, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 10 }}
                    >
                      <Ionicons name="cut-outline" size={16} color={theme.accent} />
                      <Text style={{ color: theme.accent, fontWeight: "700", fontSize: 13 }}>Trim</Text>
                    </Pressable>
                  )}
                  <Pressable onPress={() => removeReview(p.key)} hitSlop={8}>
                    <Ionicons name="close-circle" size={24} color={theme.muted} />
                  </Pressable>
                </View>
              )}
            />
          </Screen>
        )}
      </Modal>

      {/* pre-upload video trimmer */}
      {trimming && trimming.uri && (
        <TrimModal
          uri={trimming.uri}
          bytes={trimming.bytes}
          mime={trimming.mime}
          name={trimming.name}
          onCancel={() => setTrimming(null)}
          onApply={(out) => applyTrim(trimming.key, out)}
        />
      )}

      {/* image / video / audio preview — big media with a clean top bar */}
      <Modal visible={!!preview} onRequestClose={closePreview} animationType="fade">
        {preview &&
          (() => {
            const media = visible.filter(isPreviewable);
            const idx = media.findIndex((m) => m.id === preview.item.id);
            return (
              <View style={{ flex: 1, backgroundColor: "#000" }}>
                {/* top bar */}
                <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingTop: 40, paddingHorizontal: 14, paddingBottom: 10 }}>
                  <Pressable onPress={closePreview} hitSlop={8}>
                    <Ionicons name="close" size={28} color="#fff" />
                  </Pressable>
                  <View style={{ flex: 1 }}>
                    <Text numberOfLines={1} style={{ color: "#fff", fontWeight: "700", fontSize: 16 }}>{preview.item.name}</Text>
                    <Text style={{ color: "rgba(255,255,255,0.6)", fontSize: 12 }}>
                      {new Date(preview.item.createdAt).toLocaleString()}
                      {media.length > 1 ? `  ·  ${idx + 1} / ${media.length}` : ""}
                    </Text>
                  </View>
                  {media.length > 1 && (
                    <Pressable testID="playlist-toggle" onPress={() => setPlaylistOpen((o) => !o)} hitSlop={8}>
                      <Ionicons name={playlistOpen ? "list" : "list-outline"} size={24} color={playlistOpen ? theme.accent2 : "#fff"} />
                    </Pressable>
                  )}
                  <Pressable onPress={() => exportItem(preview.item)} hitSlop={8}>
                    <Ionicons name="share-outline" size={24} color="#fff" />
                  </Pressable>
                </View>

                {/* media */}
                <View style={{ flex: 1 }}>
                  {!preview.av && <Image source={{ uri: preview.uri }} style={{ flex: 1 }} resizeMode="contain" />}
                  {preview.av && <VideoPlayer uri={preview.uri} onRequestNext={() => gotoAdjacent(1)} onRequestPrev={() => gotoAdjacent(-1)} />}

                  {media.length > 1 && (
                    <>
                      <Pressable onPress={() => gotoAdjacent(-1)} hitSlop={6} style={{ position: "absolute", left: 0, top: 0, bottom: 60, width: 56, alignItems: "center", justifyContent: "center" }}>
                        <Ionicons name="chevron-back" size={34} color="rgba(255,255,255,0.55)" />
                      </Pressable>
                      <Pressable onPress={() => gotoAdjacent(1)} hitSlop={6} style={{ position: "absolute", right: 0, top: 0, bottom: 60, width: 56, alignItems: "center", justifyContent: "center" }}>
                        <Ionicons name="chevron-forward" size={34} color="rgba(255,255,255,0.55)" />
                      </Pressable>
                    </>
                  )}
                </View>

                {/* collapsible "up next" playlist — jump straight to any item */}
                {playlistOpen && media.length > 1 && (
                  <View style={{ position: "absolute", top: 0, right: 0, bottom: 0, width: 288, maxWidth: "85%", backgroundColor: "rgba(0,0,0,0.94)", borderLeftWidth: 1, borderLeftColor: "rgba(255,255,255,0.12)", paddingTop: 40 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingBottom: 8 }}>
                      <Text style={{ color: "#fff", fontWeight: "700", fontSize: 15 }}>Up next · {media.length}</Text>
                      <Pressable onPress={() => setPlaylistOpen(false)} hitSlop={8}>
                        <Ionicons name="chevron-forward" size={22} color="#fff" />
                      </Pressable>
                    </View>
                    <FlatList
                      data={media}
                      keyExtractor={(m) => m.id}
                      contentContainerStyle={{ paddingBottom: 30 }}
                      renderItem={({ item: m }) => {
                        const active = m.id === preview.item.id;
                        const mcat = categorize(m);
                        return (
                          <Pressable
                            onPress={() => goToItem(m)}
                            style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, paddingHorizontal: 14, backgroundColor: active ? "rgba(255,255,255,0.13)" : "transparent" }}
                          >
                            <View style={{ width: 58, height: 40, borderRadius: 8, overflow: "hidden", backgroundColor: "rgba(255,255,255,0.08)", alignItems: "center", justifyContent: "center" }}>
                              {mcat === "image" && vault.isCached(m.id) ? (
                                <Thumb item={m} getBytes={readBytes} fill />
                              ) : mcat === "video" && vault.isCached(m.id) && posterSupported ? (
                                <VideoThumb item={m} getBytes={readBytes} getThumb={(id) => vault.readThumb(id)} fill />
                              ) : (
                                <Ionicons name={CATEGORY_ICON[mcat]} size={18} color={CATEGORY_COLOR[mcat]} />
                              )}
                            </View>
                            <Text numberOfLines={2} style={{ flex: 1, color: active ? "#fff" : "rgba(255,255,255,0.78)", fontSize: 12, fontWeight: active ? "700" : "500" }}>
                              {m.name}
                            </Text>
                            {active && <Ionicons name="play" size={14} color={theme.accent2} />}
                          </Pressable>
                        );
                      }}
                    />
                  </View>
                )}
              </View>
            );
          })()}
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
            <SheetRow icon="albums-outline" label="Move to album" onPress={() => setAlbumTarget({ ids: [details.id] })} />

            {/* storage: where this file lives — on this device, in Supabase, or both */}
            {cloud && (
              <>
                <Text style={{ color: theme.muted, fontSize: 11, fontWeight: "700", marginTop: 12, marginBottom: 2, letterSpacing: 0.4 }}>
                  STORAGE · {details.cached !== false ? "on this device" : "not on device"}
                  {details.remote ? " · backed up" : ""}
                </Text>
                {!details.remote ? (
                  <SheetRow icon="cloud-upload-outline" label="Back up to Supabase" sub="Encrypted copy in the cloud" onPress={() => backupItem(details)} />
                ) : (
                  <SheetRow icon="cloud-offline-outline" label="Remove from Supabase" sub="Deletes the cloud copy; keeps it on this device" onPress={() => removeBackup(details)} />
                )}
                {details.remote && details.cached === false && (
                  <SheetRow icon="cloud-download-outline" label="Save to this device" sub="Download a local copy" onPress={() => cacheItem(details)} />
                )}
                {details.remote && details.cached !== false && (
                  <SheetRow icon="phone-portrait-outline" label="Remove local copy" sub="Frees space; stays backed up" onPress={() => uncacheItem(details)} />
                )}
              </>
            )}

            <View style={{ height: 8 }} />
            {details.remote ? (
              <SheetRow icon="trash-outline" label="Delete everywhere" sub="This device + Supabase" danger onPress={() => deleteEverywhere(details)} />
            ) : (
              <SheetRow icon="trash-outline" label="Delete" danger onPress={() => deleteIds([details.id])} />
            )}
          </>
        )}
      </Sheet>

      {/* album picker */}
      <AlbumPicker
        target={albumTarget}
        albums={albums.map((a) => a.name)}
        onCancel={() => setAlbumTarget(null)}
        onPick={(name) => albumTarget && applyAlbum(albumTarget.ids, name)}
      />

      {/* create folder */}
      <CreateFolderModal visible={newFolderOpen} onCancel={() => setNewFolderOpen(false)} onCreate={makeFolder} />

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

// Session cache of generated video posters (item id -> object URL) so the grid
// doesn't re-decode a clip on every render. Released when the page unloads.
const videoPosters = new Map<string, string>();

// A video tile that shows a real poster frame with a play badge. Prefers the
// small poster stored with the item (cheap); only if there isn't one does it
// fall back to decrypting the clip and grabbing a frame. Falls back to the
// camera icon while it works or where posters aren't supported.
function VideoThumb({
  item,
  getBytes,
  getThumb,
  fill,
}: {
  item: VaultItem;
  getBytes: (i: VaultItem) => Promise<Uint8Array>;
  getThumb?: (id: string) => Promise<Uint8Array | null>;
  fill?: boolean;
}) {
  const [uri, setUri] = useState<string | null>(videoPosters.get(item.id) ?? null);
  useEffect(() => {
    if (videoPosters.has(item.id)) {
      setUri(videoPosters.get(item.id)!);
      return;
    }
    let active = true;
    (async () => {
      let vUri: string | null = null;
      try {
        // 1) the stored poster sidecar — no full-video decrypt needed.
        if (item.hasThumb && getThumb) {
          const tb = await getThumb(item.id);
          if (tb) {
            const purl = await makeViewableUri(item.id + "_pos", tb, "jpg");
            videoPosters.set(item.id, purl);
            if (active) setUri(purl);
            return;
          }
        }
        // 2) fall back: decrypt the clip and grab a frame (older items / web).
        const data = await getBytes(item);
        vUri = await makeViewableUri(item.id + "_pv", data, viewExt(item));
        const pb = await makeVideoPoster(vUri);
        if (pb) {
          const purl = await makeViewableUri(item.id + "_pos", pb, "jpg");
          videoPosters.set(item.id, purl);
          if (active) setUri(purl);
        }
      } catch {
        /* icon fallback */
      } finally {
        if (vUri) releaseViewableUri(vUri); // the full video blob isn't needed past the frame grab
      }
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  const box = fill ? { width: "100%" as const, height: "100%" as const } : { width: 46, height: 46, borderRadius: 12 };
  if (!uri) {
    return (
      <View style={{ ...box, backgroundColor: CATEGORY_COLOR.video + "22", alignItems: "center", justifyContent: "center" }}>
        <Ionicons name="videocam" size={fill ? 34 : 24} color={CATEGORY_COLOR.video} />
      </View>
    );
  }
  return (
    <View style={{ ...box, overflow: "hidden", alignItems: "center", justifyContent: "center" }}>
      <Image source={{ uri }} style={{ position: "absolute", width: "100%", height: "100%" }} resizeMode="cover" />
      <Ionicons name="play-circle" size={fill ? 32 : 20} color="rgba(255,255,255,0.92)" />
    </View>
  );
}

function CategoryTile({ label, icon, color, count, onPress }: { label: string; icon: keyof typeof Ionicons.glyphMap; color: string; count: number; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        width: 104,
        aspectRatio: 1,
        borderRadius: theme.radiusSm,
        backgroundColor: theme.surface,
        borderWidth: 1,
        borderColor: theme.border,
        padding: 9,
        justifyContent: "space-between",
      }}
    >
      <Ionicons name={icon} size={22} color={color} />
      <View>
        <Text numberOfLines={1} style={{ color: theme.text, fontWeight: "700", fontSize: 12 }}>{label}</Text>
        <Text style={{ color: theme.muted, fontSize: 10 }}>{count}</Text>
      </View>
    </Pressable>
  );
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

function CreateFolderModal({ visible, onCancel, onCreate }: { visible: boolean; onCancel: () => void; onCreate: (name: string) => void }) {
  const [name, setName] = useState("");
  useEffect(() => {
    if (!visible) setName("");
  }, [visible]);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", padding: 20 }}>
        <View style={{ backgroundColor: theme.bg, borderRadius: theme.radius, borderWidth: 1, borderColor: theme.border, padding: 20, gap: 12 }}>
          <Text style={{ color: theme.text, fontSize: 18, fontWeight: "700" }}>New folder</Text>
          <Field value={name} onChangeText={setName} placeholder="Folder name" autoFocus />
          <View style={{ flexDirection: "row", gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Button label="Cancel" variant="outline" onPress={onCancel} />
            </View>
            <View style={{ flex: 1 }}>
              <Button label="Create" onPress={() => onCreate(name)} />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}
