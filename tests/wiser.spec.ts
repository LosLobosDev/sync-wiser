import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { Wiser } from '../src/wiser';

describe('Wiser.define', () => {
  const ShoppingList = Wiser.define('ShoppingList', (y) => ({
    name: y.text(),
    items: y.array<{ id: string; title: string }>(),
    metadata: y.map<{ createdAt: number }>(),
  }));

  it('creates a model with named structure', () => {
    const { doc, data } = ShoppingList.instantiate();
    expect(doc).toBeInstanceOf(Y.Doc);
    expect(data.name).toBeInstanceOf(Y.Text);
    expect(data.items).toBeInstanceOf(Y.Array);
    expect(data.metadata).toBeInstanceOf(Y.Map);
  });

  it('hydrates existing docs without overwriting state', () => {
    const doc = new Y.Doc();
    const { data } = ShoppingList.instantiate(doc);
    data.name.insert(0, 'Groceries');
    data.items.push([{ id: '1', title: 'Apples' }]);

    const reopened = ShoppingList.instantiate(doc);
    expect(reopened.data.name.toString()).toBe('Groceries');
    expect(reopened.data.items.length).toBe(1);
  });
});
