import { defineLogicFunction } from 'twenty-sdk/define';

import { SYNC_PERSON_DESTROYED_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import { uniqueIds } from 'src/lib/fanout';
import { queuePersonChanges } from 'src/lib/queue-person-changes';

// Fast path for person.destroyed. The nightly reconcile is the guarantee (PLAN.md 6.E).
export default defineLogicFunction({
  universalIdentifier: SYNC_PERSON_DESTROYED_UNIVERSAL_IDENTIFIER,
  name: 'sync-person-destroyed',
  description: 'Queues member syncs for people that were destroyed.',
  timeoutSeconds: 60,
  databaseEventTriggerSettings: { eventName: 'person.destroyed', batchMode: true },
  handler: async (payload: { events?: { recordId?: unknown }[] }) => {
    const ids = uniqueIds(payload?.events ?? []);

    return { op: 'delete', people: ids.length, ...(await queuePersonChanges('delete', ids)) };
  },
});
