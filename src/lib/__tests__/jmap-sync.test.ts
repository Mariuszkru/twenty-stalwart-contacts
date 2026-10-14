import {
  applyPlan,
  buildPatch,
  ensureAddressBook,
  loadBook,
  planDestroy,
  planSync,
  type Call,
  type ExistingCard,
} from 'src/lib/jmap-sync';
import { describe, expect, it, vi } from 'vitest';

const U1 = 'urn:uuid:11111111-1111-4111-8111-111111111111';
const U2 = 'urn:uuid:22222222-2222-4222-8222-222222222222';
const card = (uid: string, extra: Record<string, unknown> = {}) => ({
  '@type': 'Card',
  uid,
  name: { full: 'A' },
  ...extra,
});
const have = (id: string, props: Record<string, unknown>): ExistingCard => ({ id, props });
const session = { accountId: 'r', maxObjectsInSet: 2 };

describe('buildPatch', () => {
  it('is empty when managed props are equal, regardless of key order', () => {
    expect(
      buildPatch(
        card(U1, { emails: { e1: { address: 'a@x.test', pref: 1 } } }),
        { name: { full: 'A' }, emails: { e1: { pref: 1, address: 'a@x.test' } } },
      ),
    ).toEqual({});
  });

  it('sets changed props and nulls removed ones', () => {
    expect(
      buildPatch(card(U1, { name: { full: 'B' } }), {
        name: { full: 'A' },
        phones: { p1: { number: '+48600000000' } },
      }),
    ).toEqual({ name: { full: 'B' }, phones: null });
  });

  it('ignores unmanaged props of the existing card', () => {
    expect(buildPatch(card(U1), { name: { full: 'A' }, notes: { n: 1 } })).toEqual({});
  });
});

describe('planSync', () => {
  const desired = new Map([[U1, card(U1)], [U2, card(U2)]]);

  it('creates missing, updates changed, counts unchanged', () => {
    const existing = new Map([
      [U1, have('a', { name: { full: 'OLD' } })],
    ]);
    const p = planSync(desired, existing, false);
    expect(p.create.map((c) => c.uid)).toEqual([U2]);
    expect(p.update).toEqual([{ id: 'a', patch: { name: { full: 'A' } } }]);
    expect(p.destroy).toEqual([]);
  });

  it('is a no-op when book matches (idempotent)', () => {
    const existing = new Map([
      [U1, have('a', { name: { full: 'A' } })],
      [U2, have('b', { name: { full: 'A' } })],
    ]);
    const p = planSync(desired, existing, true);
    expect(p).toEqual({ create: [], update: [], destroy: [], unchanged: 2 });
  });

  it('prunes managed cards missing from desired only when asked', () => {
    const existing = new Map([[U1, have('a', {})], [U2, have('b', {})]]);
    const d = new Map([[U1, card(U1)]]);
    expect(planSync(d, existing, true).destroy).toEqual([{ id: 'b', uid: U2 }]);
    expect(planSync(d, existing, false).destroy).toEqual([]);
  });

  it('never destroys or creates non-managed uids', () => {
    const existing = new Map([
      ['personal-uid', have('x', {})],
      ['', have('y', {})],
    ]);
    const d = new Map([['other-uid', card('other-uid')]]);
    const p = planSync(d, existing, true);
    expect(p).toEqual({ create: [], update: [], destroy: [], unchanged: 0 });
  });
});

describe('planDestroy', () => {
  it('destroys only managed uids that exist', () => {
    const existing = new Map([[U1, have('a', {})], ['personal', have('p', {})]]);
    expect(planDestroy([U1, U2, 'personal'], existing).destroy).toEqual([{ id: 'a', uid: U1 }]);
  });
});

