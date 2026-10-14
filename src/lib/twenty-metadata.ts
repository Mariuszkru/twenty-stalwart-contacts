// I/O for role and Person metadata. Read-only, runs as the application.
import { MetadataApiClient } from 'twenty-client-sdk/metadata';

import type { PersonMetadata, RawRole } from 'src/lib/twenty-reader';

// Created lazily: the client does not exist while the manifest is being built.
const getClient = () => new MetadataApiClient({ runAs: 'application' } as any);

export const fetchPersonMetadata = async (): Promise<PersonMetadata | null> => {
  const res: any = await getClient().query({
    objects: {
      __args: { paging: { first: 200 } },
      edges: {
        node: {
          id: true,
          nameSingular: true,
          readability: true,
          fieldsList: { id: true, name: true },
        },
      },
    },
  } as any);
  const person = res.objects.edges
    .map((e: any) => e.node)
    .find((n: any) => n.nameSingular === 'person');

  if (!person) return null;

  return {
    objectMetadataId: person.id,
    readability: person.readability,
    fieldNames: new Map(person.fieldsList.map((f: any) => [f.id, f.name])),
  };
};

export const fetchRoles = async (): Promise<RawRole[]> => {
  const { getRoles } = (await getClient().query({
    getRoles: {
      id: true,
      canReadAllObjectRecords: true,
      objectPermissions: {
        objectMetadataId: true,
        canReadObjectRecords: true,
        restrictedFields: true,
      },
      fieldPermissions: {
        objectMetadataId: true,
        fieldMetadataId: true,
        canReadFieldValue: true,
      },
      rowLevelPermissionPredicates: { objectMetadataId: true },
      rowLevelPermissionPredicateGroups: { objectMetadataId: true },
      workspaceMembers: { id: true },
    },
  } as any)) as any;

  return getRoles as RawRole[];
};
