import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { createRestSyncAdapter } from '../src/sync/restAdapter';

const baseHeaders = {
  'Content-Type': 'application/json',
};

describe('createRestSyncAdapter', () => {
  it('pulls snapshots for new docs and stores last synced token', async () => {
    const lastSynced = new Map<string, string | null>();

    const snapshotDoc = new Y.Doc();
    const text = snapshotDoc.getText('content');
    text.insert(0, 'hello world');
    const snapshotUpdate = Y.encodeStateAsUpdate(snapshotDoc);
    const snapshotBase64 = Buffer.from(snapshotUpdate).toString('base64');

    const fetchMock = vi.fn(
      async (input: URL | RequestInfo, init?: RequestInit) => {
      const parsed = JSON.parse((init?.body as string) ?? '{}');
      expect(parsed.documents[0]).toMatchObject({
        id: 'doc-1',
        lastSynced: null,
        requestSnapshot: true,
      });

      return new Response(
        JSON.stringify({
          documents: [
            {
              id: 'doc-1',
              snapshot: snapshotBase64,
              updates: [],
              dateLastSynced: '2024-02-01T00:00:00Z',
            },
          ],
        }),
        { status: 200, headers: baseHeaders }
      );
    });

    const adapter = createRestSyncAdapter({
      baseUrl: 'https://api.example.com/sync',
      fetch: fetchMock,
      getLastSynced: async (docId) => lastSynced.get(docId) ?? null,
      setLastSynced: async (docId, value) => {
        lastSynced.set(docId, value);
      },
    });

    const merged = await adapter.pull('doc-1', undefined, {
      requestSnapshot: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(lastSynced.get('doc-1')).toBe('2024-02-01T00:00:00Z');
    expect(merged).toBeInstanceOf(Uint8Array);

    const doc = new Y.Doc();
    Y.applyUpdate(doc, merged!);
    expect(doc.getText('content').toString()).toBe('hello world');
  });

  it('merges incremental updates and updates last synced timestamp', async () => {
    const lastSynced = new Map<string, string | null>([
      ['doc-2', '2024-02-01T00:00:00Z'],
    ]);

    const remoteDoc = new Y.Doc();
    const updates: Uint8Array[] = [];
    remoteDoc.on('update', (update) => {
      updates.push(update);
    });

    const text = remoteDoc.getText('content');
    text.insert(0, 'hello');
    text.insert(5, ' world');

    const fetchMock = vi.fn(
      async (input: URL | RequestInfo, init?: RequestInit) => {
      const parsed = JSON.parse((init?.body as string) ?? '{}');
      expect(parsed.documents[0]).toMatchObject({
        id: 'doc-2',
        lastSynced: '2024-02-01T00:00:00Z',
        requestSnapshot: false,
      });

      return new Response(
        JSON.stringify({
          documents: [
            {
              id: 'doc-2',
              updates: updates.map((u) =>
                Buffer.from(u).toString('base64')
              ),
              dateLastSynced: '2024-02-02T00:00:00Z',
            },
          ],
        }),
        { status: 200, headers: baseHeaders }
      );
    });

    const adapter = createRestSyncAdapter({
      baseUrl: 'https://api.example.com/sync',
      fetch: fetchMock,
      getLastSynced: async (docId) => lastSynced.get(docId) ?? null,
      setLastSynced: async (docId, value) => {
        lastSynced.set(docId, value);
      },
    });

    const merged = await adapter.pull('doc-2', undefined, undefined);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(lastSynced.get('doc-2')).toBe('2024-02-02T00:00:00Z');

    const doc = new Y.Doc();
    Y.applyUpdate(doc, merged!);
    expect(doc.getText('content').toString()).toBe('hello world');
  });

  it('pushes updates with base64 payloads and persists new timestamps', async () => {
    const lastSynced = new Map<string, string | null>([
      ['doc-3', '2024-02-02T00:00:00Z'],
    ]);

    const update = new Uint8Array([1, 2, 3, 4]);

    const fetchMock = vi.fn(
      async (input: URL | RequestInfo, init?: RequestInit) => {
      const payload = JSON.parse((init?.body as string) ?? '{}');
      expect(input).toBe('https://api.example.com/sync/push');
      expect(payload.documents[0]).toMatchObject({
        id: 'doc-3',
        lastSynced: '2024-02-02T00:00:00Z',
        isSnapshot: false,
      });
      expect(payload.documents[0].update).toBe(
        Buffer.from(update).toString('base64')
      );

      return new Response(
        JSON.stringify({
          documents: [
            {
              id: 'doc-3',
              dateLastSynced: '2024-02-03T00:00:00Z',
            },
          ],
        }),
        { status: 200, headers: baseHeaders }
      );
    });

    const adapter = createRestSyncAdapter({
      baseUrl: 'https://api.example.com/sync',
      fetch: fetchMock,
      getLastSynced: async (docId) => lastSynced.get(docId) ?? null,
      setLastSynced: async (docId, value) => {
        lastSynced.set(docId, value);
      },
    });

    await adapter.push('doc-3', update, {});
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(lastSynced.get('doc-3')).toBe('2024-02-03T00:00:00Z');
  });
});
