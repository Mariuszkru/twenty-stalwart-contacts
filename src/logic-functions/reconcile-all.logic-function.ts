import { defineLogicFunction } from 'twenty-sdk/define';
import { enqueueJobs, listConnections } from 'twenty-sdk/logic-function';

import {
  RECONCILE_ALL_UNIVERSAL_IDENTIFIER,
  SYNC_MEMBER_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';
import { emptyCounts, type MemberJob } from 'src/lib/member-sync';

type Payload = { dryRun?: boolean };

// Starts a full reconcile: one sync-member chain per member that owns a Stalwart connection.
// Dry-run by default. Members without a connection are not an error and are skipped.
export default defineLogicFunction({
  universalIdentifier: RECONCILE_ALL_UNIVERSAL_IDENTIFIER,
  name: 'reconcile-all',
  description: 'Queues a full sync for every member with a Stalwart connection.',
  timeoutSeconds: 120,
  handler: async (payload: Payload | undefined) => {
    if (process.env.SYNC_ENABLED === 'false') return { status: 'disabled' };

    const dryRun = payload?.dryRun !== false;
    const connections = await listConnections({ providerName: 'stalwart' });
    const jobs: MemberJob[] = connections
      .filter((c) => c.workspaceMemberId && !c.authFailedAt)
      .map((c) => ({
        workspaceMemberId: c.workspaceMemberId as string,
        connectionId: c.id,
        phase: 'upsert',
        cursor: null,
        dryRun,
        counts: emptyCounts(),
      }));

    if (jobs.length) {
      await enqueueJobs({
        logicFunctionUniversalIdentifier: SYNC_MEMBER_UNIVERSAL_IDENTIFIER,
        payloads: jobs as unknown as Record<string, unknown>[],
        retryLimit: 2,
      });
    }

    return {
      status: 'queued',
      dryRun,
      members: jobs.length,
      connections: connections.length,
      // ids only, to drive a manual sync-member run in dry-run
      ...(dryRun ? { jobs: jobs.map((j) => ({ m: j.workspaceMemberId, c: j.connectionId })) } : {}),
    };
  },
});
