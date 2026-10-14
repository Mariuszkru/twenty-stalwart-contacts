import { defineLogicFunction } from 'twenty-sdk/define';
import {
  enqueueJobs,
  getConnection,
  kv,
  RetryableLogicFunctionError,
} from 'twenty-sdk/logic-function';

import { SYNC_MEMBER_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import { evaluateEligibility } from 'src/lib/eligibility';
import { assertHttps, fetchSession, isTransientError, JmapHttpError, jmapCall } from 'src/lib/jmap';
import { runMemberStep, type MemberJob } from 'src/lib/member-sync';
import { recordOutcome } from 'src/lib/health-store';
import { existingPersonIds, fetchPeopleByIds, fetchPeoplePage } from 'src/lib/twenty-people';
import { fetchPersonMetadata, fetchRoles } from 'src/lib/twenty-metadata';
import { anyRoleHasPersonPredicates, snapshotsByMember } from 'src/lib/twenty-reader';

const statusKey = (memberId: string) => `member:${memberId}:status`;

// Coordination state only: ids, states, counters. No secrets, no personal data.
const saveStatus = (job: MemberJob, state: string, extra: Record<string, unknown> = {}) =>
  job.dryRun
    ? Promise.resolve()
    : kv.set(statusKey(job.workspaceMemberId), { state, at: new Date().toISOString(), ...extra });

// One step of one member's sync. Re-verifies access on EVERY step.
export default defineLogicFunction({
  universalIdentifier: SYNC_MEMBER_UNIVERSAL_IDENTIFIER,
  name: 'sync-member',
  description: 'Syncs a page of Person records into one member\'s Stalwart CRM book.',
  timeoutSeconds: 600,
  handler: async (job: MemberJob) => {
    if (process.env.SYNC_ENABLED === 'false') return { status: 'disabled' };

    // Only the connection of this very member; never another member's token.
    const connection = await getConnection(job.connectionId).catch(() => null);

    if (!connection || connection.workspaceMemberId !== job.workspaceMemberId) {
      await saveStatus(job, 'unconfigured');
      return { status: 'unconfigured' };
    }

    // Only private connections are accepted: a workspace-shared token is visible to
    // every member in Twenty, so it is refused and the member is asked to re-add it.
    if (connection.visibility !== 'user') {
      await saveStatus(job, 'shared-connection');
      if (!job.dryRun) await recordOutcome(job.workspaceMemberId, { kind: 'shared-connection' });
      return { status: 'shared-connection' };
    }

    if (connection.authFailedAt) {
      await saveStatus(job, 'auth-error');
      if (!job.dryRun) await recordOutcome(job.workspaceMemberId, { kind: 'auth-error' });
      return { status: 'auth-error' };
    }

    const person = await fetchPersonMetadata();
    const roles = person ? await fetchRoles() : [];
    const snapshots = person ? snapshotsByMember(roles, person) : new Map();
    // Unsupported config on any role stops everyone, not just that role's members.
    const globalPredicates = person ? anyRoleHasPersonPredicates(roles, person) : false;
    const role = snapshots.get(job.workspaceMemberId) ?? null;

    let decision = evaluateEligibility({
      role,
      personReadability: person?.readability,
      hasStalwartConnection: true,
    });

    // Purge wipes this member's synced cards; it never needs access to Person.
    if (job.purge) {
      decision = { status: 'clear', reason: 'purge-requested' };
    } else if (globalPredicates && decision.status !== 'halt-all') {
      decision = { status: 'halt-all', reason: 'row-level-predicates' };
    }

    try {
      const creds = { token: connection.accessToken };
      const session = await fetchSession(assertHttps(process.env.STALWART_JMAP_URL), creds);
      const result = await runMemberStep(job, decision, {
        call: (calls) => jmapCall(session, creds, calls),
        session,
        bookName: process.env.ADDRESS_BOOK_NAME?.trim() || 'CRM',
        fetchPage: fetchPeoplePage,
        existingIds: existingPersonIds,
        fetchByIds: fetchPeopleByIds,
      });

      if (result.next) {
        // Progress is saved before the next job is queued.
        await saveStatus(job, 'syncing', { phase: result.next.phase, counts: result.counts });
        await enqueueJobs({
          logicFunctionUniversalIdentifier: SYNC_MEMBER_UNIVERSAL_IDENTIFIER,
          payloads: [result.next as unknown as Record<string, unknown>],
          retryLimit: 2,
        });
      } else {
        if (!job.dryRun) {
          await recordOutcome(
            job.workspaceMemberId,
            result.outcome === 'halted'
              ? { kind: 'halted', reason: result.reason ?? 'unsupported-config' }
              : result.outcome === 'done'
                ? { kind: 'ok' }
                : { kind: 'neutral' },
          );
        }
        await saveStatus(
          job,
          result.outcome === 'done' ? 'connected' : result.outcome,
          { reason: result.reason, counts: result.counts },
        );
      }

      return { status: result.outcome, reason: result.reason, counts: result.counts };
    } catch (e) {
      if (e instanceof JmapHttpError && e.status === 401) {
        await saveStatus(job, 'auth-error');
        if (!job.dryRun) await recordOutcome(job.workspaceMemberId, { kind: 'auth-error' });
        return { status: 'auth-error' };
      }

      if (isTransientError(e)) throw new RetryableLogicFunctionError('Stalwart temporarily unavailable');

      throw e;
    }
  },
});
