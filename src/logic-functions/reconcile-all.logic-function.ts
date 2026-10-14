import { defineLogicFunction } from 'twenty-sdk/define';

import { RECONCILE_ALL_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import { startReconcile } from 'src/lib/start-reconcile';

type Payload = { dryRun?: boolean };

// Manual full reconcile for every member with a Stalwart connection. Dry-run by default.
export default defineLogicFunction({
  universalIdentifier: RECONCILE_ALL_UNIVERSAL_IDENTIFIER,
  name: 'reconcile-all',
  description: 'Queues a full sync for every member with a Stalwart connection.',
  timeoutSeconds: 120,
  handler: async (payload: Payload | undefined) =>
    startReconcile({ dryRun: payload?.dryRun !== false }),
});
