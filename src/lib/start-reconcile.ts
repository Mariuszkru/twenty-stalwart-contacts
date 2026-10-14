import { enqueueJobs, listConnections } from 'twenty-sdk/logic-function';

import { SYNC_MEMBER_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import { emptyCounts, type MemberJob } from 'src/lib/member-sync';

// Queues a full reconcile chain for members that own a Stalwart connection.
// onlyUserWorkspaceId limits it to one member (sync-now for the calling member).
export const startReconcile = async (opts: {
  dryRun: boolean;
  onlyUserWorkspaceId?: string | null;
  purge?: boolean;
}) => {
  if (process.env.SYNC_ENABLED === 'false') return { status: 'disabled' as const };

  const connections = await listConnections({ providerName: 'stalwart' });
  const jobs: MemberJob[] = connections
    .filter(
      (c) =>
        c.workspaceMemberId &&
        !c.authFailedAt &&
        (opts.onlyUserWorkspaceId === undefined || c.userWorkspaceId === opts.onlyUserWorkspaceId),
    )
    .map((c) => ({
      workspaceMemberId: c.workspaceMemberId as string,
      connectionId: c.id,
      phase: 'upsert' as const,
      cursor: null,
      dryRun: opts.dryRun,
      counts: emptyCounts(),
      ...(opts.purge ? { purge: true } : {}),
    }));

  if (jobs.length) {
    await enqueueJobs({
      logicFunctionUniversalIdentifier: SYNC_MEMBER_UNIVERSAL_IDENTIFIER,
      payloads: jobs as unknown as Record<string, unknown>[],
      retryLimit: 2,
    });
  }

  return { status: 'queued' as const, dryRun: opts.dryRun, members: jobs.length, connections: connections.length };
};
