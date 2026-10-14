import { applyOutcome, emptyHealth } from 'src/lib/health-state';
import { describe, expect, it } from 'vitest';

const NOW = '2026-10-14T20:00:00.000Z';

describe('applyOutcome', () => {
  it('halted sets the reason', () => {
    expect(applyOutcome(emptyHealth(), 'm1', { kind: 'halted', reason: 'row-level-predicates' }, NOW).halted).toBe('row-level-predicates');
  });

  it('auth-error adds the member once', () => {
    const a = applyOutcome(emptyHealth(), 'm1', { kind: 'auth-error' }, NOW);
    const b = applyOutcome(a, 'm1', { kind: 'auth-error' }, NOW);
    expect(b.authErrors).toEqual(['m1']);
  });

  it('ok clears halt and that member auth error, records time', () => {
    const s = { halted: 'x', authErrors: ['m1', 'm2'], sharedConnections: ['m1'], lastReconcileAt: null };
    expect(applyOutcome(s, 'm1', { kind: 'ok' }, NOW)).toEqual({
      halted: null,
      authErrors: ['m2'],
      sharedConnections: [],
      lastReconcileAt: NOW,
    });
  });

  it('shared-connection is recorded once and cleared by ok', () => {
    const a = applyOutcome(emptyHealth(), 'm1', { kind: 'shared-connection' }, NOW);
    const b = applyOutcome(a, 'm1', { kind: 'shared-connection' }, NOW);
    expect(b.sharedConnections).toEqual(['m1']);
    expect(applyOutcome(b, 'm1', { kind: 'ok' }, NOW).sharedConnections).toEqual([]);
  });

  it('neutral changes nothing', () => {
    const s = { halted: 'x', authErrors: ['m1'], sharedConnections: [], lastReconcileAt: null };
    expect(applyOutcome(s, 'm1', { kind: 'neutral' }, NOW)).toBe(s);
  });

  it('does not mutate the input state', () => {
    const s = emptyHealth();
    applyOutcome(s, 'm1', { kind: 'auth-error' }, NOW);
    expect(s.authErrors).toEqual([]);
  });
});
