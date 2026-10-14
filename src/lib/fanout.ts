// Fan-out of person changes to one sync-member job per member. PLAN.md section 6.A.
// Pure job building here; the I/O wrapper is in queuePersonChanges.
import { emptyCounts, type MemberJob } from 'src/lib/member-sync';

export const EVENT_BATCH = 200;

export const uniqueIds = (events: readonly { recordId?: unknown }[]): string[] => [
  ...new Set(
    events.flatMap((e) => (typeof e.recordId === 'string' && e.recordId ? [e.recordId] : [])),
  ),
];

type Conn = { id: string; workspaceMemberId: string | null; authFailedAt: string | null };

// Members without a usable connection are skipped: not an error.
export const buildMemberJobs = (
  connections: readonly Conn[],
  op: 'upsert' | 'delete',
  personIds: readonly string[],
  dryRun = false,
): MemberJob[] => {
  const jobs: MemberJob[] = [];

  for (const c of connections) {
    if (!c.workspaceMemberId || c.authFailedAt) continue;

    for (let i = 0; i < personIds.length; i += EVENT_BATCH) {
      jobs.push({
        workspaceMemberId: c.workspaceMemberId,
        connectionId: c.id,
        phase: 'ids',
        cursor: null,
        personIds: personIds.slice(i, i + EVENT_BATCH),
        op,
        dryRun,
        counts: emptyCounts(),
      });
    }
  }

  return jobs;
};
