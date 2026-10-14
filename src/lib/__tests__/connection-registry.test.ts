import { addEntry, mergeConnections, removeEntry, shouldPurgeOnDisconnect } from 'src/lib/connection-registry';
import { describe, expect, it } from 'vitest';

const e = (id: string, m: string | null = 'm1') => ({ id, workspaceMemberId: m, userWorkspaceId: `u-${id}` });

describe('registry', () => {
  it('adds once per id and replaces the old entry', () => {
    const a = addEntry([e('c1', 'old')], e('c1', 'new'));
    expect(a).toEqual([e('c1', 'new')]);
  });

  it('removes by id and ignores unknown ids', () => {
    expect(removeEntry([e('c1'), e('c2')], 'c1')).toEqual([e('c2')]);
    expect(removeEntry([e('c1')], 'zzz')).toEqual([e('c1')]);
  });

  it('does not mutate its input', () => {
    const src = [e('c1')];
    addEntry(src, e('c2'));
    removeEntry(src, 'c1');
    expect(src).toEqual([e('c1')]);
  });
});

describe('mergeConnections', () => {
  it('unions listed and registry connections by id', () => {
    const m = mergeConnections(
      [{ id: 'c1', workspaceMemberId: 'm1', userWorkspaceId: 'u1', authFailedAt: null }],
      [e('c2', 'm2')],
    );
    expect(m.map((c) => c.id).sort()).toEqual(['c1', 'c2']);
  });

  it('listed entry wins and carries authFailedAt', () => {
    const m = mergeConnections(
      [{ id: 'c1', workspaceMemberId: 'm1', userWorkspaceId: 'u1', authFailedAt: '2026-10-14' }],
      [e('c1', 'm1')],
    );
    expect(m).toHaveLength(1);
    expect(m[0].authFailedAt).toBe('2026-10-14');
  });

  it('registry-only entries start without an auth failure', () => {
    expect(mergeConnections([], [e('c1')])[0].authFailedAt).toBeNull();
  });
});

describe('shouldPurgeOnDisconnect', () => {
  const conns = [
    { id: 'c1', workspaceMemberId: 'm1' },
    { id: 'c2', workspaceMemberId: 'm1' },
    { id: 'c3', workspaceMemberId: 'm2' },
  ];

  it('purges when it was the only connection of the member', () => {
    expect(shouldPurgeOnDisconnect(conns, 'c3', 'm2')).toBe(true);
  });

  it('does not purge while the member has another connection', () => {
    expect(shouldPurgeOnDisconnect(conns, 'c1', 'm1')).toBe(false);
  });

  it('does not purge for an unknown member', () => {
    expect(shouldPurgeOnDisconnect(conns, 'c1', null)).toBe(false);
  });

  it('a connection of another member never keeps the cards alive', () => {
    expect(shouldPurgeOnDisconnect([{ id: 'c3', workspaceMemberId: 'm2' }, { id: 'x', workspaceMemberId: 'm9' }], 'c3', 'm2')).toBe(true);
  });
});
