import { useCallback, useEffect, useMemo, useState } from 'react';
import type { WiserModel } from '../types';
import type { WiserManualSyncOptions } from '../runtime/runtime';
import { useWiserDoc, type UseWiserDocResult } from './useWiserDoc';
import { useWiserRuntime } from './context';

export type UseSyncWiserResult<TShape extends Record<string, unknown>> =
  UseWiserDocResult<TShape> & {
    isSyncing: boolean;
  };

export function useSyncWiser<TShape extends Record<string, unknown>>(
  docId: string,
  model: WiserModel<TShape>
): UseSyncWiserResult<TShape> {
  const runtime = useWiserRuntime();
  const docResult = useWiserDoc(docId, model);
  const [inflightOperations, setInflightOperations] = useState(0);

  useEffect(() => {
    const unsubscribe = runtime.onSyncEvent((event) => {
      if (event.docId !== docId) {
        return;
      }
      setInflightOperations((current) => {
        if (event.phase === 'start') {
          return current + 1;
        }
        if (event.phase === 'success' || event.phase === 'error') {
          return Math.max(0, current - 1);
        }
        return current;
      });
    });
    return unsubscribe;
  }, [docId, runtime]);

  const sync = useCallback(
    async (options?: WiserManualSyncOptions) => {
      if (!docResult.doc) {
        return;
      }
      await runtime.syncNow(docId, options);
    },
    [runtime, docId, docResult.doc]
  );

  return useMemo(
    () => ({
      data: docResult.data,
      doc: docResult.doc,
      mutate: docResult.mutate,
      remove: docResult.remove,
      sync,
      loading: docResult.loading,
      error: docResult.error,
      isSyncing: inflightOperations > 0,
    }),
    [
      docResult.data,
      docResult.doc,
      docResult.mutate,
      docResult.remove,
      docResult.loading,
      docResult.error,
      inflightOperations,
      sync,
    ]
  );
}
