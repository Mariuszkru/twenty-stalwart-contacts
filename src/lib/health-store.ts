import { kv } from 'twenty-sdk/logic-function';

import {
  applyOutcome,
  emptyHealth,
  HEALTH_KEY,
  type HealthState,
  type Outcome,
} from 'src/lib/health-state';

export const readHealth = async (): Promise<HealthState> =>
  (await kv.get<HealthState>(HEALTH_KEY)) ?? emptyHealth();

// Read-modify-write; low volume (one write per finished member chain), races are tolerable.
export const recordOutcome = async (memberId: string, outcome: Outcome): Promise<void> => {
  const next = applyOutcome(await readHealth(), memberId, outcome, new Date().toISOString());

  await kv.set(HEALTH_KEY, next);
};
