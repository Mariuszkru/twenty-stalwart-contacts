import { defineLogicFunction } from 'twenty-sdk/define';
import { listConnections } from 'twenty-sdk/logic-function';

import { JMAP_SMOKE_TEST_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import { assertHttps, fetchSession, jmapCall } from 'src/lib/jmap';
import {
  applyPlan,
  ensureAddressBook,
  loadBook,
  planSync,
} from 'src/lib/jmap-sync';
import { personToCard, personUid } from 'src/lib/jscontact';

const SMOKE_PERSON_ID = '00000000-0000-4000-8000-0000000000aa';

type Payload = { dryRun?: boolean };

// Uses ONLY a connection owned by the member who runs it, whatever its visibility.
// Never logs names, e-mails or secrets. Dry-run by default.
export default defineLogicFunction({
  universalIdentifier: JMAP_SMOKE_TEST_UNIVERSAL_IDENTIFIER,
  name: 'jmap-smoke-test',
  description: 'Syncs one synthetic card into the CRM book of the calling member.',
  timeoutSeconds: 60,
  handler: async (payload: Payload | undefined, context) => {
    const dryRun = payload?.dryRun !== false;
    const connections = await listConnections({
      providerName: 'stalwart',
      userWorkspaceId: context.userWorkspaceId ?? undefined,
    });
    const connection = context.userWorkspaceId
      ? connections.find((c) => c.userWorkspaceId === context.userWorkspaceId)
      : undefined;

    if (!connection || connection.authFailedAt) {
      return { status: 'unconfigured', hasConnection: !!connection };
    }

    const creds = { token: connection.accessToken };
    const session = await fetchSession(assertHttps(process.env.STALWART_JMAP_URL), creds);
    const call = (calls: unknown[]) => jmapCall(session, creds, calls);
    const bookName = process.env.ADDRESS_BOOK_NAME?.trim() || 'CRM';
    const bookId = await ensureAddressBook(call, session.accountId, bookName, dryRun);

    const existing = bookId ? await loadBook(call, session, bookId) : new Map();
    const desired = new Map([
      [
        personUid(SMOKE_PERSON_ID),
        personToCard(
          { id: SMOKE_PERSON_ID, name: { firstName: 'Smoke', lastName: 'Test' } },
          { addressBookId: bookId ?? 'dry-run' },
        ),
      ],
    ]);
    // pruneMissing=false: the smoke test must never delete other managed cards
    const plan = planSync(desired, existing, false);
    const result = await applyPlan(call, session, plan, dryRun);

    return { status: result.failed ? 'partial' : 'ok', plan: { ...result, unchanged: plan.unchanged } };
  },
});
