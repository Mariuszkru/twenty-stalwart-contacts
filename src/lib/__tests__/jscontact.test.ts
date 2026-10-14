import {
  isManagedUid,
  NO_NAME_LABEL,
  personToCard,
  personUid,
  toPhoneNumber,
  type PersonInput,
} from 'src/lib/jscontact';
import { describe, expect, it } from 'vitest';

const opts = { addressBookId: 'ab1' };
const full: PersonInput = {
  id: '11111111-1111-1111-1111-111111111111',
  name: { firstName: 'Zażółć', lastName: 'Gęślą-Jaźń' },
  emails: { primaryEmail: 'z@example.test' },
  phones: { primaryPhoneNumber: '600 000 000', primaryPhoneCallingCode: '+48' },
  jobTitle: 'CTO',
  linkedinLink: { primaryLinkUrl: 'https://example.test/in/x' },
  company: { name: 'Firma & "Syn" <sp.>' },
  typKontaktu: ['KLIENT'],
  rolaKontaktu: ['WPLYWOWY'],
};

describe('personToCard', () => {
  it('maps a full person', () => {
    const c = personToCard(full, opts) as any;
    expect(c.uid).toBe('urn:uuid:11111111-1111-1111-1111-111111111111');
    expect(c['@type']).toBe('Card');
    expect(c.addressBookIds).toEqual({ ab1: true });
    expect(c.name.full).toBe('Zażółć Gęślą-Jaźń');
    expect(c.name.components.map((x: any) => x.kind)).toEqual(['given', 'surname']);
    expect(c.emails.e1.address).toBe('z@example.test');
    expect(c.phones.p1.number).toBe('+48600000000');
    expect(c.titles.t1.name).toBe('CTO');
    // Stalwart adds kind: 'title' itself; sending it keeps repeated syncs a no-op
    expect(c.titles.t1.kind).toBe('title');
    expect(c.organizations.o1.name).toBe('Firma & "Syn" <sp.>');
    expect(c.links.l1.uri).toBe('https://example.test/in/x');
    expect(c.keywords).toEqual({ Klient: true, 'Wpływowy / Rekomendujący': true });
  });

  it('falls back to email when there is no name', () => {
    const c = personToCard({ id: 'x', emails: { primaryEmail: 'a@example.test' } }, opts) as any;
    expect(c.name.full).toBe('a@example.test');
    expect(c.name.components).toBeUndefined();
  });

  it('falls back to placeholder with no name and no email', () => {
    const c = personToCard({ id: 'x' }, opts) as any;
    expect(c.name.full).toBe(NO_NAME_LABEL);
  });

  it('omits empty collections and blank values', () => {
    const c = personToCard(
      { id: 'x', name: { firstName: ' ', lastName: 'K' }, emails: { primaryEmail: '' }, jobTitle: '  ', typKontaktu: [] },
      opts,
    ) as any;
    expect(c.name.full).toBe('K');
    for (const k of ['emails', 'phones', 'titles', 'organizations', 'links', 'keywords'])
      expect(c).not.toHaveProperty(k);
  });

  it.each([
    ['name', (c: any) => c.name.full, NO_NAME_LABEL],
    ['emails', (c: any) => c.emails, undefined],
    ['phones', (c: any) => c.phones, undefined],
    ['jobTitle', (c: any) => c.titles, undefined],
    ['company', (c: any) => c.organizations, undefined],
    ['linkedinLink', (c: any) => c.links, undefined],
  ])('drops hidden field %s', (field, pick, expected) => {
    const c = personToCard(full, { ...opts, hiddenFields: [field, 'emails'] }) as any;
    expect(pick(c)).toBe(expected);
  });

  it('drops keywords when either option field is hidden', () => {
    const c = personToCard(full, { ...opts, hiddenFields: ['typKontaktu'] }) as any;
    expect(c.keywords).toEqual({ 'Wpływowy / Rekomendujący': true });
    const d = personToCard(full, { ...opts, hiddenFields: ['typKontaktu', 'rolaKontaktu'] }) as any;
    expect(d.keywords).toBeUndefined();
  });

  it('hidden name and email leaves no personal data in the name', () => {
    const c = personToCard(full, { ...opts, hiddenFields: ['name', 'emails'] }) as any;
    expect(JSON.stringify(c.name)).not.toContain('Zażółć');
    expect(JSON.stringify(c.name)).not.toContain('example.test');
  });

  it('does not emit fields outside the mapping table', () => {
    const c = personToCard(
      { ...full, typKlienta: 'B2B', statusRelacji: 'X' } as any,
      opts,
    );
    expect(JSON.stringify(c)).not.toContain('B2B');
  });

  it('is deterministic', () => {
    expect(personToCard(full, opts)).toEqual(personToCard(full, opts));
  });
});

describe('toPhoneNumber', () => {
  it.each([
    ['+48 600-000-000', null, '+48600000000'],
    ['600000000', '+48', '+48600000000'],
    ['0600000000', '48', '+48600000000'],
    ['600000000', null, '600000000'],
    ['', '+48', undefined],
    [null, '+48', undefined],
    ['abc', '+48', undefined],
  ])('%j + %j -> %j', (n, cc, out) => {
    expect(toPhoneNumber(n, cc)).toBe(out);
  });
});

describe('uid helpers', () => {
  it('builds and recognises managed uids', () => {
    expect(personUid('abc')).toBe('urn:uuid:abc');
    expect(isManagedUid('urn:uuid:abc')).toBe(true);
  });

  it.each(['', 'urn:uuid:', 'abc', 'mailto:x', null, undefined, 5])(
    'rejects %j',
    (v) => expect(isManagedUid(v)).toBe(false),
  );
});
