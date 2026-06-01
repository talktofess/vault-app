// Web Storage adapter — same `Storage` port as the native expoStorage, but
// backed by IndexedDB in the browser. The encrypted blobs and the (encrypted)
// manifest live in IndexedDB on THIS computer's browser profile; nothing is
// uploaded. Named `ExpoStorage` so VaultContext's `new ExpoStorage()` resolves
// to this file on web via Metro's platform extensions.
import type { Storage } from "../vault/ports";

const DB_NAME = "offline_chess_vault";
const STORE = "kv";
const MANIFEST_KEY = "__manifest__";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
  });
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        const req = fn(transaction.objectStore(STORE));
        let result: T;
        req.onsuccess = () => {
          result = req.result;
        };
        req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
        // Resolve on COMMIT, not just request success — otherwise a write can be
        // reported done before it's durably saved, and a quick page refresh loses
        // it (the "item vanishes after reload" bug).
        transaction.oncomplete = () => resolve(result);
        transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
        transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
      })
  );
}

function toBytes(v: unknown): Uint8Array | null {
  if (v == null) return null;
  if (v instanceof Uint8Array) return v;
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  return null;
}

export class ExpoStorage implements Storage {
  async readManifest(): Promise<string | null> {
    const v = await tx<unknown>("readonly", (s) => s.get(MANIFEST_KEY));
    return typeof v === "string" ? v : null;
  }

  async writeManifest(json: string): Promise<void> {
    await tx("readwrite", (s) => s.put(json, MANIFEST_KEY));
  }

  async readBlob(id: string): Promise<Uint8Array | null> {
    const v = await tx<unknown>("readonly", (s) => s.get(id));
    return toBytes(v);
  }

  async writeBlob(id: string, data: Uint8Array): Promise<void> {
    // store a standalone copy of the bytes so the buffer isn't shared/detached
    await tx("readwrite", (s) => s.put(data.slice(), id));
  }

  async deleteBlob(id: string): Promise<void> {
    await tx("readwrite", (s) => s.delete(id));
  }

  async clearAll(): Promise<void> {
    await tx("readwrite", (s) => s.clear());
  }
}
