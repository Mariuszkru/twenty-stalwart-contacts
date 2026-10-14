import { defineLogicFunction } from 'twenty-sdk/define';

import { evaluateEligibility } from 'src/lib/eligibility';
import { fetchPersonMetadata, fetchRoles } from 'src/lib/twenty-metadata';
import { snapshotsByMember } from 'src/lib/twenty-reader';
import { existingPersonIds, fetchPeoplePage } from 'src/lib/twenty-people';

// TEMPORARY spike: runs the whole eligibility chain with a fake password.
// Returns decisions and counts only, no personal data.
export default defineLogicFunction({
  universalIdentifier: 'a2ceb69a-b9e5-47cd-b5ba-82bfafc550c1',
  name: 'spike-roles',
  description: 'Spike: role snapshot -> eligibility decisions.',
  timeoutSeconds: 30,
  handler: async () => {
    const person = await fetchPersonMetadata();

    if (!person) return { error: 'person object not found' };

    const snapshots = snapshotsByMember(await fetchRoles(), person);

    const page = await fetchPeoplePage(null, 3);
    const ids = page.people.map((p) => p.id);
    const exists = await existingPersonIds([...ids, '00000000-0000-4000-8000-000000000000']);

    return {
      page: {
        count: page.people.length,
        hasNextPage: page.hasNextPage,
        hasCursor: !!page.endCursor,
        shape: Object.keys(page.people[0] ?? {}),
        existsCount: exists.size,
        fakeIdFound: exists.has('00000000-0000-4000-8000-000000000000'),
      },
      readability: person.readability,
      members: [...snapshots].map(([id, role]) => ({
        id,
        decision: evaluateEligibility({
          role,
          personReadability: person.readability,
          hasStalwartConnection: true,
        }),
      })),
    };
  },
});
