import { useEffect, useState } from 'react';
import { ApiError, apiPostForm } from './api-client.js';

// Field logs taken where the signal dropped: kept on the phone and sent when it is back.
export interface QueuedCapture {
  id: string;
  fields: Record<string, string>;
  file: Blob;
  fileName: string;
  createdAt: number;
}

export interface QueueStore {
  all(): Promise<QueuedCapture[]>;
  put(item: QueuedCapture): Promise<void>;
  remove(id: string): Promise<void>;
}

// Worth keeping only when the server never decided: no response, or a 5xx. A 4xx is an answer.
export function isRetryable(error: unknown): boolean {
  return !(error instanceof ApiError) || error.status >= 500;
}

export function createUploadQueue(store: QueueStore, send: (item: QueuedCapture) => Promise<void>) {
  let draining: Promise<{ sent: number; refused: QueuedCapture[] }> | null = null;
  return {
    enqueue: (item: QueuedCapture) => store.put(item),
    count: async () => (await store.all()).length,
    // One drain at a time; stops at the first network failure, since the rest would fail the same way.
    drain() {
      draining ??= (async () => {
        let sent = 0;
        const refused: QueuedCapture[] = [];
        try {
          for (const item of (await store.all()).sort((a, b) => a.createdAt - b.createdAt)) {
            try {
              await send(item);
              sent++;
              await store.remove(item.id);
            } catch (error) {
              if (isRetryable(error)) break;
              refused.push(item);
              await store.remove(item.id);
            }
          }
        } finally {
          draining = null;
        }
        return { sent, refused };
      })();
      return draining;
    },
  };
}

const DB = 'arkilaunch-field';
const STORE = 'pending-captures';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const request = work(db.transaction(STORE, mode).objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      }),
  );
}

export const indexedDbStore: QueueStore = {
  all: () => run('readonly', (store) => store.getAll() as IDBRequest<QueuedCapture[]>),
  put: (item) => run('readwrite', (store) => store.put(item)).then(() => undefined),
  remove: (id) => run('readwrite', (store) => store.delete(id)).then(() => undefined),
};

export const uploadQueue = createUploadQueue(indexedDbStore, async (item) => {
  // captureId travels in fields, so a send whose response was lost cannot create a second log.
  await apiPostForm('/edtr', item.fields, new File([item.file], item.fileName, { type: item.file.type }));
});

const QUEUE_CHANGED = 'upload-queue-changed';
export function announceQueueChange() {
  window.dispatchEvent(new Event(QUEUE_CHANGED));
}

// Pending count for the field dashboard; drains on mount and whenever the phone comes back online.
export function usePendingUploads(onRefused?: (items: QueuedCapture[]) => void): number {
  const [pending, setPending] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const refresh = () =>
      void uploadQueue
        .count()
        .then((n) => !cancelled && setPending(n))
        .catch(() => {});
    const drain = () =>
      void uploadQueue
        .drain()
        .then(({ refused }) => {
          if (refused.length > 0) onRefused?.(refused);
          refresh();
        })
        .catch(refresh);
    drain();
    window.addEventListener('online', drain);
    window.addEventListener(QUEUE_CHANGED, refresh);
    return () => {
      cancelled = true;
      window.removeEventListener('online', drain);
      window.removeEventListener(QUEUE_CHANGED, refresh);
    };
  }, [onRefused]);
  return pending;
}
