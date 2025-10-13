import { useRef, useState, useEffect } from 'react';
import {
  WiserProvider,
  useWiserDoc,
  createLocalStorageAdapter,
  createInMemoryStorageAdapter,
} from 'sync-wiser';
import { CounterModel, TodoModel } from './models';

const isBrowser = typeof window !== 'undefined';

const storage = isBrowser
  ? createLocalStorageAdapter({
      namespace: 'sync-wiser/react-counter',
      maxUpdatesPerDoc: 500,
    })
  : createInMemoryStorageAdapter();

const COUNTER_STATE_KEY = 'sync-wiser/react-counter:counter';
const TODO_STATE_KEY = 'sync-wiser/react-counter:todos';

const wiserConfig = { storage };

function CounterPanel() {
  const { data, doc, mutate, loading } = useWiserDoc(
    'demo-counter',
    CounterModel
  );
  const seeded = useRef(false);

  useEffect(() => {
    if (!isBrowser || seeded.current || loading || !data) return;
    if (data.stats.has('value')) {
      seeded.current = true;
      return;
    }

    const existing = window.localStorage.getItem(COUNTER_STATE_KEY);
    if (!existing) {
      seeded.current = true;
      return;
    }

    const parsed = Number.parseInt(existing, 10);
    if (Number.isFinite(parsed)) {
      seeded.current = true;
      void mutate((draft) => {
        draft.stats.set('value', parsed);
      });
    } else {
      seeded.current = true;
    }
  }, [loading, data, mutate]);

  useEffect(() => {
    if (!isBrowser || !data || !doc) return;

    const persist = () => {
      const value = data.stats.get('value') ?? 0;
      window.localStorage.setItem(COUNTER_STATE_KEY, value.toString());
    };

    persist();

    const handler = () => persist();
    doc.on('update', handler);
    return () => {
      doc.off('update', handler);
    };
  }, [data, doc]);

  if (loading || !data) {
    return <section className="panel">Loading counter…</section>;
  }

  const count = data.stats.get('value') ?? 0;

  return (
    <section className="panel">
      <header>
        <h2>Shared Counter</h2>
        <p>
          This counter lives in a Y.Doc. Click the buttons to mutate the shared
          state.
        </p>
      </header>
      <div className="counter">
        <button
          onClick={() =>
            mutate((draft) => {
              const next = (draft.stats.get('value') ?? 0) - 1;
              draft.stats.set('value', next);
            })
          }
        >
          –1
        </button>
        <span>{count}</span>
        <button
          onClick={() =>
            mutate((draft) => {
              const next = (draft.stats.get('value') ?? 0) + 1;
              draft.stats.set('value', next);
            })
          }
        >
          +1
        </button>
      </div>
    </section>
  );
}

function TodoPanel() {
  const { data, doc, mutate, loading } = useWiserDoc('demo-todos', TodoModel);
  const [text, setText] = useState('');
  const seeded = useRef(false);

  useEffect(() => {
    if (!isBrowser || seeded.current || loading || !data) return;
    if (data.items.length > 0) {
      seeded.current = true;
      return;
    }

    const existing = window.localStorage.getItem(TODO_STATE_KEY);
    if (!existing) {
      seeded.current = true;
      return;
    }

    try {
      const parsed = JSON.parse(existing) as Array<{
        id: string;
        text: string;
        done: boolean;
      }>;
      if (Array.isArray(parsed) && parsed.length > 0) {
        seeded.current = true;
        void mutate((draft) => {
          draft.items.push(parsed);
        });
      } else {
        seeded.current = true;
      }
    } catch (error) {
      console.warn('[sync-wiser example] Failed to parse stored todos', error);
      seeded.current = true;
    }
  }, [loading, data, mutate]);

  useEffect(() => {
    if (!isBrowser || !data || !doc) return;

    const persist = () => {
      const payload = data.items.toArray().map((item) => ({
        id: item.id,
        text: item.text,
        done: item.done,
      }));
      window.localStorage.setItem(TODO_STATE_KEY, JSON.stringify(payload));
    };

    persist();

    const handler = () => persist();
    doc.on('update', handler);
    return () => {
      doc.off('update', handler);
    };
  }, [data, doc]);

  if (loading || !data) {
    return <section className="panel">Loading todos…</section>;
  }

  const items = data.items.toArray();

  const addTodo = async () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    await mutate((draft) => {
      draft.items.push([
        { id: crypto.randomUUID(), text: trimmed, done: false },
      ]);
    });
    setText('');
  };

  const toggle = (id: string) =>
    mutate((draft) => {
      const itemsArray = draft.items.toArray();
      const index = itemsArray.findIndex((item) => item.id === id);
      if (index < 0) return;

      const current = draft.items.get(index);
      if (!current) return;

      draft.items.delete(index, 1);
      draft.items.insert(index, [{ ...current, done: !current.done }]);
    });

  const remove = (id: string) =>
    mutate((draft) => {
      const index = draft.items.toArray().findIndex((item) => item.id === id);
      if (index >= 0) {
        draft.items.delete(index, 1);
      }
    });

  return (
    <section className="panel">
      <header>
        <h2>Shared Todos</h2>
        <p>
          Add or toggle tasks. Multiple tabs running this example will stay in
          sync.
        </p>
      </header>
      <form
        className="todo-form"
        onSubmit={(event) => {
          event.preventDefault();
          void addTodo();
        }}
      >
        <input
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Add a task"
        />
        <button type="submit">Add</button>
      </form>

      <ul className="todo-list">
        {items.map((item) => (
          <li key={item.id} data-done={item.done}>
            <label>
              <input
                type="checkbox"
                checked={item.done}
                onChange={() => void toggle(item.id)}
              />
              <span>{item.text}</span>
            </label>
            <button
              className="remove"
              onClick={() => void remove(item.id)}
              aria-label={`Remove ${item.text}`}
            >
              ×
            </button>
          </li>
        ))}
        {items.length === 0 && (
          <li className="empty">No todos yet—add your first one above.</li>
        )}
      </ul>
    </section>
  );
}

export default function App() {
  return (
    <WiserProvider config={wiserConfig}>
      <main className="app">
        <header className="hero">
          <h1>sync-wiser React Example</h1>
          <p>
            This demo uses the in-memory storage adapter. Open another browser
            tab pointing at this page to try collaborative editing.
          </p>
        </header>
        <div className="grid">
          <CounterPanel />
          <TodoPanel />
        </div>
      </main>
    </WiserProvider>
  );
}
