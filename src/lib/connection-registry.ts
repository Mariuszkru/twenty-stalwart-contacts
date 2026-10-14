// Registry of Stalwart connection ids, kept in kv. Ids and owners only, never tokens.
// Needed because private ("Just for me") connections are invisible to cron and database
// events; jobs read the token by id with getConnection instead. PLAN.md section 8.

export type RegistryEntry = {
  id: string;
  workspaceMemberId: string | null;
  userWorkspaceId: string | null;
};

export const REGISTRY_KEY = 'connections:index';

export const addEntry = (
  entries: readonly RegistryEntry[],
  entry: RegistryEntry,
): RegistryEntry[] => [...entries.filter((e) => e.id !== entry.id), entry];

export const removeEntry = (
  entries: readonly RegistryEntry[],
  id: string,
): RegistryEntry[] => entries.filter((e) => e.id !== id);

type Listed = {
  id: string;
  workspaceMemberId: string | null;
  userWorkspaceId: string;
  authFailedAt: string | null;
};

export type KnownConnection = {
  id: string;
  workspaceMemberId: string | null;
  userWorkspaceId: string | null;
  authFailedAt: string | null;
};

// listConnections (shared ones) wins over registry entries for the same id,
// because it carries the current authFailedAt.
export const mergeConnections = (
  listed: readonly Listed[],
  registry: readonly RegistryEntry[],
): KnownConnection[] => {
  const byId = new Map<string, KnownConnection>();

  for (const r of registry) byId.set(r.id, { ...r, authFailedAt: null });
  for (const l of listed) byId.set(l.id, { ...l });

  return [...byId.values()];
};
