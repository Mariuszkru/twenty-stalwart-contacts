import { defineLogicFunction } from 'twenty-sdk/define';
import { getConnection } from 'twenty-sdk/logic-function';

import { ON_STALWART_CONNECT_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import { recordOutcome } from 'src/lib/health-store';
import { addEntry } from 'src/lib/connection-registry';
import { readRegistry, writeRegistry } from 'src/lib/connections';

// Runs right after a member adds a Stalwart connection. Records id and owner only.
export default defineLogicFunction({
  universalIdentifier: ON_STALWART_CONNECT_UNIVERSAL_IDENTIFIER,
  name: 'on-stalwart-connect',
  description: 'Registers a new Stalwart connection id (no token stored).',
  timeoutSeconds: 30,
  handler: async (payload: { connectedAccountId: string }) => {
    const c = await getConnection(payload.connectedAccountId);

    // Shared connections are refused (see sync-member); do not register them.
    if (c.visibility !== 'user') {
      if (c.workspaceMemberId) await recordOutcome(c.workspaceMemberId, { kind: 'shared-connection' });

      return { status: 'ignored', visibility: c.visibility };
    }

    await writeRegistry(
      addEntry(await readRegistry(), {
        id: c.id,
        workspaceMemberId: c.workspaceMemberId,
        userWorkspaceId: c.userWorkspaceId,
      }),
    );

    return { status: 'registered', visibility: c.visibility };
  },
});
