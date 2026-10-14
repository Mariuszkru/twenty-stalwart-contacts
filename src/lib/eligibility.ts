// Decides whether a workspace member may receive Person cards in Stalwart.
// Pure function: callers fetch the snapshot, this only judges it. Fail closed:
// anything missing or ambiguous resolves to 'clear' or 'halt-all', never 'eligible'.
// See PLAN.md section 5.

export type ObjectPermission = {
  objectName: string;
  // null/undefined = no object-level override, inherit canReadAllObjectRecords
  canReadObjectRecords?: boolean | null;
};

export type FieldPermission = {
  objectName: string;
  fieldName: string;
  canReadFieldValue?: boolean | null;
};

export type RoleSnapshot = {
  canReadAllObjectRecords: boolean;
  objectPermissions: ObjectPermission[];
  // undefined = could not be read (TODO(verify) S6), treated as unknown
  fieldPermissions?: FieldPermission[];
  rowLevelPredicates: { objectName: string }[];
};

export type EligibilityInput = {
  // null = role could not be resolved
  role: RoleSnapshot | null;
  personReadability: string | null | undefined;
  // member owns a usable Stalwart OAuth connection (not auth-failed)
  hasStalwartConnection: boolean;
};

export type EligibilityDecision =
  | { status: 'eligible'; hiddenFields: string[] }
  // member skipped, nothing touched, not an error
  | { status: 'unconfigured' }
  // wipe this member's CRM book
  | {
      status: 'clear';
      reason:
        | 'role-unresolved'
        | 'no-person-access'
        | 'field-permissions-unknown'
        | 'purge-requested';
    }
  // unsupported config: stop sync for everyone, wipe books, surface in health check
  | {
      status: 'halt-all';
      reason: 'readability-not-open' | 'row-level-predicates';
    };

const PERSON = 'person';

export const canReadPerson = (role: RoleSnapshot): boolean => {
  const override = role.objectPermissions.find((p) => p.objectName === PERSON);

  if (override?.canReadObjectRecords === false) return false;
  if (override?.canReadObjectRecords === true) return true;

  return role.canReadAllObjectRecords === true;
};

export const getHiddenPersonFields = (role: RoleSnapshot): string[] =>
  (role.fieldPermissions ?? [])
    .filter((p) => p.objectName === PERSON && p.canReadFieldValue === false)
    .map((p) => p.fieldName);

export const evaluateEligibility = (
  input: EligibilityInput,
): EligibilityDecision => {
  // Global conditions first: they stop everyone, regardless of this member.
  if (input.personReadability !== 'OPEN') {
    return { status: 'halt-all', reason: 'readability-not-open' };
  }

  if (!input.role) {
    return { status: 'clear', reason: 'role-unresolved' };
  }

  if (input.role.rowLevelPredicates.some((p) => p.objectName === PERSON)) {
    return { status: 'halt-all', reason: 'row-level-predicates' };
  }

  if (!canReadPerson(input.role)) {
    return { status: 'clear', reason: 'no-person-access' };
  }

  if (input.role.fieldPermissions === undefined) {
    return { status: 'clear', reason: 'field-permissions-unknown' };
  }

  if (!input.hasStalwartConnection) {
    return { status: 'unconfigured' };
  }

  return {
    status: 'eligible',
    hiddenFields: getHiddenPersonFields(input.role),
  };
};
