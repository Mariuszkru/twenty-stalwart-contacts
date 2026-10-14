import { defineLogicFunction } from 'twenty-sdk/define';
import { getConnection } from 'twenty-sdk/logic-function';

import { ON_STALWART_DISCONNECT_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import { removeEntry, shouldPurgeOnDisconnect } from 'src/lib/connection-registry';
import { listAllStalwartConnections, readRegistry, writeRegistry } from 'src/lib/connections';
import { assertHttps, fetchSession, jmapCall } from 'src/lib/jmap';
import { emptyCounts, runMemberStep } from 'src/lib/member-sync';

// Runs right before a Stalwart connection is removed, while its token still works.
// Removing the connection removes the member's synced cards (uid urn:uuid:... only),
// unless the member still has another connection. A failure never blocks the disconnect.
export default defineLogicFunction({
  universalIdentifier: ON_STALWART_DISCONNECT_UNIVERSAL_IDENTIFIER,
  name: 'on-stalwart-disconnect',
  description: 'Removes the member\'s synced cards and the registry entry on disconnect.',
  timeoutSeconds: 60,
  handler: async (payload: { connectedAccountId: string }) => {
    const id = payload.connectedAccountId;
    let purged: string = 'skipped';

    try {
      const c = await getConnection(id).catch(() => null);

      if (c?.workspaceMemberId && shouldPurgeOnDisconnect(await listAllStalwartConnections(), id, c.workspaceMemberId)) {
        const creds = { token: c.accessToken };
        const session = await fetchSession(assertHttps(process.env.STALWART_JMAP_URL), creds);
        const never = async () => {
          throw new Error('not used when clearing');
        };
        const r = await runMemberStep(
          {
            workspaceMemberId: c.workspaceMemberId,
            connectionId: id,
            phase: 'upsert',
            cursor: null,
            dryRun: false,
            purge: true,
            counts: emptyCounts(),
          },
          { status: 'clear', reason: 'purge-requested' },
          {
            call: (calls) => jmapCall(session, creds, calls),
            session,
            bookName: process.env.ADDRESS_BOOK_NAME?.trim() || 'CRM',
            fetchPage: never,
            existingIds: never,
            fetchByIds: never,
          },
        );

        purged = r.counts.failed ? 'partial' : 'purged';
      }
    } catch {
      purged = 'failed';
    } finally {
      await writeRegistry(removeEntry(await readRegistry(), id));
    }

    return { status: 'removed', purged };
  },
});
