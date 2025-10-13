import type { PropsWithChildren } from 'react';
import { useMemo } from 'react';
import { WiserRuntime } from '../runtime/runtime';
import type { WiserConfig } from '../types';
import { WiserContext } from './context';

export type WiserProviderProps = PropsWithChildren<{
  config: WiserConfig;
}>;

export function WiserProvider({ config, children }: WiserProviderProps) {
  const runtime = useMemo(() => new WiserRuntime(config), [config]);
  return <WiserContext.Provider value={runtime}>{children}</WiserContext.Provider>;
}
