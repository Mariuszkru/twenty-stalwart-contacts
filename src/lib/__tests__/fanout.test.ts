import { buildMemberJobs, EVENT_BATCH, uniqueIds } from 'src/lib/fanout';
import { describe, expect, it } from 'vitest';

const conn = (id: string, member: string | null, failed: string | null = null) => ({
  id,
  workspaceMemberId: member,
  authFailedAt: failed,
});

describe('uniqueIds', () => {
  it('dedupes and drops invalid record ids', () => {
    expect(uniqueIds([{ recordId: 'a' }, { recordId: 'a' }, { recordId: '' }, {}, { recordId: 5 }, { recordId: 'b' }])).toEqual(['a', 'b']);
  });
});

describe('buildMemberJobs', () => {
  it('one job per usable member, skipping left members and failed auth', () => {
    const jobs = buildMemberJobs([conn('c1', 'm1'), conn('c2', null), conn('c3', 'm3', '2026-01-01')], 'upsert', ['p1']);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ workspaceMemberId: 'm1', connectionId: 'c1', phase: 'ids', op: 'upsert', personIds: ['p1'] });
  });

  it('splits more than a batch of ids into several jobs per member', () => {
    const ids = Array.from({ length: EVENT_BATCH + 5 }, (_, i) => `p${i}`);
    const jobs = buildMemberJobs([conn('c1', 'm1')], 'delete', ids);
    expect(jobs.map((j) => j.personIds!.length)).toEqual([EVENT_BATCH, 5]);
    expect(jobs.every((j) => j.op === 'delete')).toBe(true);
  });

  it('never mixes a connection with another member', () => {
    const jobs = buildMemberJobs([conn('c1', 'm1'), conn('c2', 'm2')], 'upsert', ['p']);
    expect(jobs.map((j) => [j.workspaceMemberId, j.connectionId])).toEqual([['m1', 'c1'], ['m2', 'c2']]);
  });

  it('no people or no members means no jobs', () => {
    expect(buildMemberJobs([conn('c1', 'm1')], 'upsert', [])).toEqual([]);
    expect(buildMemberJobs([], 'upsert', ['p'])).toEqual([]);
  });
});
