import { Wiser } from 'sync-wiser';

export const CounterModel = Wiser.define('Counter', (y) => ({
  stats: y.map<number>(),
}));

export const TodoModel = Wiser.define('Todo', (y) => ({
  items: y.array<{ id: string; text: string; done: boolean }>(),
}));
