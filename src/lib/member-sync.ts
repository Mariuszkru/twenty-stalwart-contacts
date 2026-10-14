// One step of the per-member sync chain. PLAN.md section 6.B.
// Pure orchestration: all I/O comes in through StepDeps, so it is unit-testable.
// Never logs or returns personal data, only ids and counters.

import type { EligibilityDecision } from 'src/lib/eligibility';
import {
  applyPlan,
  ensureAddressBook,
  loadBook,
  planDestroy,
  planSync,
  type Call,
} from 'src/lib/jmap-sync';
import {
  personToCard,
  personUid,
  UID_PREFIX,
  type PersonInput,
} from 'src/lib/jscontact';

export type Counts = {
  created: number;
  updated: number;
  destroyed: number;
  unchanged: number;
  failed: number;
};

export const emptyCounts = (): Counts => ({
  created: 0,
  updated: 0,
  destroyed: 0,
  unchanged: 0,
  failed: 0,
});

export type MemberJob = {
  workspaceMemberId: string;
  connectionId: string;
  phase: 'upsert' | 'delete' | 'ids';
  cursor: string | null;
  // 'ids' phase (event path): specific people and what happened to them
  personIds?: string[];
  op?: 'upsert' | 'delete';
  dryRun: boolean;
  counts: Counts;
};

export type StepDeps = {
  call: Call;
  session: { accountId: string; maxObjectsInSet: number };
  bookName: string;
  fetchPage: (after: string | null) => Promise<{
    people: PersonInput[];
    endCursor: string | null;
    hasNextPage: boolean;
  }>;
  existingIds: (ids: readonly string[]) => Promise<Set<string>>;
  fetchByIds: (ids: readonly string[]) => Promise<PersonInput[]>;
};

export type StepResult = {
  outcome: 'next' | 'done' | 'skipped' | 'cleared' | 'halted';
  reason?: string;
  next?: MemberJob;
  counts: Counts;
};

const add = (a: Counts, b: Partial<Counts>): Counts => ({
  created: a.created + (b.created ?? 0),
  updated: a.updated + (b.updated ?? 0),
  destroyed: a.destroyed + (b.destroyed ?? 0),
  unchanged: a.unchanged + (b.unchanged ?? 0),
  failed: a.failed + (b.failed ?? 0),
});

export const personIdFromUid = (uid: string): string => uid.slice(UID_PREFIX.length);

export const runMemberStep = async (
  job: MemberJob,
  decision: EligibilityDecision,
  deps: StepDeps,
): Promise<StepResult> => {
  if (decision.status === 'unconfigured') {
    return { outcome: 'skipped', reason: 'unconfigured', counts: job.counts };
  }

  const { call, session, bookName } = deps;

  // Fail closed: no access or unsupported config => wipe the managed cards of this book.
  if (decision.status === 'clear' || decision.status === 'halt-all') {
    const bookId = await ensureAddressBook(call, session.accountId, bookName, true);
    const existing = bookId ? await loadBook(call, session, bookId) : new Map();
    const plan = planSync(new Map(), existing, true);
    const r = await applyPlan(call, session, plan, job.dryRun);

    return {
      outcome: decision.status === 'clear' ? 'cleared' : 'halted',
      reason: decision.reason,
      counts: add(job.counts, { destroyed: r.destroyed, failed: r.failed }),
    };
  }

  if (job.phase === 'upsert') {
    const bookId = await ensureAddressBook(call, session.accountId, bookName, job.dryRun);
    const existing = bookId ? await loadBook(call, session, bookId) : new Map();
    const page = await deps.fetchPage(job.cursor);
    const desired = new Map(
      page.people.map((p) => [
        personUid(p.id),
        personToCard(p, {
          addressBookId: bookId ?? 'dry-run',
          hiddenFields: decision.hiddenFields,
        }),
      ]),
    );
    const plan = planSync(desired, existing, false);
    const r = await applyPlan(call, session, plan, job.dryRun);
    const counts = add(job.counts, {
      created: r.created,
      updated: r.updated,
      unchanged: plan.unchanged,
      failed: r.failed,
    });

    return {
      outcome: 'next',
      counts,
      next: page.hasNextPage
        ? { ...job, cursor: page.endCursor, counts }
        : { ...job, phase: 'delete', cursor: null, counts },
    };
  }

  if (job.phase === 'ids') {
    const ids = job.personIds ?? [];
    const bookId = await ensureAddressBook(call, session.accountId, bookName, job.dryRun || job.op === 'delete');
    const existing = bookId ? await loadBook(call, session, bookId) : new Map();

    if (job.op === 'delete') {
      const r = await applyPlan(call, session, planDestroy(ids.map(personUid), existing), job.dryRun);

      return { outcome: 'done', counts: add(job.counts, { destroyed: r.destroyed, failed: r.failed }) };
    }

    const people = await deps.fetchByIds(ids);
    const found = new Set(people.map((p) => p.id));
    const desired = new Map(
      people.map((p) => [
        personUid(p.id),
        personToCard(p, { addressBookId: bookId ?? 'dry-run', hiddenFields: decision.hiddenFields }),
      ]),
    );
    const plan = planSync(desired, existing, false);
    // Requested but gone (deleted in the meantime): remove their card too.
    plan.destroy.push(
      ...planDestroy(ids.filter((id) => !found.has(id)).map(personUid), existing).destroy,
    );
    const r = await applyPlan(call, session, plan, job.dryRun);

    return {
      outcome: 'done',
      counts: add(job.counts, {
        created: r.created,
        updated: r.updated,
        destroyed: r.destroyed,
        unchanged: plan.unchanged,
        failed: r.failed,
      }),
    };
  }

  // delete phase: managed cards whose person no longer exists
  const bookId = await ensureAddressBook(call, session.accountId, bookName, true);
  const existing = bookId ? await loadBook(call, session, bookId) : new Map();
  const uids = [...existing.keys()];
  const alive = await deps.existingIds(uids.map(personIdFromUid));
  const gone = uids.filter((uid) => !alive.has(personIdFromUid(uid)));
  const r = await applyPlan(call, session, planDestroy(gone, existing), job.dryRun);

  return {
    outcome: 'done',
    counts: add(job.counts, { destroyed: r.destroyed, failed: r.failed }),
  };
};
