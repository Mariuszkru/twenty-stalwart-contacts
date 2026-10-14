import { defineConnectionProvider } from 'twenty-sdk/define';

import {
  ON_STALWART_CONNECT_UNIVERSAL_IDENTIFIER,
  ON_STALWART_DISCONNECT_UNIVERSAL_IDENTIFIER,
  STALWART_CONNECTION_PROVIDER_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';

// Per-member OAuth connection to Stalwart. Scope is limited to contacts, so the
// token cannot read mail. Endpoints come from https://mail.recoop.pl/.well-known/oauth-authorization-server
// (provider endpoints cannot read variables, so the host is fixed here).
// TODO(verify S10): Stalwart accepts this token as Bearer on /jmap.
export default defineConnectionProvider({
  universalIdentifier: STALWART_CONNECTION_PROVIDER_UNIVERSAL_IDENTIFIER,
  name: 'stalwart',
  displayName: 'Stalwart Contacts',
  type: 'oauth',
  oauth: {
    authorizationEndpoint: 'https://mail.recoop.pl/login',
    tokenEndpoint: 'https://mail.recoop.pl/auth/token',
    scopes: ['urn:ietf:params:oauth:scope:contacts', 'offline_access'],
    clientIdVariable: 'STALWART_OAUTH_CLIENT_ID',
    clientSecretVariable: 'STALWART_OAUTH_CLIENT_SECRET',
    tokenRequestContentType: 'form-urlencoded',
    usePkce: true,
  },
  // Keep a registry of connection ids: private connections are invisible to cron/events.
  onConnectLogicFunction: { universalIdentifier: ON_STALWART_CONNECT_UNIVERSAL_IDENTIFIER },
  onDisconnectLogicFunction: { universalIdentifier: ON_STALWART_DISCONNECT_UNIVERSAL_IDENTIFIER },
});
