import { enqueueJobs } from 'twenty-sdk/logic-function';

import { SYNC_MEMBER_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import { listAllStalwartConnections } from 'src/lib/connections';
import { buildMemberJobs } from 'src/lib/fanout';

// Queues one job per member with a Stalwart connection (200 jobs max per enqueue call).
export const queuePersonChanges = async (
  op: 'upsert' | 'delete',
  personIds: readonly string[],
): Promise<{ members: number; jobs: number }> => {
  if (process.env.SYNC_ENABLED === 'false' || !personIds.length) return { members: 0, jobs: 0 };

  const connections = await listAllStalwartConnections();
  const jobs = buildMemberJobs(connections, op, personIds);

  for (let i = 0; i < jobs.length; i += 200) {
    await enqueueJobs({
      logicFunctionUniversalIdentifier: SYNC_MEMBER_UNIVERSAL_IDENTIFIER,
      payloads: jobs.slice(i, i + 200) as unknown as Record<string, unknown>[],
      retryLimit: 2,
    });
  }

  return { members: new Set(jobs.map((j) => j.workspaceMemberId)).size, jobs: jobs.length };
};
