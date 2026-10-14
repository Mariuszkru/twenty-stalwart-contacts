import { defineHealthCheck } from 'twenty-sdk/define';

import { HEALTH_CHECK_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import { assertHttps } from 'src/lib/jmap';

// Workspace-level only: per-member credentials are not visible here.
export default defineHealthCheck({
  universalIdentifier: HEALTH_CHECK_UNIVERSAL_IDENTIFIER,
  name: 'health-check',
  handler: async () => {
    try {
      const url = assertHttps(process.env.STALWART_JMAP_URL);
      const res = await fetch(new URL('/.well-known/jmap', url), {
        redirect: 'manual',
      });

      // 401/307 both prove the server answers; only 5xx is a server problem
      if (res.status >= 500) {
        return {
          status: 'ERROR',
          title: 'Stalwart is not responding',
          description: `HTTP ${res.status}`,
        } as const;
      }

      return { status: 'OK' } as const;
    } catch (e) {
      return {
        status: 'ERROR',
        title: 'Stalwart configuration problem',
        description: e instanceof Error ? e.message : 'unknown error',
      } as const;
    }
  },
});
