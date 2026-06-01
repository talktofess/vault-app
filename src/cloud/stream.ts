// Streaming reader for the chunked encrypted object format. Fetches one GCM
// chunk at a time via HTTP Range (CloudStore.downloadRange), decrypts it under
// the per-file key, and yields plaintext — so a player can start on chunk 0
// while later chunks are still downloading, and can seek by chunk. This is the
// transport half of "watch while downloading"; the media-element glue lives in
// the platform players (streamMedia.*).
import { openChunk } from "../crypto/chunkCipher";
import type { CloudStore } from "./ports";

const HEADER = 8; // "VLT1" header, see chunkCipher.ts
const TAG = 16; // GCM tag per chunk

export interface StreamSource {
  store: CloudStore;
  path: string;
  fk: Uint8Array; // per-file key (already unwrapped)
  chunkSize: number; // plaintext bytes per chunk (CHUNK)
  byteSize: number; // total ciphertext object size
}

// What VaultService.openRemoteStream returns and the platform players consume.
export interface RemoteStream {
  chunkSize: number;
  chunkCount: number;
  plainSize: number;
  mime?: string;
  reader: StreamReader;
}

export class StreamReader {
  readonly chunkCount: number;
  private readonly stride: number;

  constructor(private src: StreamSource) {
    this.stride = src.chunkSize + TAG;
    const body = src.byteSize - HEADER;
    this.chunkCount = body <= 0 ? 0 : Math.ceil(body / this.stride);
  }

  /** Byte range of stored chunk `index` (last chunk may be shorter). */
  rangeFor(index: number): { start: number; length: number } {
    const start = HEADER + index * this.stride;
    return { start, length: Math.min(this.stride, this.src.byteSize - start) };
  }

  /** Fetch + decrypt a single chunk (random access / seek). */
  async chunk(index: number): Promise<Uint8Array> {
    if (index < 0 || index >= this.chunkCount) throw new Error("chunk index out of range");
    const { start, length } = this.rangeFor(index);
    const ctTag = await this.src.store.downloadRange(this.src.path, start, length);
    return openChunk(this.src.fk, index, ctTag);
  }

  /** Decrypted chunks in order from `from`, for progressive playback. */
  async *chunks(from = 0): AsyncGenerator<Uint8Array> {
    for (let i = from; i < this.chunkCount; i++) yield await this.chunk(i);
  }

  /** Reassemble the whole plaintext (constant per-chunk memory while reading). */
  async readAll(): Promise<Uint8Array> {
    const parts: Uint8Array[] = [];
    let len = 0;
    for await (const c of this.chunks()) {
      parts.push(c);
      len += c.length;
    }
    const out = new Uint8Array(len);
    let off = 0;
    for (const p of parts) {
      out.set(p, off);
      off += p.length;
    }
    return out;
  }
}
