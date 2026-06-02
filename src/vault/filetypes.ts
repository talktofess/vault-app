// Classifies any vault item into a coarse category from its MIME type and/or
// filename extension. Drives the Library's icons, filter chips, and the
// decision of how to open an item (inline viewer vs. export-only).
import type { Ionicons } from "@expo/vector-icons";
import type { VaultItem } from "./types";

export type FileCategory =
  | "image"
  | "video"
  | "audio"
  | "document"
  | "apk"
  | "archive"
  | "note"
  | "other";

type IoniconName = keyof typeof Ionicons.glyphMap;

const EXT_CATEGORY: Record<string, FileCategory> = {
  // images
  jpg: "image", jpeg: "image", png: "image", gif: "image", webp: "image",
  bmp: "image", heic: "image", heif: "image", svg: "image", tiff: "image",
  // video
  mp4: "video", mov: "video", mkv: "video", webm: "video", avi: "video",
  m4v: "video", "3gp": "video",
  // audio
  mp3: "audio", wav: "audio", m4a: "audio", aac: "audio", ogg: "audio",
  flac: "audio", opus: "audio",
  // documents / text
  pdf: "document", txt: "document", md: "document", csv: "document",
  log: "document", json: "document", rtf: "document", doc: "document",
  docx: "document", xls: "document", xlsx: "document", ppt: "document",
  pptx: "document", html: "document", xml: "document",
  // android packages
  apk: "apk", apks: "apk", xapk: "apk", aab: "apk",
  // archives
  zip: "archive", rar: "archive", "7z": "archive", tar: "archive",
  gz: "archive", bz2: "archive",
};

/** Lowercased extension (no dot) from a filename, or "" if none. */
export function extOf(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name.trim());
  return m ? m[1].toLowerCase() : "";
}

/** Best-effort category for an item, MIME first then extension. */
export function categorize(item: VaultItem): FileCategory {
  if (item.type === "note") return "note";
  const mime = (item.mime ?? "").toLowerCase();
  if (mime === "application/vnd.android.package-archive") return "apk";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime === "application/pdf" || mime.startsWith("text/")) return "document";
  if (mime.includes("zip") || mime.includes("compressed") || mime.includes("tar")) return "archive";
  const ext = extOf(item.name);
  return EXT_CATEGORY[ext] ?? "other";
}

/** True when the bytes are human-readable text we can show in a viewer. */
export function isTextLike(item: FileCategory, name: string, mime?: string): boolean {
  if (item === "note") return true;
  const ext = extOf(name);
  if (["txt", "md", "csv", "log", "json", "xml", "html"].includes(ext)) return true;
  return (mime ?? "").startsWith("text/");
}

/** A file extension to give the decrypt-to-temp file so the OS viewer is happy. */
export function viewExt(item: VaultItem): string {
  const ext = extOf(item.name);
  if (ext) return ext;
  const cat = categorize(item);
  if (cat === "image") return "jpg";
  if (cat === "video") return "mp4";
  if (cat === "audio") return "mp3";
  return "bin";
}

export const CATEGORY_ICON: Record<FileCategory, IoniconName> = {
  image: "image",
  video: "videocam",
  audio: "musical-notes",
  document: "document-text",
  apk: "logo-android",
  archive: "archive",
  note: "create",
  other: "document-outline",
};

export const CATEGORY_COLOR: Record<FileCategory, string> = {
  image: "#d9a86b", // tan
  video: "#c792ea", // violet
  audio: "#7bbf8a", // sage
  document: "#e0b066", // amber
  apk: "#a8c45c", // olive
  archive: "#e09b6b", // clay
  note: "#cdb38a", // sand
  other: "#a9a092", // stone
};

// Filter chips shown across the top of the Library, in display order.
export const FILTERS: { key: FileCategory | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "image", label: "Images" },
  { key: "video", label: "Videos" },
  { key: "audio", label: "Audio" },
  { key: "document", label: "Docs" },
  { key: "apk", label: "APKs" },
  { key: "archive", label: "Archives" },
  { key: "note", label: "Notes" },
  { key: "other", label: "Other" },
];

/** Human-readable byte size. */
export function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
