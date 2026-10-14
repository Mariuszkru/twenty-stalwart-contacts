import { defineLogicFunction } from 'twenty-sdk/define';

import { SYNC_PERSON_RESTORED_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import { uniqueIds } from 'src/lib/fanout';
import { queuePersonChanges } from 'src/lib/queue-person-changes';

// Fast path for person.restored. The nightly reconcile is the guarantee (PLAN.md 6.E).
export default defineLogicFunction({
  universalIdentifier: SYNC_PERSON_RESTORED_UNIVERSAL_IDENTIFIER,
  name: 'sync-person-restored',
  description: 'Queues member syncs for people that were restored.',
  timeoutSeconds: 60,
  databaseEventTriggerSettings: { eventName: 'person.restored', batchMode: true },
  handler: async (payload: { events?: { recordId?: unknown }[] }) => {
    const ids = uniqueIds(payload?.events ?? []);

    return { op: 'upsert', people: ids.length, ...(await queuePersonChanges('upsert', ids)) };
  },
});
