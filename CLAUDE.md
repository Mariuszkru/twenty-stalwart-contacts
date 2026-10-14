# twenty-stalwart-contacts

Aplikacja Twenty CRM (SDK), która jednokierunkowo synchronizuje osoby (`Person`) z Twenty do książek adresowych użytkowników na serwerze Stalwart przez JMAP for Contacts. Twenty jest jedynym źródłem prawdy.

Pełny plan, fazy i kryteria akceptacji: `PLAN.md`. Przeczytaj go przed rozpoczęciem pracy i przed zmianą którejkolwiek decyzji z listy poniżej.

## Decyzje, których nie zmieniasz bez pytania użytkownika

1. Kierunek tylko Twenty → Stalwart. Nigdy nie czytamy kontaktów ze Stalwarta, żeby zmieniać Twenty.
2. Synchronizacja per użytkownik: książka "CRM" w koncie każdego uprawnionego członka workspace'u.
3. Komunikacja ze Stalwartem tylko przez JMAP (`ContactCard`, `AddressBook`, format JSContact). Nie wysyłamy vCardów. Jeśli spike S3 pokaże, że iOS nie przyjmuje wyniku, o zmianie transportu decyduje użytkownik.
4. Wszystko działa wewnątrz aplikacji Twenty (logic functions). Żadnych dodatkowych kontenerów ani serwisów.
5. Każdy użytkownik sam autoryzuje swoje konto Stalwarta przez połączenie OAuth w CRM (`defineConnectionProvider`, provider `stalwart`, zakres `urn:ietf:params:oauth:scope:contacts` i `offline_access`, token per członek). Nie ma wspólnego hasła, konta serwisowego ani autoryzacji cudzych kont przez administratora. Brak połączenia oznacza, że członek jest pomijany (to nie błąd). Zmienne `USER` z hasłem odpadły (spike S7: w Twenty 2.47 nie ma UI do ich wpisania, a komponent nie może ich zapisać).
6. `uid` karty = `urn:uuid:<person.id>`. Bez własnej tabeli mapowań i bez nowych pól na `Person` w MVP.
7. Usunięcie osoby w Twenty (do kosza lub trwałe) usuwa jej kartę z książki "CRM" każdego uprawnionego członka. Przywrócenie z kosza tworzy kartę ponownie. Zdarzenie to szybka ścieżka, a gwarancję daje faza usuwania w reconcile (szczegóły: `PLAN.md`, sekcja 6.E).

## Bezpieczeństwo (najważniejsze zasady)

- **Fail closed.** Gdy nie da się jednoznacznie ustalić, że członek ma dostęp do `Person`, nie wysyłamy nic i czyścimy jego książkę "CRM".
- Widoczność jest per rola, nie per rekord (w planie open source nie ma row-level predicates, `Person` ma czytelność `OPEN`). Każde zadanie synchronizacji na początku ponownie sprawdza: rola członka czyta `Person`, `person.readability === 'OPEN'`, rola nie ma row-level predicates dla `person`, członek ma skonfigurowane dane do Stalwarta. Jeśli konfiguracja wykracza poza to, co logika obsługuje, zatrzymaj synchronizację dla wszystkich i zgłoś błąd przez health check.
- Pola ukryte przed rolą (`canReadFieldValue: false`) nie trafiają do karty.
- Dotykamy wyłącznie kart z `uid` w formacie `urn:uuid:` w książce "CRM". Prywatne kontakty użytkownika zostają nietknięte.
- Sekrety: tokeny OAuth tylko w połączeniach Twenty (`listConnections` / `getConnection`), a `client_id` i `client_secret` klienta OAuth tylko w `serverVariables` (`isSecret`). Nigdy w `kv`, logach, odpowiedziach HTTP, komunikatach błędów, plikach repozytorium ani testach.
- Token danego członka służy wyłącznie do zapisu w jego własnym koncie Stalwarta. Używaj tylko połączenia, którego `workspaceMemberId` zgadza się z członkiem zadania, niezależnie od jego widoczności (`workspace` lub `user`). Nigdy nie używaj tokenu jednego członka do operacji w koncie innego.
- Logi: identyfikatory i liczniki, bez imion, e-maili i telefonów.
- `STALWART_JMAP_URL` musi mieć schemat `https`.
- Testy wyłącznie na kontach testowych. Nie dotykaj produkcyjnej skrzynki.

## Środowisko (stan na 2026-10-14)

