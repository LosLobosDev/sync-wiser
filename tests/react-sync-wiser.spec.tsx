import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import * as React from 'react';
import { Wiser } from '../src/wiser';
import { WiserProvider } from '../src/react/WiserProvider';
import { useSyncWiser } from '../src/react/useSyncWiser';
import { createInMemoryStorageAdapter } from '../src/storage/inMemoryStorageAdapter';

const Counter = Wiser.define('Counter', (y) => ({
  stats: y.map<number>(),
}));

function SyncProbe() {
  const { data, sync, isSyncing } = useSyncWiser('react-sync-doc', Counter);
  const hasSynced = React.useRef(false);

  React.useEffect(() => {
    if (data && !hasSynced.current) {
      hasSynced.current = true;
      void sync({ pull: true, push: false });
    }
  }, [data, sync]);

  return (
    <div
      data-testid="sync-state"
      data-state={JSON.stringify({
        ready: !!data,
        isSyncing,
      })}
    />
  );
}

describe('useSyncWiser', () => {
  it('combines document access with sync controls', async () => {
    const storage = createInMemoryStorageAdapter();
    const pullMock = vi.fn(async () => null);
    const pushMock = vi.fn(async () => undefined);

    render(
      <WiserProvider
        config={{
          storage,
          sync: {
            pull: pullMock,
            push: pushMock,
          },
        }}
      >
        <SyncProbe />
      </WiserProvider>
    );

    const stateNode = await screen.findByTestId('sync-state');

    await waitFor(() => {
      const state = JSON.parse(stateNode.getAttribute('data-state') ?? '{}');
      expect(state.ready).toBe(true);
      expect(state.isSyncing).toBe(false);
    });

    // initial load + manual sync
    expect(pullMock).toHaveBeenCalledTimes(2);
  });
});
