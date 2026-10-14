import type { EligibilityDecision } from 'src/lib/eligibility';
import type { Call } from 'src/lib/jmap-sync';
import {
  emptyCounts,
  runMemberStep,
  type MemberJob,
  type StepDeps,
} from 'src/lib/member-sync';
import { anyRoleHasPersonPredicates } from 'src/lib/twenty-reader';
import { describe, expect, it } from 'vitest';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const uid = (n: number) => `urn:uuid:${ID(n)}`;
const eligible: EligibilityDecision = { status: 'eligible', hiddenFields: [] };

// Minimal in-memory Stalwart: one account, address books and cards.
const fakeServer = (cards: Record<string, any> = {}, books = [{ id: 'b1', name: 'CRM' }]) => {
  let seq = 100;
  const log: string[] = [];
  const call: Call = async (calls) => {
    const out: any[] = [];
    let lastIds: string[] = [];

    for (const [name, args] of calls as [string, any, string][]) {
      log.push(name);
      if (name === 'AddressBook/get') out.push([name, { list: books }, 'x']);
      else if (name === 'AddressBook/set') {
        const id = `b${++seq}`;
        books.push({ id, name: args.create.b.name });
        out.push([name, { created: { b: { id } } }, 'x']);
      } else if (name === 'ContactCard/query') {
        lastIds = Object.keys(cards).filter((id) => cards[id].addressBookIds?.[args.filter.inAddressBook]);
        const page = lastIds.slice(args.position, args.position + args.limit);
        lastIds = page;
        out.push([name, { ids: page }, 'x']);
      } else if (name === 'ContactCard/get') {
        out.push([name, { list: lastIds.map((id) => ({ id, ...cards[id] })) }, 'x']);
      } else if (name === 'ContactCard/set') {
        for (const c of Object.values(args.create ?? {})) cards[`k${++seq}`] = c;
        for (const [id, patch] of Object.entries(args.update ?? {}))
          for (const [k, v] of Object.entries(patch as object)) {
            if (v === null) delete cards[id][k];
            else cards[id][k] = v;
          }
        for (const id of args.destroy ?? []) delete cards[id];
        out.push([name, {}, 'x']);
      }
    }
    return out;
  };
  return { call, cards, log };
};

const person = (n: number, last = 'Kowalski') => ({
  id: ID(n),
  name: { firstName: `P${n}`, lastName: last },
});

const baseJob = (over: Partial<MemberJob> = {}): MemberJob => ({
  workspaceMemberId: 'm1',
  connectionId: 'c1',
  phase: 'upsert',
  cursor: null,
  dryRun: false,
  counts: emptyCounts(),
  ...over,
});

const deps = (srv: ReturnType<typeof fakeServer>, pages: any[], alive: string[] = [], people: any[] = []): StepDeps => ({
  call: srv.call,
  session: { accountId: 'r', maxObjectsInSet: 500 },
  bookName: 'CRM',
  fetchPage: async (after) => pages[after ? Number(after) : 0],
  existingIds: async (ids) => new Set(ids.filter((i) => alive.includes(i))),
  fetchByIds: async (ids) => people.filter((p) => ids.includes(p.id)),
});

