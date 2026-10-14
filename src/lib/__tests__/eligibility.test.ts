import {
  evaluateEligibility,
  type EligibilityInput,
  type RoleSnapshot,
} from 'src/lib/eligibility';
import { describe, expect, it } from 'vitest';

const role = (over: Partial<RoleSnapshot> = {}): RoleSnapshot => ({
  canReadAllObjectRecords: true,
  objectPermissions: [],
  fieldPermissions: [],
  rowLevelPredicates: [],
  ...over,
});

const base = (over: Partial<EligibilityInput> = {}): EligibilityInput => ({
  role: role(),
  personReadability: 'OPEN',
  hasStalwartConnection: true,
  ...over,
});

describe('evaluateEligibility', () => {
  it('is eligible when every condition holds', () => {
    expect(evaluateEligibility(base())).toEqual({
      status: 'eligible',
      hiddenFields: [],
    });
  });

  describe('readability (global)', () => {
    it.each(['RESTRICTED', 'PRIVATE', '', null, undefined])(
      'halts all when readability is %j',
      (readability) => {
        expect(
          evaluateEligibility(base({ personReadability: readability })),
        ).toEqual({ status: 'halt-all', reason: 'readability-not-open' });
      },
    );
  });

  describe('row-level predicates (global)', () => {
    it('halts all when role has a person predicate', () => {
      expect(
        evaluateEligibility(
          base({
            role: role({ rowLevelPredicates: [{ objectName: 'person' }] }),
          }),
        ),
      ).toEqual({ status: 'halt-all', reason: 'row-level-predicates' });
    });

    it('ignores predicates on other objects', () => {
      expect(
        evaluateEligibility(
          base({
            role: role({ rowLevelPredicates: [{ objectName: 'company' }] }),
          }),
        ).status,
      ).toBe('eligible');
    });
  });

  describe('read access to person', () => {
    it('clears when role cannot read all and has no override', () => {
      expect(
        evaluateEligibility(
          base({ role: role({ canReadAllObjectRecords: false }) }),
        ),
      ).toEqual({ status: 'clear', reason: 'no-person-access' });
    });

    it('is eligible via object override true without read-all', () => {
      expect(
        evaluateEligibility(
          base({
            role: role({
              canReadAllObjectRecords: false,
              objectPermissions: [
                { objectName: 'person', canReadObjectRecords: true },
              ],
            }),
          }),
        ).status,
      ).toBe('eligible');
    });

    it('override false wins over read-all', () => {
      expect(
        evaluateEligibility(
          base({
            role: role({
              canReadAllObjectRecords: true,
              objectPermissions: [
                { objectName: 'person', canReadObjectRecords: false },
              ],
            }),
          }),
        ),
      ).toEqual({ status: 'clear', reason: 'no-person-access' });
    });

    it('null override inherits read-all', () => {
      expect(
        evaluateEligibility(
          base({
            role: role({
              objectPermissions: [
                { objectName: 'person', canReadObjectRecords: null },
              ],
            }),
          }),
        ).status,
      ).toBe('eligible');
    });

    it('override on another object does not grant access', () => {
      expect(
        evaluateEligibility(
          base({
            role: role({
              canReadAllObjectRecords: false,
              objectPermissions: [
                { objectName: 'company', canReadObjectRecords: true },
              ],
            }),
          }),
        ),
      ).toEqual({ status: 'clear', reason: 'no-person-access' });
    });
  });

  describe('fail closed', () => {
    it('clears when role is unresolved', () => {
      expect(evaluateEligibility(base({ role: null }))).toEqual({
        status: 'clear',
        reason: 'role-unresolved',
      });
    });

    it('clears when field permissions are unknown', () => {
      expect(
        evaluateEligibility(
          base({ role: role({ fieldPermissions: undefined }) }),
        ),
      ).toEqual({ status: 'clear', reason: 'field-permissions-unknown' });
    });

    it('unresolved role and bad readability: halt-all wins', () => {
      expect(
        evaluateEligibility(base({ role: null, personReadability: null })),
      ).toEqual({ status: 'halt-all', reason: 'readability-not-open' });
    });
  });

  describe('connection', () => {
    it('is unconfigured without a Stalwart connection', () => {
      expect(evaluateEligibility(base({ hasStalwartConnection: false }))).toEqual({
        status: 'unconfigured',
      });
    });

    it('no access outranks a missing connection', () => {
      expect(
        evaluateEligibility(
          base({ role: role({ canReadAllObjectRecords: false }), hasStalwartConnection: false }),
        ).status,
      ).toBe('clear');
    });
  });

  describe('field permissions', () => {
    it('lists only hidden person fields', () => {
      const d = evaluateEligibility(
        base({
          role: role({
            fieldPermissions: [
              { objectName: 'person', fieldName: 'phones', canReadFieldValue: false },
              { objectName: 'person', fieldName: 'jobTitle', canReadFieldValue: true },
              { objectName: 'person', fieldName: 'emails', canReadFieldValue: null },
              { objectName: 'company', fieldName: 'name', canReadFieldValue: false },
            ],
          }),
        }),
      );
      expect(d).toMatchObject({ status: 'eligible', hiddenFields: ['phones'] });
    });
  });
});
