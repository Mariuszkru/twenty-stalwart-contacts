import { defineLogicFunction } from 'twenty-sdk/define';

import { ON_STALWART_DISCONNECT_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import { removeEntry } from 'src/lib/connection-registry';
import { readRegistry, writeRegistry } from 'src/lib/connections';

// Runs right before a Stalwart connection is removed.
export default defineLogicFunction({
  universalIdentifier: ON_STALWART_DISCONNECT_UNIVERSAL_IDENTIFIER,
  name: 'on-stalwart-disconnect',
  description: 'Removes a Stalwart connection id from the registry.',
  timeoutSeconds: 30,
  handler: async (payload: { connectedAccountId: string }) => {
    await writeRegistry(removeEntry(await readRegistry(), payload.connectedAccountId));

    return { status: 'removed' };
  },
});
