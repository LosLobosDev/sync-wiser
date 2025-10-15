import { useCallback, useEffect, useState } from 'react';
import type { WiserModel } from '../types';
import type {
  WiserDocumentHandle,
  WiserManualSyncOptions,
} from '../runtime/runtime';
import { useWiserRuntime } from './context';

export type UseWiserDocResult<TShape extends Record<string, unknown>> = {
  data: TShape | null;
  doc: WiserDocumentHandle<TShape>['doc'] | null;
  mutate: (
    updater: (data: TShape) => void,
    options?: { origin?: unknown }
  ) => Promise<void>;
  remove: () => Promise<void>;
  sync: (options?: WiserManualSyncOptions) => Promise<void>;
  loading: boolean;
  error: unknown | null;
};

export function useWiserDoc<TShape extends Record<string, unknown>>(
  docId: string,
  model: WiserModel<TShape>
): UseWiserDocResult<TShape> {
  const runtime = useWiserRuntime();
  const [handle, setHandle] =
    useState<WiserDocumentHandle<TShape> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown | null>(null);
  const [, forceRender] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    runtime
      .getDocument(docId, model)
      .then((loaded) => {
        if (cancelled) return;
        setHandle(loaded);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [docId, model, runtime]);

  useEffect(() => {
    if (!handle) return;

    const rerender = () => {
      forceRender((x) => x + 1);
    };

    handle.doc.on('update', rerender);
    return () => {
      handle.doc.off('update', rerender);
    };
  }, [handle]);

  const mutate = useCallback(
    async (
      updater: (data: TShape) => void,
      options?: { origin?: unknown }
    ) => {
      if (!handle) return;
      await handle.mutate(updater, options);
    },
    [handle]
  );

  const remove = useCallback(async () => {
    if (!handle) return;
    await handle.remove();
    setHandle(null);
  }, [handle]);

  const sync = useCallback(
    async (options?: WiserManualSyncOptions) => {
      if (!handle) return;
      await handle.sync(options);
    },
    [handle]
  );

  return {
    data: handle?.data ?? null,
    doc: handle?.doc ?? null,
    mutate,
    remove,
    sync,
    loading,
    error,
  };
}
