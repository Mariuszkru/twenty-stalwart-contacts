// Sync health summary kept in kv for the health check. Ids and reasons only, no PII.

export type HealthState = {
  halted: string | null; // reason sync is stopped for everyone, or null
  authErrors: string[]; // member ids whose Stalwart auth failed
  sharedConnections: string[]; // member ids whose connection is workspace-shared (refused)
  lastReconcileAt: string | null;
};

export const HEALTH_KEY = 'sync:health';

export const emptyHealth = (): HealthState => ({
  halted: null,
  authErrors: [],
  sharedConnections: [],
  lastReconcileAt: null,
});

export type Outcome =
  | { kind: 'halted'; reason: string }
  | { kind: 'auth-error' }
  | { kind: 'shared-connection' } // connection is not private; the app refuses it
  | { kind: 'ok' } // member synced fine (also proves config is supported again)
  | { kind: 'neutral' }; // skipped / cleared / in progress: no change

export const applyOutcome = (
  state: HealthState,
  memberId: string,
  outcome: Outcome,
  now: string,
): HealthState => {
  const authErrors = state.authErrors.filter((id) => id !== memberId);
  const shared = state.sharedConnections.filter((id) => id !== memberId);

  switch (outcome.kind) {
    case 'halted':
      return { ...state, halted: outcome.reason, authErrors, sharedConnections: shared };
    case 'auth-error':
      return { ...state, authErrors: [...authErrors, memberId], sharedConnections: shared };
    case 'shared-connection':
      return { ...state, authErrors, sharedConnections: [...shared, memberId] };
    case 'ok':
      return { ...state, halted: null, authErrors, sharedConnections: shared, lastReconcileAt: now };
    default:
      return state;
  }
};
