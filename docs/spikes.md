# Spike'i (faza 0)

Wyniki spike'ów S1–S9 z `PLAN.md` sekcja 10. Jeśli wynik zmienia decyzję z `CLAUDE.md`, zatrzymaj się i zapytaj użytkownika.

Środowisko: Twenty `https://crm.recoop.pl`, Stalwart `https://mail.recoop.pl` (konto testowe, nie produkcyjna skrzynka).

| # | Status | Wynik |
|---|--------|-------|
| S1 | rozstrzygnięty (2026-10-14) | Tak. Logic function na `crm.recoop.pl` (Twenty v2.47.0) łączy się z `https://mail.recoop.pl` (session, `AddressBook/get`, `ContactCard/set`). |
| S2 | rozstrzygnięty (2026-10-14) | `MetadataApiClient.query({ getRoles })` działa z logic function (token aplikacji i członka), ale wymaga flagi `SystemPermissionFlag.ROLES` w roli aplikacji (dodana za zgodą użytkownika; flaga obejmuje też zarządzanie rolami, kod tylko czyta). Zwraca role z `canReadAllObjectRecords`, `objectPermissions` (`objectMetadataId`, `canReadObjectRecords`, `restrictedFields`), `rowLevelPermissionPredicates` i `workspaceMembers { id }`. Obiekty w uprawnieniach są po `objectMetadataId`, więc `person` trzeba rozwiązać po metadanych (nie hardkodować). Stan: 5 ról, wszystkie read-all, bez wyjątków i predykatów, 1 członek (Admin). |
| S3 | częściowo (2026-10-14) | JMAP for Contacts działa: `urn:ietf:params:jmap:contacts`, `AddressBook/set`, `ContactCard/set` przyjęły kartę z `keywords`, `links`, polskimi znakami. CardDAV serwuje vCard 3.0 UTF-8 (`FN`, `N`, `EMAIL`, `TEL`, `TITLE`, `ORG`, `URL`, `CATEGORIES`). Zagnieżdżone `@type` dodają śmieciowe linie `JSPROP`, więc `jscontact.ts` ich nie wysyła. Do zrobienia: sprawdzenie na iPhonie. Stalwart nie rozwiązuje `#id` w kluczach `addressBookIds`, trzeba użyć prawdziwego id książki. `uid` jest unikalny w koncie: destroy i create tej samej karty nie mogą być w jednym `/set`. |
| S4 | rozstrzygnięty (2026-10-14) | Basic z hasłem aplikacji działa na `/.well-known/jmap` i `/jmap`. `/.well-known/jmap` odpowiada 307, klient musi iść za przekierowaniem. Limity z session: `maxObjectsInSet` 500, `maxCallsInRequest` 16. |
| S5 | otwarty | Zdarzenia `person.*`, `batchMode`, `updatedFields`. |
| S6 | rozstrzygnięty (2026-10-14) | `getRoles { fieldPermissions { objectMetadataId fieldMetadataId canReadFieldValue } }` zwraca uprawnienia do pól (obecnie puste). Nazwy pól trzeba rozwiązać po `fieldMetadataId` z metadanych. `eligibility.ts` dostaje je z `twenty-reader.ts`; do tego czasu fail closed. |
| S7 | częściowo (2026-10-14) | Wg dokumentacji Twenty (SDK 2.46): zmienne `USER` wpisuje wyłącznie sam członek mutacją `updateMyUserApplicationVariable` z własną sesją; token aplikacji jest odrzucany, więc front component nie może zapisać hasła. Elementy `defineSettingsMenuItem({ scope: 'USER' })` są synchronizowane, ale jeszcze nigdzie nie wyświetlane. Skutek: w tej wersji nie ma UI do wpisania `STALWART_APP_PASSWORD`. Alternatywa: S10. Do zweryfikowania: `myUserApplicationVariables` z crona i `process.env` w funkcji uruchomionej przez członka. |
| S10 | rozstrzygnięty (2026-10-14) | Zamiast hasła: OAuth 2.0 przez `defineConnectionProvider` (`stalwart`), scope `urn:ietf:params:oauth:scope:contacts`+`offline_access`, PKCE. Token Bearer z `listConnections` działa na `/jmap`; `jmap-smoke-test` uruchomiona jako członek (OAuth remote) utworzyła kartę. Klient OAuth rejestruje admin Stalwarta (`/auth/register` daje 401/403 dla zwykłego konta), `client_id`/`secret` trafiają do `serverVariables`. Połączenie poczty z Ustawień Twenty jest osobne i niedostępne dla aplikacji. UWAGA: połączenie dodane z UI dostało widoczność `workspace`; kod używa wyłącznie połączenia, którego `userWorkspaceId` jest właścicielem uruchamiającego członka. Uruchomienie z kluczem API nie jest członkiem (auth error), do testów służy remote OAuth `recoop-me`. `identifyAccountLogicFunction` wymaga Twenty >=2.48 (jest 2.47.0). |
| S8 | otwarty | Wykrycie zmiany roli/członkostwa. |
| S9 | otwarty | Telefon i polskie znaki w iOS/Android. |

## Założenia w kodzie oznaczone `TODO(verify)`

- `src/lib/jscontact.ts`: nazwy pól kompozytowych `Person` (`primaryEmail`, `primaryPhoneNumber`, `primaryPhoneCallingCode`, `primaryLinkUrl`) z `PLAN.md`, nie z wygenerowanych typów.
- `src/lib/labels.ts`: statyczna kopia etykiet opcji `typKontaktu` i `rolaKontaktu` z metadanych workspace'u (2026-10-14). Nieznane wartości dostają etykietę wyprowadzoną z surowej wartości.
- `src/lib/eligibility.ts`: kształt snapshotu roli i uprawnień do pól (S2, S6).

## Środowisko

- Node v25.9.0 zamiast wymaganego `^24.5.0` (świadomy wybór użytkownika), ostrzeżenia engine są ignorowane.
- Globalny yarn to 1.22; używane jest `npx corepack yarn` (Yarn 4.13.0 z `packageManager`).
- SDK 2.46.0, komendy: `remote:add`, `plan`, `apply`, `dev`, `dev:generate-client`.