- Twenty self-hosted, plan open source. Role: Admin, Member (oraz role funkcji innych aplikacji), wszystkie z `canReadAllObjectRecords: true`, bez wyjątków obiektowych. Jeden członek: `mk@recoop.pl`.
- Pola `Person`: `name`, `emails` (limit 1), `phones` (limit 1), `jobTitle`, `linkedinLink`, `company` oraz własne `typKlienta`, `rolaKontaktu`, `typKontaktu`, `statusRelacji`, `statusZatrudnienia`, `dataWeryfikacjiZatrudnienia`. Synchronizujemy tylko to, co wymienia tabela mapowania w `PLAN.md` (sekcja 7).
- Stalwart 0.16.26. JMAP pod `/jmap`, discovery `/.well-known/jmap`. REST API zarządzania usunięto w 0.16.

## Komendy

Menedżer pakietów: `yarn` (zgodnie ze szkieletem `create-twenty-app`). Nazwy komend SDK mogą się zmieniać, więc sprawdź `yarn twenty --help` i skrypty w `package.json`, zanim założysz, że działają.

- `yarn twenty dev` — synchronizacja z lokalnym serwerem w trybie deweloperskim (generuje typowany `CoreApiClient`)
- `yarn twenty dev:build` — build
- `yarn twenty dev:add` — scaffolding encji (obiekty, pola, logic functions, widoki)
- `yarn twenty dev:function:exec -n <nazwa> -p '<json>'` — ręczne uruchomienie funkcji
- `yarn twenty dev:function:logs` — logi funkcji
- testy: Vitest (`yarn test`, jeśli skrypt istnieje w szkielecie)

## Konwencje Twenty SDK

- Importy: `twenty-sdk/define` (`defineApplication`, `defineApplicationRole`, `defineLogicFunction`, `defineHealthCheck`, `defineField`), `twenty-sdk/logic-function` (`enqueueJobs`, `getJobs`, `kv`, `RetryableLogicFunctionError`, typy payloadów), `twenty-client-sdk/core` (`CoreApiClient`), `twenty-client-sdk/metadata` (`MetadataApiClient`).
- Każda encja ma stabilny `universalIdentifier` (UUID generowany raz, nigdy nie zmieniany). Nie hardkoduj identyfikatorów workspace'u.
- `CoreApiClient` działa domyślnie jako osoba wyzwalająca, a bez osoby (cron, brak użytkownika) jako aplikacja. Klient `runAs: 'application'` twórz na poziomie modułu i używaj świadomie. Rola aplikacji ogranicza oba warianty.
- Zmienne aplikacji trafiają do `process.env` jako stringi. Parsuj je jawnie. Sekrety są dostępne tylko w logic functions.
- Nie używaj zarezerwowanych nazw env: `TWENTY_API_URL`, `TWENTY_APP_ACCESS_TOKEN`, `TWENTY_APP_APPLICATION_ACCESS_TOKEN`, `TWENTY_API_KEY`, `TWENTY_FUNCTIONS_URL`, `APPLICATION_ID`.
- Pojedyncze uruchomienie: maks. 900 s. Długie prace dziel łańcuchem `enqueueJobs` (do 200 jobów na wywołanie), zapisuj postęp przed kolejkowaniem następnego jobu. `enqueueJob` (liczba pojedyncza) jest przestarzałe, używaj `enqueueJobs`.
- Retry tylko przez `RetryableLogicFunctionError` (maks. 3 próby aplikacyjne). Zwykły wyjątek to błąd trwały. Handlery muszą być idempotentne.
- `databaseEventTriggerSettings` z `batchMode: true`: handler dostaje `events[]` (do 200) i musi iterować. Filtr `updatedFields` dotyczy tylko zdarzeń `.updated`.
- `kv` jest trwały (Postgres), ale nie szyfrowany: tylko stan koordynacyjny (kursory, id książek, statusy).
- Dokumentacja: indeks `https://docs.twenty.com/llms.txt`, strony deweloperskie `https://docs.twenty.com/_llms/en/developers.txt` (Logic Functions, Background Jobs, Key-Value Store, Application Config, Roles & Permissions).

## JMAP / JSContact

