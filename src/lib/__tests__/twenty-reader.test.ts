import { evaluateEligibility } from 'src/lib/eligibility';
import {
  snapshotsByMember,
  toRoleSnapshot,
  type PersonMetadata,
  type RawRole,
} from 'src/lib/twenty-reader';
import { describe, expect, it } from 'vitest';

const person: PersonMetadata = {
  objectMetadataId: 'obj-person',
  readability: 'OPEN',
  fieldNames: new Map([
    ['f-phones', 'phones'],
    ['f-email', 'emails'],
  ]),
};

const role = (over: Partial<RawRole> = {}): RawRole => ({
  id: 'r1',
  canReadAllObjectRecords: true,
  objectPermissions: [],
  fieldPermissions: [],
  rowLevelPredicates: undefined,
  rowLevelPermissionPredicates: [],
  workspaceMembers: [{ id: 'm1' }],
  ...over,
} as RawRole);

describe('toRoleSnapshot', () => {
  it('maps a plain read-all role', () => {
    expect(toRoleSnapshot(role(), person)).toEqual({
      canReadAllObjectRecords: true,
      objectPermissions: [],
      fieldPermissions: [],
      rowLevelPredicates: [],
    });
  });

  it('keeps only person object permissions', () => {
    const s = toRoleSnapshot(
      role({
        objectPermissions: [
          { objectMetadataId: 'obj-person', canReadObjectRecords: false },
          { objectMetadataId: 'obj-company', canReadObjectRecords: true },
        ],
      }),
      person,
    );
    expect(s?.objectPermissions).toEqual([{ objectName: 'person', canReadObjectRecords: false }]);
  });

  it('resolves hidden field ids to names, ignoring unknown fields and other objects', () => {
    const s = toRoleSnapshot(
      role({
        fieldPermissions: [
          { objectMetadataId: 'obj-person', fieldMetadataId: 'f-phones', canReadFieldValue: false },
          { objectMetadataId: 'obj-person', fieldMetadataId: 'f-unknown', canReadFieldValue: false },
          { objectMetadataId: 'obj-company', fieldMetadataId: 'f-phones', canReadFieldValue: false },
        ],
      }),
      person,
    );
    expect(s?.fieldPermissions).toEqual([
      { objectName: 'person', fieldName: 'phones', canReadFieldValue: false },
    ]);
  });

  it('counts predicates and predicate groups on person only', () => {
    const s = toRoleSnapshot(
      role({
        rowLevelPermissionPredicates: [{ objectMetadataId: 'obj-company' }],
        rowLevelPermissionPredicateGroups: [{ objectMetadataId: 'obj-person' }],
      }),
      person,
    );
    expect(s?.rowLevelPredicates).toEqual([{ objectName: 'person' }]);
  });

  it('leaves fieldPermissions undefined when not returned', () => {
    expect(toRoleSnapshot(role({ fieldPermissions: null }), person)?.fieldPermissions).toBeUndefined();
  });

  it.each([
    ['missing readAll', { canReadAllObjectRecords: undefined }],
    ['missing objectPermissions', { objectPermissions: null }],
    ['missing predicates', { rowLevelPermissionPredicates: null }],
    [
      'non-empty restrictedFields on person',
      { objectPermissions: [{ objectMetadataId: 'obj-person', restrictedFields: { x: 1 } }] },
    ],
  ])('is unresolved (null) for %s', (_n, over) => {
    expect(toRoleSnapshot(role(over as Partial<RawRole>), person)).toBeNull();
  });

  it('accepts empty restrictedFields', () => {
    expect(
      toRoleSnapshot(
        role({ objectPermissions: [{ objectMetadataId: 'obj-person', restrictedFields: {} }] }),
        person,
      ),
    ).not.toBeNull();
  });
});

describe('snapshotsByMember', () => {
  it('maps a member with one role', () => {
    const m = snapshotsByMember([role()], person);
    expect(m.get('m1')).not.toBeNull();
  });

  it('member with two roles is unresolved', () => {
    const m = snapshotsByMember([role({ id: 'a' }), role({ id: 'b' })], person);
    expect(m.get('m1')).toBeNull();
  });

  it('member in no role is absent', () => {
    expect(snapshotsByMember([role({ workspaceMembers: [] })], person).has('m1')).toBe(false);
  });
});

describe('with eligibility', () => {
  const base = { personReadability: 'OPEN', hasStalwartConnection: true };

  it('hidden field flows into the decision', () => {
    const s = toRoleSnapshot(
      role({
        fieldPermissions: [
          { objectMetadataId: 'obj-person', fieldMetadataId: 'f-phones', canReadFieldValue: false },
        ],
      }),
      person,
    );
    expect(evaluateEligibility({ ...base, role: s })).toMatchObject({
      status: 'eligible',
      hiddenFields: ['phones'],
    });
  });

  it('unresolved role clears', () => {
    expect(evaluateEligibility({ ...base, role: null })).toEqual({
      status: 'clear',
      reason: 'role-unresolved',
    });
  });
});
