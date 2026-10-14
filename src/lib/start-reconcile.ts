import { enqueueJobs } from 'twenty-sdk/logic-function';

import { SYNC_MEMBER_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import { listAllStalwartConnections } from 'src/lib/connections';
import { emptyCounts, type MemberJob } from 'src/lib/member-sync';

// Queues a full reconcile chain for members that own a Stalwart connection.
// onlyUserWorkspaceId limits it to one member (sync-now for the calling member).
export const startReconcile = async (opts: {
  dryRun: boolean;
  onlyUserWorkspaceId?: string | null;
  purge?: boolean;
}) => {
  if (process.env.SYNC_ENABLED === 'false') return { status: 'disabled' as const };

  const connections = await listAllStalwartConnections();
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

  return {
    status: 'queued' as const,
    dryRun: opts.dryRun,
    members: jobs.length,
    connections: connections.length,
    // ids only, to drive a manual sync-member run in dry-run
    ...(opts.dryRun ? { jobs: jobs.map((j) => ({ m: j.workspaceMemberId, c: j.connectionId })) } : {}),
  };
};

// Full sync for one connection right away (used after a member connects or reconnects).
export const queueFullSyncFor = async (connection: {
  id: string;
  workspaceMemberId: string | null;
}): Promise<boolean> => {
  if (process.env.SYNC_ENABLED === 'false' || !connection.workspaceMemberId) return false;

  const job: MemberJob = {
    workspaceMemberId: connection.workspaceMemberId,
    connectionId: connection.id,
    phase: 'upsert',
    cursor: null,
    dryRun: false,
    counts: emptyCounts(),
  };

  await enqueueJobs({
    logicFunctionUniversalIdentifier: SYNC_MEMBER_UNIVERSAL_IDENTIFIER,
    payloads: [job as unknown as Record<string, unknown>],
    retryLimit: 2,
  });

  return true;
};
