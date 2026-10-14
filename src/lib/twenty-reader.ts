// Turns raw Twenty Metadata API data into the snapshots eligibility.ts judges.
// Pure part only (no I/O); fetching lives in the logic functions.
// Anything unreadable or unexpected resolves to null (role unresolved => fail closed).

import type { RoleSnapshot } from 'src/lib/eligibility';

export type RawRole = {
  id: string;
  canReadAllObjectRecords?: boolean | null;
  objectPermissions?:
    | {
        objectMetadataId: string;
        canReadObjectRecords?: boolean | null;
        restrictedFields?: unknown;
      }[]
    | null;
  fieldPermissions?:
    | {
        objectMetadataId: string;
        fieldMetadataId: string;
        canReadFieldValue?: boolean | null;
      }[]
    | null;
  rowLevelPermissionPredicates?: { objectMetadataId: string }[] | null;
  rowLevelPermissionPredicateGroups?: { objectMetadataId: string }[] | null;
  workspaceMembers?: { id: string }[] | null;
};

export type PersonMetadata = {
  objectMetadataId: string;
  readability: string | null | undefined;
  // person field id -> field name
  fieldNames: ReadonlyMap<string, string>;
};

const isEmptyRestriction = (v: unknown): boolean =>
  v == null ||
  (Array.isArray(v) && v.length === 0) ||
  (typeof v === 'object' && !Array.isArray(v) && Object.keys(v as object).length === 0);

export const toRoleSnapshot = (
  role: RawRole,
  person: PersonMetadata,
): RoleSnapshot | null => {
  if (
    typeof role.canReadAllObjectRecords !== 'boolean' ||
    !role.objectPermissions ||
    !role.rowLevelPermissionPredicates
  ) {
    return null;
  }

  const personPerms = role.objectPermissions.filter(
    (p) => p.objectMetadataId === person.objectMetadataId,
  );

  // TODO(verify): restrictedFields format. Non-empty on person is not understood => unresolved.
  if (personPerms.some((p) => !isEmptyRestriction(p.restrictedFields))) {
    return null;
  }

  const predicates = [
    ...role.rowLevelPermissionPredicates,
    ...(role.rowLevelPermissionPredicateGroups ?? []),
  ].filter((p) => p.objectMetadataId === person.objectMetadataId);

  return {
    canReadAllObjectRecords: role.canReadAllObjectRecords,
    objectPermissions: personPerms.map((p) => ({
      objectName: 'person',
      canReadObjectRecords: p.canReadObjectRecords ?? null,
    })),
    fieldPermissions: role.fieldPermissions
      ? role.fieldPermissions
          .filter((p) => p.objectMetadataId === person.objectMetadataId)
          .flatMap((p) => {
            const fieldName = person.fieldNames.get(p.fieldMetadataId);

            // A permission on a field we cannot name cannot affect mapped fields.
            return fieldName
              ? [
                  {
                    objectName: 'person',
                    fieldName,
                    canReadFieldValue: p.canReadFieldValue ?? null,
                  },
                ]
              : [];
          })
      : undefined,
    rowLevelPredicates: predicates.map(() => ({ objectName: 'person' })),
  };
};

// member id -> snapshot. Members with zero or several roles are unresolved (null).
export const snapshotsByMember = (
  roles: readonly RawRole[],
  person: PersonMetadata,
): Map<string, RoleSnapshot | null> => {
  const rolesOfMember = new Map<string, RawRole[]>();

  for (const role of roles) {
    for (const m of role.workspaceMembers ?? []) {
      rolesOfMember.set(m.id, [...(rolesOfMember.get(m.id) ?? []), role]);
    }
  }

  return new Map(
    [...rolesOfMember].map(([memberId, rs]) => [
      memberId,
      rs.length === 1 ? toRoleSnapshot(rs[0], person) : null,
    ]),
  );
};

// A person-level row predicate on ANY role is an unsupported config: stop sync for everyone.
export const anyRoleHasPersonPredicates = (
  roles: readonly RawRole[],
  person: PersonMetadata,
): boolean =>
  roles.some((r) =>
    [
      ...(r.rowLevelPermissionPredicates ?? []),
      ...(r.rowLevelPermissionPredicateGroups ?? []),
    ].some((p) => p.objectMetadataId === person.objectMetadataId),
  );