describe('runMemberStep upsert', () => {
  it('creates cards, chains to the next page, then to the delete phase', async () => {
    const srv = fakeServer();
    const pages = [
      { people: [person(1), person(2)], endCursor: '1', hasNextPage: true },
      { people: [person(3)], endCursor: '2', hasNextPage: false },
    ];
    const d = deps(srv, pages);
    const r1 = await runMemberStep(baseJob(), eligible, d);
    expect(r1.counts.created).toBe(2);
    expect(r1.next).toMatchObject({ phase: 'upsert', cursor: '1' });

    const r2 = await runMemberStep(r1.next!, eligible, d);
    expect(r2.counts.created).toBe(3);
    expect(r2.next).toMatchObject({ phase: 'delete', cursor: null });
    expect(Object.keys(srv.cards)).toHaveLength(3);
  });

  it('second run changes nothing (idempotent)', async () => {
    const srv = fakeServer();
    const pages = [{ people: [person(1), person(2)], endCursor: null, hasNextPage: false }];
    await runMemberStep(baseJob(), eligible, deps(srv, pages));
    const again = await runMemberStep(baseJob(), eligible, deps(srv, pages));
    expect(again.counts).toMatchObject({ created: 0, updated: 0, unchanged: 2, failed: 0 });
  });

  it('updates a changed person', async () => {
    const srv = fakeServer();
    await runMemberStep(baseJob(), eligible, deps(srv, [{ people: [person(1)], endCursor: null, hasNextPage: false }]));
    const r = await runMemberStep(baseJob(), eligible, deps(srv, [{ people: [person(1, 'Nowak')], endCursor: null, hasNextPage: false }]));
    expect(r.counts.updated).toBe(1);
  });

  it('dry-run reports the plan and writes nothing', async () => {
    const srv = fakeServer();
    const r = await runMemberStep(
      baseJob({ dryRun: true }),
      eligible,
      deps(srv, [{ people: [person(1)], endCursor: null, hasNextPage: false }]),
    );
    expect(r.counts.created).toBe(1);
    expect(srv.cards).toEqual({});
    expect(srv.log).not.toContain('ContactCard/set');
  });

  it('hidden fields never reach the card', async () => {
    const srv = fakeServer();
    const p = { ...person(1), emails: { primaryEmail: 'secret@example.test' } };
    await runMemberStep(
      baseJob(),
      { status: 'eligible', hiddenFields: ['emails'] },
      deps(srv, [{ people: [p], endCursor: null, hasNextPage: false }]),
    );
    expect(JSON.stringify(srv.cards)).not.toContain('secret@example.test');
  });
});

describe('runMemberStep delete phase', () => {
  const seed = () => {
    const srv = fakeServer({
      a: { uid: uid(1), addressBookIds: { b1: true }, name: { full: 'A' } },
      b: { uid: uid(2), addressBookIds: { b1: true }, name: { full: 'B' } },
      mine: { uid: 'personal-contact', addressBookIds: { b1: true }, name: { full: 'Mine' } },
    });
    return srv;
  };

  it('destroys managed cards whose person is gone, keeps others', async () => {
    const srv = seed();
    const r = await runMemberStep(baseJob({ phase: 'delete' }), eligible, deps(srv, [], [ID(1)]));
    expect(r.outcome).toBe('done');
    expect(r.counts.destroyed).toBe(1);
    expect(Object.keys(srv.cards).sort()).toEqual(['a', 'mine']);
  });

  it('never touches non-managed uids even when no person matches', async () => {
    const srv = seed();
    await runMemberStep(baseJob({ phase: 'delete' }), eligible, deps(srv, [], []));
    expect(srv.cards.mine).toBeDefined();
  });
});

describe('fail closed decisions', () => {
  it.each([
    [{ status: 'clear', reason: 'no-person-access' } as const, 'cleared'],
    [{ status: 'halt-all', reason: 'row-level-predicates' } as const, 'halted'],
  ])('%j wipes managed cards only', async (decision, outcome) => {
    const srv = fakeServer({
      a: { uid: uid(1), addressBookIds: { b1: true } },
      mine: { uid: 'personal-contact', addressBookIds: { b1: true } },
    });
    const r = await runMemberStep(baseJob(), decision, deps(srv, []));
    expect(r.outcome).toBe(outcome);
    expect(Object.keys(srv.cards)).toEqual(['mine']);
  });

  it('unconfigured touches nothing, makes no calls', async () => {
    const srv = fakeServer({ a: { uid: uid(1), addressBookIds: { b1: true } } });
    const r = await runMemberStep(baseJob(), { status: 'unconfigured' }, deps(srv, []));
    expect(r.outcome).toBe('skipped');
    expect(srv.log).toEqual([]);
    expect(Object.keys(srv.cards)).toEqual(['a']);
  });

  it('clear does not create the book when it is missing', async () => {
    const srv = fakeServer({}, []);
    await runMemberStep(baseJob(), { status: 'clear', reason: 'no-person-access' }, deps(srv, []));
    expect(srv.log).not.toContain('AddressBook/set');
  });
});

