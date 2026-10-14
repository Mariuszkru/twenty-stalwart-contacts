import { defineLogicFunction, HTTPMethod } from 'twenty-sdk/define';
import { Response } from 'twenty-sdk/logic-function';

import { SYNC_NOW_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import { startReconcile } from 'src/lib/start-reconcile';

// Manual sync for the CALLING member only. POST /s/stalwart/sync-now?dryRun=true to preview.
export default defineLogicFunction({
  universalIdentifier: SYNC_NOW_UNIVERSAL_IDENTIFIER,
  name: 'sync-now',
  description: 'Starts a full sync of the calling member.',
  timeoutSeconds: 60,
  httpRouteTriggerSettings: {
    path: '/stalwart/sync-now',
    httpMethod: HTTPMethod.POST,
    isAuthRequired: true,
  },
  handler: async (event: { userWorkspaceId: string | null; queryStringParameters: Record<string, string | undefined> }) => {
    if (!event.userWorkspaceId) return new Response({ error: 'sign in required' }, { status: 401 });

    const result = await startReconcile({
      dryRun: event.queryStringParameters?.dryRun === 'true',
      onlyUserWorkspaceId: event.userWorkspaceId,
    });

    return new Response(result, { status: 200 });
  },
});
