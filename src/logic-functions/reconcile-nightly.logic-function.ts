import { defineLogicFunction } from 'twenty-sdk/define';

import { RECONCILE_NIGHTLY_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import { startReconcile } from 'src/lib/start-reconcile';

// Nightly full reconcile: the guarantee behind the event fast path (PLAN.md 6.B, 6.E).
export default defineLogicFunction({
  universalIdentifier: RECONCILE_NIGHTLY_UNIVERSAL_IDENTIFIER,
  name: 'reconcile-nightly',
  description: 'Nightly full sync for every member with a Stalwart connection.',
  timeoutSeconds: 120,
  cronTriggerSettings: { pattern: '0 2 * * *' },
  handler: async () => startReconcile({ dryRun: false }),
});
