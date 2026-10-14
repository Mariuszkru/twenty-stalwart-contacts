// Human-readable labels for Twenty MULTI_SELECT option values.
// Source: Person field metadata read from the workspace on 2026-10-14 (spike S2).
// TODO(verify): static copy. If options change in Twenty, unknown values fall back
// to a humanized raw value; read labels from metadata in a later phase.

const TYP_KONTAKTU: Record<string, string> = {
  KLIENT: 'Klient',
  DOSTAWCA: 'Dostawca',
  PARTNER: 'Partner',
  PODWYKONAWCA: 'Podwykonawca',
  KONKURENT: 'Konkurent',
  INNE: 'Inne',
};

const ROLA_KONTAKTU: Record<string, string> = {
  DECYDENT: 'Decydent',
  WPLYWOWY: 'Wpływowy / Rekomendujący',
  UZYTKOWNIK: 'Użytkownik',
  SPONSOR: 'Opiekun / Sponsor wewnętrzny',
  FINANSE: 'Księgowość / Finanse',
  ZAKUPY: 'Zakupy',
  TECHNICZNY: 'Kontakt techniczny',
  OPERACYJNY: 'Kontakt operacyjny',
};

export type LabelField = 'typKontaktu' | 'rolaKontaktu';

const TABLES: Record<LabelField, Record<string, string>> = {
  typKontaktu: TYP_KONTAKTU,
  rolaKontaktu: ROLA_KONTAKTU,
};

export const humanizeOption = (value: string): string => {
  const spaced = value.trim().replace(/[_-]+/g, ' ').toLowerCase();

  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};

export const optionLabels = (
  field: LabelField,
  values: readonly string[] | null | undefined,
): string[] =>
  (values ?? [])
    .filter((v) => v && v.trim())
    .map((v) => TABLES[field][v] ?? humanizeOption(v));
