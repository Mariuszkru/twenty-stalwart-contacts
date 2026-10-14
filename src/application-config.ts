import { defineApplication } from 'twenty-sdk/define';

import {
  APP_DESCRIPTION,
  APP_DISPLAY_NAME,
  APPLICATION_UNIVERSAL_IDENTIFIER,
  VAR_ADDRESS_BOOK_NAME_ID,
  VAR_STALWART_APP_PASSWORD_ID,
  VAR_STALWART_JMAP_URL_ID,
  VAR_STALWART_LOGIN_ID,
  VAR_SYNC_ENABLED_ID,
} from 'src/constants/universal-identifiers';

export default defineApplication({
  universalIdentifier: APPLICATION_UNIVERSAL_IDENTIFIER,
  displayName: APP_DISPLAY_NAME,
  description: APP_DESCRIPTION,
  // OAuth client of the Stalwart server, filled in once by the Twenty server admin.
  serverVariables: {
    STALWART_OAUTH_CLIENT_ID: {
      description: 'OAuth client id registered in Stalwart.',
      isSecret: false,
      isRequired: true,
    },
    STALWART_OAUTH_CLIENT_SECRET: {
      description: 'OAuth client secret registered in Stalwart.',
      isSecret: true,
      isRequired: true,
    },
  },
  applicationVariables: {
    STALWART_JMAP_URL: {
      universalIdentifier: VAR_STALWART_JMAP_URL_ID,
      label: 'Stalwart URL',
      description: 'Base URL of the Stalwart server. Must use https.',
      scope: 'WORKSPACE',
      isSecret: false,
      isRequired: true,
      value: 'https://mail.recoop.pl',
    },
    ADDRESS_BOOK_NAME: {
      universalIdentifier: VAR_ADDRESS_BOOK_NAME_ID,
      label: 'Address book name',
      scope: 'WORKSPACE',
      isSecret: false,
      value: 'CRM',
    },
    SYNC_ENABLED: {
      universalIdentifier: VAR_SYNC_ENABLED_ID,
      label: 'Sync enabled',
      description: 'Emergency switch for all synchronization.',
      scope: 'WORKSPACE',
      isSecret: false,
      value: 'true',
    },
    STALWART_LOGIN: {
      universalIdentifier: VAR_STALWART_LOGIN_ID,
      label: 'Stalwart login',
      description: 'Optional. Defaults to your Twenty e-mail.',
      scope: 'USER',
      isSecret: false,
    },
    STALWART_APP_PASSWORD: {
      universalIdentifier: VAR_STALWART_APP_PASSWORD_ID,
      label: 'Stalwart app password',
      description: 'App password of your own Stalwart account.',
      scope: 'USER',
      isSecret: true,
    },
  },
});
