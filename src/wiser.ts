import * as Y from 'yjs';
import type { WiserModel, YHelpers } from './types';

type ModelShape = Record<string, unknown>;

const ROOT_MAP_NAME = '__wiser_root__';

function createHelpers(): YHelpers {
  return {
    text: () => new Y.Text(),
    map: <T>() => new Y.Map<T>(),
    array: <T>() => new Y.Array<T>(),
    xmlText: () => new Y.XmlText(),
    xmlElement: (name?: string) => new Y.XmlElement(name ?? 'div'),
    xmlFragment: () => new Y.XmlFragment(),
  };
}

function ensureStructure<TShape extends ModelShape>(
  doc: Y.Doc,
  keys: Iterable<string>,
  factory: () => TShape
): TShape {
  const root = doc.getMap<unknown>(ROOT_MAP_NAME);

  for (const [key, value] of Object.entries(factory())) {
    if (!root.has(key)) {
      root.set(key, value);
    }
  }

  const data: Record<string, unknown> = {};
  for (const key of keys) {
    data[key] = root.get(key) ?? null;
  }
  return data as TShape;
}

export const Wiser = {
  define<TShape extends ModelShape>(
    name: string,
    factory: (helpers: YHelpers) => TShape
  ): WiserModel<TShape> {
    const shape = factory(createHelpers());
    const keys = Object.keys(shape);

    const initialize = (doc: Y.Doc): TShape =>
      ensureStructure(doc, keys, () => factory(createHelpers()));

    return {
      name,
      instantiate(doc?: Y.Doc) {
        const targetDoc = doc ?? new Y.Doc();
        const data = initialize(targetDoc);
        return { doc: targetDoc, data };
      },
      ensureStructure(doc: Y.Doc) {
        return initialize(doc);
      },
    };
  },
};

export type { WiserModel } from './types';
