// Turns a plaintext item into the encrypted (row + object) pair the cloud
// stores, and back. The object is the streamable chunked file; encMeta and
// wrappedFk are sealed under the DEK. No I/O here — pure transform.
import { sha256 } from "@noble/hashes/sha256";
import { open, seal } from "../crypto/cipher";
import { bytesToUtf8, toB64, utf8ToBytes } from "../crypto/b64";
import { generateKey, packSealed, unpackSealed, unwrapKey, wrapKey } from "../crypto/keys";
import { CHUNK, chunkCount, decryptFile, encryptFile } from "../crypto/chunkCipher";
import type { ItemMeta, RemoteItem } from "./types";

export type RemoteItemDraft = Omit<RemoteItem, "createdAt" | "updatedAt" | "deletedAt">;

export function storagePath(userId: string, itemId: string): string {
  return `${userId}/${itemId}.enc`;
}

/** Encrypt an item: fresh FK -> chunked object; seal meta + wrap FK under DEK. */
export function encodeItem(
  dek: Uint8Array,
  userId: string,
  itemId: string,
  base: { name: string; mime?: string; album?: string; kind?: string },
  plain: Uint8Array
): { object: Uint8Array; row: RemoteItemDraft } {
  const fk = generateKey();
  const object = encryptFile(fk, plain);
  const meta: ItemMeta = {
    name: base.name,
    mime: base.mime,
    album: base.album,
    kind: base.kind,
    plainSize: plain.length,
    chunkSize: CHUNK,
    chunkCount: chunkCount(plain.length),
  };
  return {
    object,
    row: {
      id: itemId,
      encMeta: packSealed(seal(dek, utf8ToBytes(JSON.stringify(meta)))),
      wrappedFk: packSealed(wrapKey(dek, fk)),
      byteSize: object.length,
      storagePath: storagePath(userId, itemId),
      contentHash: toB64(sha256(object)),
    },
  };
}

export function decodeMeta(dek: Uint8Array, encMeta: string): ItemMeta {
  return JSON.parse(bytesToUtf8(open(dek, unpackSealed(encMeta)))) as ItemMeta;
}

export function decodeFk(dek: Uint8Array, wrappedFk: string): Uint8Array {
  return unwrapKey(dek, unpackSealed(wrappedFk));
}

/** Decrypt a whole downloaded object given its (unwrapped) file key. */
export function decodeObject(fk: Uint8Array, object: Uint8Array): Uint8Array {
  return decryptFile(fk, object);
}
