import { defineLogicFunction, HTTPMethod } from 'twenty-sdk/define';
import { Response } from 'twenty-sdk/logic-function';

import { PURGE_MY_CARDS_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import { startReconcile } from 'src/lib/start-reconcile';

// Removes the synced cards (uid urn:uuid:...) from the CALLING member's CRM book.
// Preview by default; add ?confirm=true to delete. Other cards are never touched.
// Uninstalling the app does NOT remove cards on its own; use this first if you want that.
export default defineLogicFunction({
  universalIdentifier: PURGE_MY_CARDS_UNIVERSAL_IDENTIFIER,
  name: 'purge-my-cards',
  description: 'Removes all synced cards from the calling member\'s CRM book.',
  timeoutSeconds: 60,
  httpRouteTriggerSettings: {
    path: '/stalwart/purge',
    httpMethod: HTTPMethod.POST,
    isAuthRequired: true,
  },
  handler: async (event: { userWorkspaceId: string | null; queryStringParameters: Record<string, string | undefined> }) => {
    if (!event.userWorkspaceId) return new Response({ error: 'sign in required' }, { status: 401 });

    const result = await startReconcile({
      dryRun: event.queryStringParameters?.confirm !== 'true',
      onlyUserWorkspaceId: event.userWorkspaceId,
      purge: true,
    });

    return new Response(result, { status: 200 });
  },
});
