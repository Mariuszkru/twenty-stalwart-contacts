// Plan and apply card changes in one member's address book. PLAN.md section 6.
// Touches only cards whose uid is `urn:uuid:...`. Never logs card content.

import { failedIds, type JmapSession } from 'src/lib/jmap';
import { isManagedUid, type JsContactCard } from 'src/lib/jscontact';

// Properties owned by the sync. Anything else on a card (set by the user) is kept.
export const MANAGED_PROPS = [
  'name',
  'emails',
  'phones',
  'titles',
  'organizations',
  'links',
  'keywords',
] as const;

export type ExistingCard = { id: string; props: Record<string, unknown> };

export type SyncPlan = {
  create: { uid: string; card: JsContactCard }[];
  update: { id: string; patch: Record<string, unknown> }[];
  destroy: { id: string; uid: string }[];
  unchanged: number;
};

export type Call = (methodCalls: unknown[]) => Promise<any[]>;

const stable = (v: unknown): string =>
  JSON.stringify(v, (_k, val) =>
    val && typeof val === 'object' && !Array.isArray(val)
      ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => a.localeCompare(b)))
      : val,
  );

// JMAP patch: managed props set to the desired value, or null when the card no longer has them.
export const buildPatch = (
  desired: JsContactCard,
  existing: Record<string, unknown>,
): Record<string, unknown> => {
  const patch: Record<string, unknown> = {};

  for (const key of MANAGED_PROPS) {
    const want = desired[key] ?? null;
    const have = existing[key] ?? null;

    if (stable(want) !== stable(have)) patch[key] = want;
  }

  return patch;
};

// desired: uid -> card the member should have. existing: uid -> current card in the book.
// pruneMissing=true (full reconcile): managed cards absent from desired are destroyed.
export const planSync = (
  desired: ReadonlyMap<string, JsContactCard>,
  existing: ReadonlyMap<string, ExistingCard>,
  pruneMissing: boolean,
): SyncPlan => {
  const plan: SyncPlan = { create: [], update: [], destroy: [], unchanged: 0 };

  for (const [uid, card] of desired) {
    if (!isManagedUid(uid)) continue;

    const have = existing.get(uid);

    if (!have) {
      plan.create.push({ uid, card });
      continue;
    }

    const patch = buildPatch(card, have.props);

    if (Object.keys(patch).length) plan.update.push({ id: have.id, patch });
    else plan.unchanged += 1;
  }

  if (pruneMissing) {
    for (const [uid, have] of existing) {
      if (isManagedUid(uid) && !desired.has(uid)) {
        plan.destroy.push({ id: have.id, uid });
      }
    }
  }

  return plan;
};

// Destroy specific uids (event path): only managed uids that exist in the book.
export const planDestroy = (
  uids: readonly string[],
  existing: ReadonlyMap<string, ExistingCard>,
): SyncPlan => ({
  create: [],
  update: [],
  unchanged: 0,
  destroy: uids.flatMap((uid) => {
    const have = isManagedUid(uid) ? existing.get(uid) : undefined;

    return have ? [{ id: have.id, uid }] : [];
  }),
});

const chunk = <T>(items: readonly T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) =>
    items.slice(i * size, (i + 1) * size),
  );

export type ApplyResult = {
  dryRun: boolean;
  created: number;
  updated: number;
  destroyed: number;
  failed: number;
};

export const applyPlan = async (
  call: Call,
  session: Pick<JmapSession, 'accountId' | 'maxObjectsInSet'>,
  plan: SyncPlan,
  dryRun: boolean,
): Promise<ApplyResult> => {
  const result: ApplyResult = {
    dryRun,
    created: plan.create.length,
    updated: plan.update.length,
    destroyed: plan.destroy.length,
    failed: 0,
  };

  if (dryRun) return result;

  const size = Math.max(1, session.maxObjectsInSet);
  // creates and updates share a /set, destroys go separately (uid is unique per account)
  const upserts = [
    ...plan.create.map((c) => ({ kind: 'create' as const, ...c })),
    ...plan.update.map((u) => ({ kind: 'update' as const, ...u })),
  ];

  for (const part of chunk(upserts, size)) {
    const create: Record<string, JsContactCard> = {};
    const update: Record<string, Record<string, unknown>> = {};

    part.forEach((item, i) => {
      if (item.kind === 'create') create[`c${i}`] = item.card;
      else update[item.id] = item.patch;
    });

    const [res] = await call([
      ['ContactCard/set', { accountId: session.accountId, create, update }, 's'],
    ]);

    result.failed += failedIds(res[1]).length;
  }

  for (const part of chunk(plan.destroy, size)) {
    const [res] = await call([
      [
        'ContactCard/set',
        { accountId: session.accountId, destroy: part.map((d) => d.id) },
        'd',
      ],
    ]);

    result.failed += failedIds(res[1]).length;
  }

  return result;
};

// Reads managed cards of one book (paged). Returns uid -> {id, managed props}.
export const loadBook = async (
  call: Call,
  session: Pick<JmapSession, 'accountId' | 'maxObjectsInSet'>,
  bookId: string,
): Promise<Map<string, ExistingCard>> => {
  const out = new Map<string, ExistingCard>();
  const limit = Math.max(1, session.maxObjectsInSet);

  for (let position = 0; ; position += limit) {
    const [query, get] = await call([
      [
        'ContactCard/query',
        { accountId: session.accountId, filter: { inAddressBook: bookId }, position, limit },
        'q',
      ],
      [
        'ContactCard/get',
        {
          accountId: session.accountId,
          '#ids': { resultOf: 'q', name: 'ContactCard/query', path: '/ids' },
          properties: ['id', 'uid', ...MANAGED_PROPS],
        },
        'g',
      ],
    ]);

    for (const card of get[1].list ?? []) {
      if (isManagedUid(card.uid)) {
        const { id, uid, ...props } = card;

        out.set(uid, { id, props });
      }
    }

    if ((query[1].ids ?? []).length < limit) break;
  }

  return out;
};

export const ensureAddressBook = async (
  call: Call,
  accountId: string,
  name: string,
  dryRun: boolean,
): Promise<string | null> => {
  const [got] = await call([['AddressBook/get', { accountId }, 'a']]);
  const found = (got[1].list as { id: string; name: string }[]).find((b) => b.name === name);

  if (found) return found.id;
  if (dryRun) return null;

  const [set] = await call([
    ['AddressBook/set', { accountId, create: { b: { name } } }, 'b'],
  ]);

  if (failedIds(set[1]).length) throw new Error('AddressBook/set rejected');

  return set[1].created.b.id;
};
