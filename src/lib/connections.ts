import { kv, listConnections } from 'twenty-sdk/logic-function';

import {
  mergeConnections,
  REGISTRY_KEY,
  type KnownConnection,
  type RegistryEntry,
} from 'src/lib/connection-registry';

export const readRegistry = async (): Promise<RegistryEntry[]> =>
  (await kv.get<RegistryEntry[]>(REGISTRY_KEY)) ?? [];

export const writeRegistry = (entries: RegistryEntry[]) => kv.set(REGISTRY_KEY, entries);

// Every Stalwart connection the app can know about, including private ones that
// cron and database events cannot list. Callers re-check the owner on every job.
export const listAllStalwartConnections = async (): Promise<KnownConnection[]> =>
  mergeConnections(await listConnections({ providerName: 'stalwart' }), await readRegistry());
