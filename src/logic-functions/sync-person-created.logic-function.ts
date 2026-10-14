import { defineLogicFunction } from 'twenty-sdk/define';

import { SYNC_PERSON_CREATED_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import { uniqueIds } from 'src/lib/fanout';
import { queuePersonChanges } from 'src/lib/queue-person-changes';

// Fast path for person.created. The nightly reconcile is the guarantee (PLAN.md 6.E).
export default defineLogicFunction({
  universalIdentifier: SYNC_PERSON_CREATED_UNIVERSAL_IDENTIFIER,
  name: 'sync-person-created',
  description: 'Queues member syncs for people that were created.',
  timeoutSeconds: 60,
  databaseEventTriggerSettings: { eventName: 'person.created', batchMode: true },
  handler: async (payload: { events?: { recordId?: unknown }[] }) => {
    const ids = uniqueIds(payload?.events ?? []);

    return { op: 'upsert', people: ids.length, ...(await queuePersonChanges('upsert', ids)) };
  },
});
