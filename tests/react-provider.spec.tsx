import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Wiser } from '../src/wiser';
import { WiserProvider } from '../src/react/WiserProvider';
import { useWiserDoc } from '../src/react/useWiserDoc';
import { createInMemoryStorageAdapter } from '../src/storage/inMemoryStorageAdapter';

const Counter = Wiser.define('Counter', (y) => ({
  stats: y.map<number>(),
}));

function CounterView() {
  const { data, mutate, loading } = useWiserDoc('counter-1', Counter);

  if (loading || !data) {
    return <div>Loading…</div>;
  }

  const count = data.stats.get('count') ?? 0;

  return (
    <div>
      <span>{`Count: ${count}`}</span>
      <button
        onClick={() =>
          mutate((draft) => {
            const current = draft.stats.get('count') ?? 0;
            draft.stats.set('count', current + 1);
          })
        }
      >
        Increment
      </button>
    </div>
  );
}

describe('WiserProvider', () => {
  it('provides runtime context and updates docs via useWiserDoc', async () => {
    const storage = createInMemoryStorageAdapter();
    render(
      <WiserProvider config={{ storage }}>
        <CounterView />
      </WiserProvider>
    );

    expect(await screen.findByText('Count: 0')).not.toBeNull();

    const button = await screen.findByRole('button', { name: /increment/i });
    fireEvent.click(button);

    expect(await screen.findByText('Count: 1')).not.toBeNull();

    const storedUpdates = await storage.getUpdates('counter-1');
    expect(storedUpdates).not.toBeNull();
    expect(storedUpdates?.length ?? 0).toBeGreaterThanOrEqual(1);
  });
});
