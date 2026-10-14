// Read-only access to Person / Company in Twenty, as the application.
// Never writes. Soft-deleted people are excluded by Twenty's default filter.
import { CoreApiClient } from 'twenty-client-sdk/core';

import type { PersonInput } from 'src/lib/jscontact';

// Created lazily: the client does not exist while the manifest is being built.
const getClient = () => new CoreApiClient({ runAs: 'application' } as any);

const PERSON_SELECTION = {
  id: true,
  name: { firstName: true, lastName: true },
  emails: { primaryEmail: true },
  phones: { primaryPhoneNumber: true, primaryPhoneCallingCode: true },
  jobTitle: true,
  linkedinLink: { primaryLinkUrl: true },
  company: { name: true },
  typKontaktu: true,
  rolaKontaktu: true,
};

export const PAGE_SIZE = 200;

export type PeoplePage = {
  people: PersonInput[];
  endCursor: string | null;
  hasNextPage: boolean;
};

// Cursor-based page over all live people. Persist endCursor before queueing the next job.
export const fetchPeoplePage = async (
  after: string | null,
  first: number = PAGE_SIZE,
): Promise<PeoplePage> => {
  const res: any = await getClient().query({
    people: {
      __args: { first, ...(after ? { after } : {}) },
      edges: { node: PERSON_SELECTION },
      pageInfo: { hasNextPage: true, endCursor: true },
    },
  } as any);

  return {
    people: res.people.edges.map((e: any) => e.node as PersonInput),
    endCursor: res.people.pageInfo.endCursor ?? null,
    hasNextPage: !!res.people.pageInfo.hasNextPage,
  };
};

// Specific people by id (event path). Missing or soft-deleted ids are simply absent.
export const fetchPeopleByIds = async (ids: readonly string[]): Promise<PersonInput[]> => {
  if (!ids.length) return [];

  const res: any = await getClient().query({
    people: {
      __args: { first: PAGE_SIZE, filter: { id: { in: [...ids] } } },
      edges: { node: PERSON_SELECTION },
    },
  } as any);

  return res.people.edges.map((e: any) => e.node as PersonInput);
};

// Which of these ids still exist (not soft-deleted). Used by the reconcile delete phase.
export const existingPersonIds = async (ids: readonly string[]): Promise<Set<string>> => {
  const found = new Set<string>();

  for (let i = 0; i < ids.length; i += PAGE_SIZE) {
    for (const p of await fetchPeopleByIds(ids.slice(i, i + PAGE_SIZE))) found.add(p.id);
  }

  return found;
};

// People that belong to any of these companies (live people only). Used for company renames.
export const fetchPersonIdsByCompanyIds = async (
  companyIds: readonly string[],
): Promise<string[]> => {
  if (!companyIds.length) return [];

  const ids: string[] = [];
  let after: string | null = null;

  for (;;) {
    const res: any = await getClient().query({
      people: {
        __args: {
          first: PAGE_SIZE,
          ...(after ? { after } : {}),
          filter: { companyId: { in: [...companyIds] } },
        },
        edges: { node: { id: true } },
        pageInfo: { hasNextPage: true, endCursor: true },
      },
    } as any);

    ids.push(...res.people.edges.map((e: any) => e.node.id as string));

    if (!res.people.pageInfo.hasNextPage) return ids;

    after = res.people.pageInfo.endCursor;
  }
};