- Specyfikacje: RFC 8620 (JMAP core), RFC 9610 (JMAP for Contacts), RFC 9553 (JSContact). Dokumentacja Stalwarta: `https://stalw.art/docs/collaboration/contact/`.
- Flow: `GET /.well-known/jmap` (session: `apiUrl`, `accountId`, limity `maxObjectsInSet`, `maxCallsInRequest`) → `AddressBook/get` (znajdź "CRM", w razie braku `AddressBook/set` create) → `ContactCard/query` z filtrem `uid` → `ContactCard/set` (create/update/destroy) w paczkach nieprzekraczających limitów z session.
- Zawsze obsługuj `notCreated`, `notUpdated`, `notDestroyed` w odpowiedzi `/set`. Brak błędu HTTP nie oznacza sukcesu.
- Uwierzytelnianie: `Authorization: Bearer <token OAuth członka>` (spike S10). Basic z hasłem aplikacji też działa (S4), ale kod aplikacji go nie używa. `/.well-known/jmap` odpowiada 307, klient idzie za przekierowaniem. `uid` jest unikalny w koncie, więc destroy i create tej samej karty nie mogą być w jednym `/set`. Stalwart dopisuje `kind: "title"` do `titles`, więc wysyłamy je jawnie.
- Mapowanie `Person` → `ContactCard` jest w `PLAN.md` (sekcja 7). Nazwy pól kompozytowych Twenty (np. `emails.primaryEmail`, `phones.primaryPhoneNumber`) weryfikuj w wygenerowanych typach, nie z pamięci.

## Struktura repozytorium (docelowa)

```
src/
  application-config.ts        # defineApplication, serverVariables, zmienne workspace
  roles/default-role.ts        # defineApplicationRole (odczyt + flaga ROLES)
  health-check.ts              # defineHealthCheck (stan z kv)
  connection-providers/stalwart-connection.ts   # OAuth do Stalwarta, zakres contacts
  logic-functions/
    sync-person-{created,updated,restored,deleted,destroyed}.logic-function.ts
    sync-company-events.logic-function.ts
    sync-member.logic-function.ts      # jeden krok łańcucha per członek
    reconcile-all.logic-function.ts    # ręcznie, domyślnie dry-run
    reconcile-nightly.logic-function.ts # cron 02:00
    sync-now.logic-function.ts         # HTTP, tylko wywołujący członek
    jmap-smoke-test.logic-function.ts
  lib/
    jmap.ts jmap-sync.ts jscontact.ts eligibility.ts labels.ts
    member-sync.ts fanout.ts queue-person-changes.ts start-reconcile.ts
    twenty-reader.ts twenty-metadata.ts twenty-people.ts
    health-state.ts health-store.ts
docs/spikes.md                 # wyniki spike'ów (faza 0)
PLAN.md  CLAUDE.md
```

## Sposób pracy

- Pracuj fazami z `PLAN.md`. Nie przechodź do następnej fazy, dopóki kryteria akceptacji bieżącej nie są spełnione.
- Najpierw faza 0 (spike'i S1–S9): zapisz odpowiedzi w `docs/spikes.md`. Jeśli wynik spike'a zmienia decyzję z listy wyżej, zatrzymaj się i zapytaj użytkownika.
- Logikę uprawnień (`eligibility.ts`) i mapowanie (`jscontact.ts`) pisz z testami jednostkowymi przed integracją. Testy uprawnień są tabelaryczne i obejmują każdy warunek osobno oraz zachowanie fail closed.
- Każda funkcja z efektami ubocznymi ma tryb dry-run, który loguje plan zmian bez zapisu.
- Przy braku pewności co do API Twenty lub Stalwarta sprawdź dokumentację lub wygenerowane typy zamiast zgadywać. Niepewne założenia oznaczaj w kodzie komentarzem `TODO(verify)` i dopisz do `docs/spikes.md`.

## Czego nie robić

- Nie dodawaj synchronizacji w kierunku Stalwart → Twenty.
- Nie wysyłaj kontaktów dla członka, którego uprawnień nie umiesz potwierdzić.
- Nie zapisuj sekretów ani danych osobowych w `kv`, logach, plikach repozytorium ani w testach (użyj danych syntetycznych).
- Nie twórz klienta `MetadataApiClient` / `CoreApiClient` na poziomie modułu: build manifestu nie ma go jeszcze (błąd `... is not a constructor`). Twórz go wewnątrz funkcji.
- Funkcje uruchamiaj jako członek (`remote:add` bez `--api-key`, OAuth): klucz API nie jest członkiem i nie widzi niczyich połączeń.
- Nie dodawaj pól do `Person` i nie modyfikuj rekordów Twenty z poziomu synchronizacji (aplikacja tylko czyta Twenty).
- Nie usuwaj kart spoza książki "CRM" ani kart bez `uid` w formacie `urn:uuid:`.
- Nie zmieniaj `universalIdentifier` istniejących encji.
- Nie rozszerzaj roli aplikacji ponad to, co jest potrzebne (zasada minimalnych uprawnień).
