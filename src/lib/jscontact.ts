// Person -> JSContact Card (RFC 9553) mapping. PLAN.md section 7.
// Pure and synthetic-data testable. Only fields listed in the mapping table are read.
// Nested objects carry no `@type`: S3 showed Stalwart then emits a clean vCard 3.0,
// while nested `@type` adds JSPROP noise lines.

import { optionLabels } from 'src/lib/labels';

// TODO(verify): composite field names below come from PLAN.md, not from the
// generated CoreApiClient types. Confirm after `yarn twenty dev:generate-client`.
export type PersonInput = {
  id: string;
  name?: { firstName?: string | null; lastName?: string | null } | null;
  emails?: { primaryEmail?: string | null } | null;
  phones?: {
    primaryPhoneNumber?: string | null;
    primaryPhoneCallingCode?: string | null;
  } | null;
  jobTitle?: string | null;
  linkedinLink?: { primaryLinkUrl?: string | null } | null;
  company?: { name?: string | null } | null;
  typKontaktu?: string[] | null;
  rolaKontaktu?: string[] | null;
};

export type CardOptions = {
  addressBookId: string;
  // person fields the member's role cannot read (canReadFieldValue: false)
  hiddenFields?: readonly string[];
};

export type JsContactCard = Record<string, unknown>;

export const UID_PREFIX = 'urn:uuid:';
export const NO_NAME_LABEL = '(bez nazwy)';

export const personUid = (personId: string): string => `${UID_PREFIX}${personId}`;

export const isManagedUid = (uid: unknown): uid is string =>
  typeof uid === 'string' && uid.startsWith(UID_PREFIX) && uid.length > UID_PREFIX.length;

const clean = (v: string | null | undefined): string | undefined => {
  const t = v?.trim();

  return t ? t : undefined;
};

// E.164 when possible, otherwise the number as entered.
export const toPhoneNumber = (
  number: string | null | undefined,
  callingCode: string | null | undefined,
): string | undefined => {
  const raw = clean(number);

  if (!raw) return undefined;

  const digits = raw.replace(/\D/g, '');

  if (!digits) return undefined;
  if (raw.startsWith('+')) return `+${digits}`;

  const cc = clean(callingCode)?.replace(/\D/g, '');

  if (cc) return `+${cc}${digits.replace(/^0+/, '')}`;

  return raw;
};

export const personToCard = (
  person: PersonInput,
  { addressBookId, hiddenFields = [] }: CardOptions,
): JsContactCard => {
  const hidden = new Set(hiddenFields);
  const visible = <T>(field: string, value: T): T | undefined =>
    hidden.has(field) ? undefined : value;

  const given = clean(visible('name', person.name?.firstName));
  const surname = clean(visible('name', person.name?.lastName));
  const email = clean(visible('emails', person.emails?.primaryEmail));
  const phone = visible('phones', toPhoneNumber(
    person.phones?.primaryPhoneNumber,
    person.phones?.primaryPhoneCallingCode,
  ));
  const title = clean(visible('jobTitle', person.jobTitle));
  const org = clean(visible('company', person.company?.name));
  const link = clean(visible('linkedinLink', person.linkedinLink?.primaryLinkUrl));

  const fullName = [given, surname].filter(Boolean).join(' ');
  const components = [
    given && { kind: 'given', value: given },
    surname && { kind: 'surname', value: surname },
  ].filter(Boolean);

  const keywordLabels = [
    ...optionLabels('typKontaktu', visible('typKontaktu', person.typKontaktu)),
    ...optionLabels('rolaKontaktu', visible('rolaKontaktu', person.rolaKontaktu)),
  ];

  const card: JsContactCard = {
    '@type': 'Card',
    version: '1.0',
    kind: 'individual',
    uid: personUid(person.id),
    addressBookIds: { [addressBookId]: true },
    name: {
      
      full: fullName || email || NO_NAME_LABEL,
      ...(components.length ? { components, isOrdered: true } : {}),
    },
  };

  if (email) card.emails = { e1: { address: email, pref: 1 } };
  if (phone) card.phones = { p1: { number: phone } };
  if (title) card.titles = { t1: { name: title, kind: 'title' } };
  if (org) card.organizations = { o1: { name: org } };
    if (link) card.links = { l1: { uri: link } };
  if (keywordLabels.length) {
    card.keywords = Object.fromEntries(keywordLabels.map((k) => [k, true]));
  }

  return card;
};
