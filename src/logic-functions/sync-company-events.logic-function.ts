import { defineLogicFunction } from 'twenty-sdk/define';

import { SYNC_COMPANY_UPDATED_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import { uniqueIds } from 'src/lib/fanout';
import { queuePersonChanges } from 'src/lib/queue-person-changes';
import { fetchPersonIdsByCompanyIds } from 'src/lib/twenty-people';

// A company rename changes `organizations` on the cards of its people.
export default defineLogicFunction({
  universalIdentifier: SYNC_COMPANY_UPDATED_UNIVERSAL_IDENTIFIER,
  name: 'sync-company-events',
  description: 'Queues member syncs for the people of renamed companies.',
  timeoutSeconds: 120,
  databaseEventTriggerSettings: {
    eventName: 'company.updated',
    updatedFields: ['name'],
    batchMode: true,
  },
  handler: async (payload: { events?: { recordId?: unknown }[] }) => {
    const people = await fetchPersonIdsByCompanyIds(uniqueIds(payload?.events ?? []));

    return { people: people.length, ...(await queuePersonChanges('upsert', people)) };
  },
});
