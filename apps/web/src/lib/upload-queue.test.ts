import { describe, expect, it } from 'vitest';
import { ApiError } from './api-client.js';
import { createUploadQueue, type QueuedCapture, type QueueStore } from './upload-queue.js';

function memoryStore(): QueueStore & { items: Map<string, QueuedCapture> } {
  const items = new Map<string, QueuedCapture>();
  return {
    items,
    all: async () => [...items.values()],
    put: async (item) => void items.set(item.id, item),
    remove: async (id) => void items.delete(id),
  };
}

const capture = (id: string, createdAt: number): QueuedCapture => ({
  id,
  fields: { source: 'paper_ocr', captureId: id },
  file: new Blob(['x'], { type: 'image/jpeg' }),
  fileName: `${id}.jpg`,
  createdAt,
});

describe('upload queue', () => {
  it('keeps captures while offline and sends them oldest first once back', async () => {
    const store = memoryStore();
    let online = false;
    const sent: string[] = [];
    const queue = createUploadQueue(store, async (item) => {
      if (!online) throw new TypeError('Failed to fetch');
      sent.push(item.id);
    });
    await queue.enqueue(capture('b', 2));
    await queue.enqueue(capture('a', 1));

    expect(await queue.drain()).toEqual({ sent: 0, refused: [] });
    expect(await queue.count()).toBe(2);

    online = true;
    expect((await queue.drain()).sent).toBe(2);
    expect(sent).toEqual(['a', 'b']);
    expect(await queue.count()).toBe(0);
  });

  it('drops a capture the server refused (4xx) and reports it, but keeps one after a 5xx', async () => {
    const store = memoryStore();
    const queue = createUploadQueue(store, async (item) => {
      throw new ApiError(item.id === 'bad' ? 422 : 503, { error: 'x' });
    });
    await queue.enqueue(capture('bad', 1));
    await queue.enqueue(capture('later', 2));

    const { refused } = await queue.drain();
    expect(refused.map((r) => r.id)).toEqual(['bad']);
    expect([...store.items.keys()]).toEqual(['later']);
  });
});
