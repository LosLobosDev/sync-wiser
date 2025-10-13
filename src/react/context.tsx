import { createContext, useContext } from 'react';
import type { WiserRuntime } from '../runtime/runtime';

export const WiserContext = createContext<WiserRuntime | null>(null);

export function useWiserRuntime(): WiserRuntime {
  const runtime = useContext(WiserContext);
  if (!runtime) {
    throw new Error('useWiserRuntime must be used within a WiserProvider');
  }
  return runtime;
}
