// Streamable file encryption: a file is encrypted as a sequence of independent
// AES-256-GCM chunks under a per-file key (FK), so a player can decrypt chunk 0
// and start playing while later chunks are still downloading. Each chunk binds
// its index as GCM AAD, so chunks can't be reordered or spliced.
//
// Object layout (see docs/cloud-architecture.md):
//   [ "VLT1"(4) | version(1) | flags(1) | reserved(2) ]  8-byte cleartext header
//   [ ct(CHUNK) | tag(16) ] chunk 0
//   [ ct(CHUNK) | tag(16) ] chunk 1 ...
//   [ ct(≤CHUNK)| tag(16) ] final chunk (may be short)
import { gcm } from "@noble/ciphers/aes";

export const CHUNK = 1 << 20; // 1 MiB plaintext per chunk
export const TAG = 16; // GCM tag bytes
export const HEADER = 8; // cleartext file header bytes

const MAGIC = [0x56, 0x4c, 0x54, 0x31]; // "VLT1"
const VERSION = 1;

// nonce = 8 zero bytes ‖ uint32be(index). Unique per (FK, index): FK is unique
// per file, index unique within a file -> no key/nonce reuse.
function nonceFor(index: number): Uint8Array {
  const n = new Uint8Array(12);
  n[8] = (index >>> 24) & 0xff;
  n[9] = (index >>> 16) & 0xff;
  n[10] = (index >>> 8) & 0xff;
  n[11] = index & 0xff;
  return n;
}

// AAD = uint32be(index): authenticates each chunk's position in the file.
function aadFor(index: number): Uint8Array {
  return nonceFor(index).subarray(8);
}

/** Encrypt one chunk -> ciphertext‖tag. */
export function sealChunk(fk: Uint8Array, index: number, plain: Uint8Array): Uint8Array {
  return gcm(fk, nonceFor(index), aadFor(index)).encrypt(plain);
}

/** Decrypt one chunk. Throws if FK/index wrong or the chunk was tampered. */
export function openChunk(fk: Uint8Array, index: number, ctTag: Uint8Array): Uint8Array {
  return gcm(fk, nonceFor(index), aadFor(index)).decrypt(ctTag);
}

function concat(parts: Uint8Array[]): Uint8Array {
  let len = 0;
  for (const p of parts) len += p.length;
  const out = new Uint8Array(len);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

function header(): Uint8Array {
  const h = new Uint8Array(HEADER);
  h.set(MAGIC, 0);
  h[4] = VERSION;
  return h; // flags + reserved left 0
}

/** Number of chunks a plaintext of `plainSize` bytes splits into. */
export function chunkCount(plainSize: number): number {
  return Math.ceil(plainSize / CHUNK);
}

/** Byte range of stored chunk `index` within the object (for HTTP Range GETs). */
export function chunkRange(index: number): { start: number; length: number } {
  return { start: HEADER + index * (CHUNK + TAG), length: CHUNK + TAG };
}

/** Encrypt a whole plaintext into the on-object layout. */
export function encryptFile(fk: Uint8Array, plain: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [header()];
  let index = 0;
  for (let off = 0; off < plain.length; off += CHUNK, index++) {
    const slice = plain.subarray(off, Math.min(off + CHUNK, plain.length));
    parts.push(sealChunk(fk, index, slice));
  }
  return concat(parts);
}

/** Decrypt a whole object produced by encryptFile back to plaintext. */
export function decryptFile(fk: Uint8Array, obj: Uint8Array): Uint8Array {
  if (obj.length < HEADER) throw new Error("Truncated object");
  for (let i = 0; i < MAGIC.length; i++) {
    if (obj[i] !== MAGIC[i]) throw new Error("Bad magic");
  }
  if (obj[4] !== VERSION) throw new Error(`Unsupported version ${obj[4]}`);

  const out: Uint8Array[] = [];
  let index = 0;
  for (let off = HEADER; off < obj.length; index++) {
    // All chunks but the last are exactly CHUNK+TAG; the last is whatever remains.
    const take = Math.min(CHUNK + TAG, obj.length - off);
    out.push(openChunk(fk, index, obj.subarray(off, off + take)));
    off += take;
  }
  return concat(out);
}
