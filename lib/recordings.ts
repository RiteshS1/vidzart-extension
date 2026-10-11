// Finished recordings, kept in the extension's IndexedDB until the user
// saves them.
//
// Why IndexedDB: the recording is made in the offscreen document but shown
// on the "Recording ready" page. Extension messages are JSON only and can't
// carry a (possibly huge) video Blob, but both pages share the extension's
// origin, and IndexedDB stores Blobs natively (on disk, not in memory).
// No `storage` permission needed; that one is for chrome.storage.

import type { VidzEvents } from './vidz/types';

export interface StoredRecording {
  id: string;
  createdAt: number; // epoch ms
  title: string; // the recorded tab's title
  video: Blob;
  mimeType: string;
  durationMs: number;
  width: number;
  height: number;
  fps: number;
  events: VidzEvents | null;
  /** Things the user should know, e.g. "events stopped after a navigation". */
  warnings: string[];
}

/** Older recordings beyond this many are deleted, so the disk doesn't fill up. */
const KEEP = 5;

const DB_NAME = 'vidzart';
const STORE = 'recordings';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Runs one transaction and resolves with `fn`'s request result once it commits. */
async function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await open();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = fn(tx.objectStore(STORE));
      // Resolve on complete, not on the request's success: only then is a
      // write actually durable.
      tx.oncomplete = () => resolve(request ? request.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted.'));
    });
  } finally {
    db.close();
  }
}

export async function putRecording(recording: StoredRecording): Promise<void> {
  await run('readwrite', (store) => store.put(recording));
  // Prune: keep the newest KEEP recordings.
  const all = await listRecordings();
  const old = all.slice(KEEP);
  if (old.length) await run('readwrite', (store) => old.forEach((r) => store.delete(r.id)));
}

export async function getRecording(id: string): Promise<StoredRecording | undefined> {
  return run<StoredRecording>('readonly', (store) => store.get(id));
}

export async function deleteRecording(id: string): Promise<void> {
  await run('readwrite', (store) => store.delete(id));
}

/** Newest first. (Loads metadata AND blob handles; blobs aren't read into memory.) */
export async function listRecordings(): Promise<StoredRecording[]> {
  const all = (await run<StoredRecording[]>('readonly', (store) => store.getAll())) ?? [];
  return all.sort((a, b) => b.createdAt - a.createdAt);
}
