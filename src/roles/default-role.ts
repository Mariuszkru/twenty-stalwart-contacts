import {
  defineApplicationRole,
  STANDARD_OBJECT,
  SystemPermissionFlag,
} from 'twenty-sdk/define';

import {
  APP_DISPLAY_NAME,
  DEFAULT_ROLE_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';

// Least privilege: read Person and Company records, nothing else. The app never writes.
// ROLES is needed only to read roles and field permissions (spike S2/S6); it also allows
// managing roles in Twenty, so the code must stay read-only.
export default defineApplicationRole({
  universalIdentifier: DEFAULT_ROLE_UNIVERSAL_IDENTIFIER,
  label: `${APP_DISPLAY_NAME} default function role`,
  description: `${APP_DISPLAY_NAME} default function role`,
  canReadAllObjectRecords: false,
  canUpdateAllObjectRecords: false,
  canSoftDeleteAllObjectRecords: false,
  canDestroyAllObjectRecords: false,
  objectPermissions: [
    {
      objectUniversalIdentifier: STANDARD_OBJECT.person.universalIdentifier,
      canReadObjectRecords: true,
    },
    {
      objectUniversalIdentifier: STANDARD_OBJECT.company.universalIdentifier,
      canReadObjectRecords: true,
    },
  ],
  permissionFlagUniversalIdentifiers: [SystemPermissionFlag.ROLES],
});