describe('anyRoleHasPersonPredicates', () => {
  const person = { objectMetadataId: 'p', readability: 'OPEN', fieldNames: new Map() };

  it('detects predicates and groups on person in any role', () => {
    expect(anyRoleHasPersonPredicates([{ id: 'r', rowLevelPermissionPredicates: [{ objectMetadataId: 'p' }] }], person)).toBe(true);
    expect(anyRoleHasPersonPredicates([{ id: 'r', rowLevelPermissionPredicateGroups: [{ objectMetadataId: 'p' }] }], person)).toBe(true);
  });

  it('ignores other objects and empty roles', () => {
    expect(anyRoleHasPersonPredicates([{ id: 'r', rowLevelPermissionPredicates: [{ objectMetadataId: 'x' }] }, { id: 's' }], person)).toBe(false);
  });
});

describe('runMemberStep ids phase (events)', () => {
  const job = (op: 'upsert' | 'delete', ids: string[], over: Partial<MemberJob> = {}) =>
    baseJob({ phase: 'ids', op, personIds: ids, ...over });

  it('upsert creates a new person and updates a changed one', async () => {
    const srv = fakeServer();
    await runMemberStep(job('upsert', [ID(1)]), eligible, deps(srv, [], [], [person(1)]));
    expect(Object.keys(srv.cards)).toHaveLength(1);
    const r = await runMemberStep(job('upsert', [ID(1)]), eligible, deps(srv, [], [], [person(1, 'Nowak')]));
    expect(r.counts.updated).toBe(1);
    expect(r.outcome).toBe('done');
    expect(r.next).toBeUndefined();
  });

  it('upsert of a person that no longer exists removes the card', async () => {
    const srv = fakeServer({ a: { uid: uid(1), addressBookIds: { b1: true } } });
    const r = await runMemberStep(job('upsert', [ID(1)]), eligible, deps(srv, [], [], []));
    expect(r.counts.destroyed).toBe(1);
    expect(srv.cards).toEqual({});
  });

  it('delete removes the card and leaves personal contacts', async () => {
    const srv = fakeServer({
      a: { uid: uid(1), addressBookIds: { b1: true } },
      mine: { uid: 'personal', addressBookIds: { b1: true } },
    });
    await runMemberStep(job('delete', [ID(1), 'personal']), eligible, deps(srv, []));
    expect(Object.keys(srv.cards)).toEqual(['mine']);
  });

  it('delete is a no-op for unknown people and does not create the book', async () => {
    const srv = fakeServer({}, []);
    const r = await runMemberStep(job('delete', [ID(9)]), eligible, deps(srv, []));
    expect(r.counts.destroyed).toBe(0);
    expect(srv.log).not.toContain('AddressBook/set');
  });

  it('a member who lost access is cleared by the next event', async () => {
    const srv = fakeServer({ a: { uid: uid(1), addressBookIds: { b1: true } } });
    const r = await runMemberStep(
      job('upsert', [ID(2)]),
      { status: 'clear', reason: 'no-person-access' },
      deps(srv, [], [], [person(2)]),
    );
    expect(r.outcome).toBe('cleared');
    expect(srv.cards).toEqual({});
  });

  it('dry-run writes nothing', async () => {
    const srv = fakeServer();
    const r = await runMemberStep(job('upsert', [ID(1)], { dryRun: true }), eligible, deps(srv, [], [], [person(1)]));
    expect(r.counts.created).toBe(1);
    expect(srv.cards).toEqual({});
  });
});