describe('applyPlan', () => {
  const plan = {
    create: [1, 2, 3].map((i) => ({ uid: `urn:uuid:${i}`, card: card(`urn:uuid:${i}`) })),
    update: [{ id: 'u1', patch: { name: null } }],
    destroy: [{ id: 'd1', uid: U1 }, { id: 'd2', uid: U2 }, { id: 'd3', uid: 'urn:uuid:3' }],
    unchanged: 0,
  };

  it('dry-run makes no calls and reports the plan', async () => {
    const call = vi.fn();
    const r = await applyPlan(call as unknown as Call, session, plan, true);
    expect(call).not.toHaveBeenCalled();
    expect(r).toEqual({ dryRun: true, created: 3, updated: 1, destroyed: 3, failed: 0 });
  });

  it('chunks by maxObjectsInSet and sends destroys separately', async () => {
    const call = vi.fn(async () => [['ContactCard/set', {}, 'x']]) as unknown as Call;
    await applyPlan(call, session, plan, false);
    const sets = (call as any).mock.calls.map((c: any[]) => c[0][0][1]);
    // 4 upserts / 2 = 2 calls, 3 destroys / 2 = 2 calls
    expect(sets).toHaveLength(4);
    expect(sets.slice(0, 2).every((s: any) => !s.destroy)).toBe(true);
    expect(sets.slice(2).every((s: any) => s.destroy && !s.create)).toBe(true);
    expect(sets.slice(2).flatMap((s: any) => s.destroy)).toEqual(['d1', 'd2', 'd3']);
  });

  it('counts notCreated/notUpdated/notDestroyed as failures despite HTTP success', async () => {
    const call = vi
      .fn()
      .mockResolvedValueOnce([['ContactCard/set', { notCreated: { c0: {} }, notUpdated: { u1: {} } }, 's']])
      .mockResolvedValueOnce([['ContactCard/set', { notDestroyed: { d1: {} } }, 'd']]) as unknown as Call;
    const r = await applyPlan(call, { accountId: 'r', maxObjectsInSet: 500 }, plan, false);
    expect(r.failed).toBe(3);
  });
});

describe('loadBook', () => {
  it('pages, keeps only managed cards, separates id and props', async () => {
    const pages = [
      { ids: ['1', '2'], list: [{ id: '1', uid: U1, name: { full: 'A' } }, { id: '2', uid: 'personal' }] },
      { ids: ['3'], list: [{ id: '3', uid: U2, name: { full: 'B' } }] },
    ];
    let i = 0;
    const call = vi.fn(async () => {
      const p = pages[i++];
      return [['ContactCard/query', { ids: p.ids }, 'q'], ['ContactCard/get', { list: p.list }, 'g']];
    }) as unknown as Call;
    const book = await loadBook(call, session, 'book1');
    expect([...book.keys()]).toEqual([U1, U2]);
    expect(book.get(U1)).toEqual({ id: '1', props: { name: { full: 'A' } } });
    expect((call as any).mock.calls[0][0][0][1].filter).toEqual({ inAddressBook: 'book1' });
    expect(call).toHaveBeenCalledTimes(2);
  });
});

describe('ensureAddressBook', () => {
  it('returns existing id without creating', async () => {
    const call = vi.fn(async () => [['AddressBook/get', { list: [{ id: 'b', name: 'CRM' }] }, 'a']]) as unknown as Call;
    expect(await ensureAddressBook(call, 'r', 'CRM', false)).toBe('b');
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('dry-run does not create', async () => {
    const call = vi.fn(async () => [['AddressBook/get', { list: [] }, 'a']]) as unknown as Call;
    expect(await ensureAddressBook(call, 'r', 'CRM', true)).toBeNull();
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('creates when missing and throws on rejection', async () => {
    const ok = vi
      .fn()
      .mockResolvedValueOnce([['AddressBook/get', { list: [] }, 'a']])
      .mockResolvedValueOnce([['AddressBook/set', { created: { b: { id: 'new' } } }, 'b']]);
    expect(await ensureAddressBook(ok as unknown as Call, 'r', 'CRM', false)).toBe('new');
    const bad = vi
      .fn()
      .mockResolvedValueOnce([['AddressBook/get', { list: [] }, 'a']])
      .mockResolvedValueOnce([['AddressBook/set', { notCreated: { b: {} } }, 'b']]);
    await expect(ensureAddressBook(bad as unknown as Call, 'r', 'CRM', false)).rejects.toThrow();
  });
});
