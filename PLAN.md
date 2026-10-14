# Plan: synchronizacja kontaktów Twenty → Stalwart (JMAP)

Status: fazy 0-5 zaimplementowane i sprawdzone na żywo (2026-10-14), z wyjątkami w `docs/spikes.md`. Pozostaje faza 6 (utwardzenie). Plan zaktualizowany o zmianę mechanizmu logowania (D6): OAuth zamiast haseł `USER`.
Implementacja: w Claude Code, według faz z sekcji 9. Zasady pracy: `CLAUDE.md`.

## 1. Cel i zakres

Aplikacja Twenty (SDK, `create-twenty-app`) synchronizuje osoby (`Person`) z Twenty do książek adresowych użytkowników na serwerze Stalwart, tak aby kontakty pojawiały się na urządzeniach (w tym Apple) przez CardDAV serwowany przez Stalwart.

W zakresie v1:
- jeden kierunek: Twenty → Stalwart (Twenty jest jedynym źródłem prawdy),
- synchronizacja per użytkownik, z poszanowaniem uprawnień Twenty,
- komunikacja ze Stalwartem przez JMAP for Contacts,
- wszystko w jednej aplikacji Twenty, bez dodatkowego kontenera.

Poza zakresem v1: kierunek Stalwart → Twenty, firmy jako osobne karty, zdjęcia kontaktów, impersonacja jednym kontem serwisowym, row-level security (niedostępne w planie open source).

## 2. Stan środowiska (odczytany z Twenty 2026-10-14)

- Role: Admin, Member oraz dwie role funkcji aplikacji ("Last contact default function role", "Firma z NIP (REGON) default function role"). Wszystkie mają `canReadAllObjectRecords: true`, brak wyjątków per obiekt, brak row-level predicates.
- Obiekt `person`: `readability: OPEN`, `sharingReach: WORKSPACE`, więc brak rekordów prywatnych.
- Członkowie workspace: jeden (Mariusz Krukowski, `mk@recoop.pl`).
- Uprawnienia do pól: nieodczytane (`list_roles` ich nie zwraca). Do sprawdzenia w spike S6.
- Pola `Person`:
  - standardowe: `name` (FULL_NAME), `emails` (limit 1 wartości), `phones` (limit 1 wartości), `jobTitle`, `linkedinLink`, `company` (relacja, `companyId`), `avatarUrl`;
  - własne: `typKlienta` (SELECT: B2B/B2C/B2G), `rolaKontaktu` (MULTI_SELECT), `typKontaktu` (MULTI_SELECT), `statusRelacji` (SELECT), `statusZatrudnienia` (SELECT), `dataWeryfikacjiZatrudnienia` (DATE);
  - pola pochodzące z innej aplikacji (`lastContactAt` itd.): nie synchronizujemy.
- Stalwart: 0.16.26, JMAP pod `/jmap`, discovery pod `/.well-known/jmap`. Zarządzanie serwerem w 0.16 jest przez JMAP (REST API usunięto).

## 3. Decyzje

| # | Decyzja | Uzasadnienie |
|---|---------|--------------|
| D1 | Jednokierunkowo, Twenty = źródło prawdy | Wymóg użytkownika. Brak rozwiązywania konfliktów. |
| D2 | Per użytkownik, książka "CRM" w koncie każdego użytkownika | Wymóg: kto nie ma dostępu do kontaktu, nie może go dostać. |
| D3 | Zapis przez JMAP for Contacts (JSContact), nie CardDAV | Wymóg użytkownika. |
| D4 | Ocena widoczności w aplikacji, per rola (nie per rekord) | Brak row-level i rekordów prywatnych. Wystarczy sprawdzić rolę i pola. |
| D5 | Fail closed | Jeśli nie umiemy jednoznacznie ustalić dostępu, nie wysyłamy nic i czyścimy książkę. |
| D6 | Każdy użytkownik sam autoryzuje swoje konto Stalwarta przez połączenie OAuth (`defineConnectionProvider`, zakres tylko kontaktów, token per członek). Nie ma wspólnego hasła ani konta serwisowego, a administrator nie autoryzuje cudzych kont | Spike S7: zmiennych `USER` nie da się w Twenty 2.47 wpisać (brak UI, komponent nie może ich zapisać). Spike S10: Stalwart ma serwer OAuth (PKCE, refresh, scope `contacts`), a token Bearer działa na `/jmap`. Połączenie poczty z Ustawień Twenty jest osobne i niedostępne dla aplikacji. |
| D7 | Jedna aplikacja Twenty, logic functions | Wymóg: bez dodatkowego kontenera. |
| D8 | `uid` karty = `urn:uuid:<person.id>` | Deterministyczna tożsamość, bez tabeli mapowań. |
| D9 | Bez nowych pól na `Person` w MVP | Unikamy pętli zdarzeń i dodatkowych uprawnień. |
| D10 | Wersja vCard dla urządzeń Apple (3.0) zależy od Stalwarta | Przez JMAP nie wysyłamy vCardów. Weryfikacja na iPhonie w spike S3. |

## 4. Architektura

Wszystko działa wewnątrz serwera Twenty jako aplikacja (SDK `twenty-sdk`, `twenty-client-sdk`).

| Element | Typ w SDK | Rola |
|---------|-----------|------|
| `application-config.ts` | `defineApplication` | Zmienne konfiguracyjne (sekcja 8). |
| `roles/default-role.ts` | `defineApplicationRole` | Minimalna rola aplikacji: odczyt `Person` i `Company`, odczyt ról/członków (do ustalenia w S2). |
| `health-check.ts` | `defineHealthCheck` | Sprawdza JMAP session i logowanie, pokazuje baner błędu przy problemie. |
| `sync-person-{created,updated,restored,deleted,destroyed}` | `defineLogicFunction` + `databaseEventTriggerSettings` (jedno zdarzenie na funkcję, `batchMode`; bez wildcardu) | Zdarzenia osób: fan-out zadań per uprawniony członek. |
| `sync-company-events` | `defineLogicFunction` + `company.updated` (`updatedFields: ['name']`) | Odświeża karty osób z daną firmą (pole `organizations`). |
| `sync-member` | `defineLogicFunction` (wywoływana przez `enqueueJobs`) | Wykonawca: sprawdza uprawnienia członka, robi upsert/usuwanie dla porcji osób. |
| `reconcile-all` | `defineLogicFunction` + `cronTriggerSettings` | Nocny pełny reconcile per członek (łańcuch jobów z kursorem). |
| `sync-now` | `defineLogicFunction` + `httpRouteTriggerSettings` (`POST /s/stalwart/sync-now`) | Ręczne uruchomienie dla wywołującego członka (`?dryRun=true` = podgląd). |
| `connection-providers/stalwart-connection` | `defineConnectionProvider` (OAuth) | Użytkownik klika "Add connection" w ustawieniach aplikacji. `client_id`/`client_secret` wpisuje admin serwera Twenty jako `serverVariables`. Zastępuje stronę ustawień członka. |
| `lib/` | zwykłe moduły TS | `jmap.ts`, `jscontact.ts`, `eligibility.ts`, `twenty-reader.ts`, `labels.ts`. |

Limity platformy, które determinują projekt (z dokumentacji Twenty):
- pojedyncze uruchomienie funkcji: maks. 900 s (`timeoutSeconds`), więc długie prace dzielimy na łańcuch jobów (`enqueueJobs`, do 200 jobów na wywołanie, `delayMs`, `retryLimit` 0–10, retry aplikacyjny maks. 3 przez `RetryableLogicFunctionError`),
- `databaseEvent` z `batchMode`: do 200 zdarzeń na wywołanie, handler musi pętlić po `events`,
- `kv` (trwały, w Postgresie): bez sekretów, tylko stan koordynacyjny,
- zmienne aplikacji trafiają do `process.env` jako stringi, sekrety tylko do logic functions,
- zarezerwowane nazwy env: `TWENTY_API_URL`, `TWENTY_APP_ACCESS_TOKEN`, `TWENTY_APP_APPLICATION_ACCESS_TOKEN`, `TWENTY_API_KEY`, `TWENTY_FUNCTIONS_URL`, `APPLICATION_ID`.

## 5. Model widoczności (D4, D5)

Widoczność jest per rola, bo w tym planie Twenty nie ma row-level predicates, a `Person` ma czytelność `OPEN`.

Członek jest **uprawniony do synchronizacji**, gdy jednocześnie:
1. jego rola czyta `Person`: `canReadAllObjectRecords` albo wyjątek obiektowy z `canReadObjectRecords: true` dla `person` (wyjątek z `false` wygrywa),
2. obiekt `person` ma `readability: OPEN`,
3. rola nie ma żadnych row-level predicates dla `person` (po zmianie planu lub ustawień),
4. ma połączenie OAuth ze Stalwartem (`stalwart`), którego właścicielem jest ten członek i które nie ma `authFailedAt`.

Pola: karta zawiera tylko pola, których rola nie ma ukrytych (`canReadFieldValue: false`).

Zasady:
- Warunki 1 to 4 sprawdza **każde** zadanie `sync-member` na początku, nie tylko reconcile.
- Gdy warunek 2 lub 3 nie jest spełniony (konfiguracja, której logika nie obsługuje): zatrzymaj synchronizację dla wszystkich, wyczyść książki "CRM", health check pokazuje błąd. Nie próbuj zgadywać.
- Gdy warunek 1 nie jest spełniony dla członka: wyczyść jego książkę "CRM".
- Członek usunięty lub dezaktywowany: wyczyść jego książkę "CRM" przy najbliższym reconcile.
- Dotykamy wyłącznie kart z `uid` w formacie `urn:uuid:` pochodzących z Twenty w książce "CRM". Prywatne kontakty użytkownika w tym samym koncie pozostają nietknięte.

Utrata dostępu (zmiana roli) nie wywołuje zdarzenia na `Person`. Wykrywa ją najbliższe zadanie `sync-member` lub nocny reconcile. Okno ekspozycji = czas do następnego z nich (do rozważenia w fazie 6: dodatkowy wyzwalacz po zmianie roli, jeśli Twenty udostępnia zdarzenie).

## 6. Przepływy

**A. Zdarzenie osoby** (`person.created|updated|restored|deleted|destroyed`):
1. Handler (batch) zbiera `recordId` i typ zdarzenia.
2. Pobiera listę uprawnionych członków.
3. `enqueueJobs` na `sync-member` po jednym zadaniu na członka, z payloadem `{ workspaceMemberId, personIds[], op }`.
4. `sync-member`: ponowna weryfikacja uprawnień, odczyt osób, upsert (created/updated/restored) lub usunięcie (deleted/destroyed) przez `ContactCard/set`.

**B. Pełny reconcile** (cron, nocą, oraz ręcznie):
1. Dla każdego członka: weryfikacja uprawnień (nieuprawniony: wyczyść książkę i przejdź dalej).
2. Faza upsert: kursor po wszystkich osobach (porcje ≤ 200), `ContactCard/set`, postęp w `kv` przed kolejkowaniem następnego jobu.
3. Faza usuwania (po zakończeniu upsert): stronicowanie kart w książce "CRM" (`ContactCard/query`), sprawdzenie w Twenty, które `uid` nadal istnieją (usunięte miękko = nieistniejące), `destroy` pozostałych.
4. Wynik (liczniki, czas, błędy) do `kv` pod kluczem statusu, do odczytu przez health check / widok.

**C. Zmiana nazwy firmy** (`company.updated` z `name`): znajdź osoby z tą firmą i kolejkuj jak w A.

**E. Usuwanie (wymaganie).** Usunięcie osoby w Twenty musi usunąć jej kartę z książki "CRM" każdego uprawnionego członka:
- miękkie usunięcie (kosz, zdarzenie `person.deleted`) i trwałe (`person.destroyed`) obsługujemy tak samo: `ContactCard/set` z `destroy` dla karty o `uid = urn:uuid:<id>` (id karty z `ContactCard/query` po `uid`),
- przywrócenie z kosza (`person.restored`) tworzy kartę ponownie (to upsert, karta dostaje nowe id serwera, `uid` bez zmian),
- zdarzenie jest szybką ścieżką. Gwarancję daje faza usuwania w reconcile (B.3), która usuwa każdą kartę bez odpowiednika wśród istniejących, nieusuniętych osób, więc pominięte zdarzenie, niedostępny Stalwart albo członek, który skonfigurował połączenie później, i tak kończą się usunięciem,
- usunięcie nieudane z powodu 429/5xx/sieci jest ponawiane (`RetryableLogicFunctionError`), a po wyczerpaniu prób nadrabia je nocny reconcile,
- usuwamy tylko karty z naszym `uid` w książce "CRM", nigdy inne,
- usunięcie jest po stronie Stalwarta trwałe (bez kosza). Skutek uboczny jednokierunkowości: karta usunięta ręcznie na serwerze lub telefonie wróci przy najbliższej synchronizacji, dopóki osoba istnieje w Twenty.

**D. Idempotencja:** wszystkie operacje są powtarzalne. Retry tylko przez `RetryableLogicFunctionError` dla 429/5xx i błędów sieci.

## 7. Mapowanie `Person` → JSContact (RFC 9553)

Nazwy pól kompozytowych Twenty zweryfikować w wygenerowanych typach `CoreApiClient` (`yarn twenty dev`).

| Twenty | JSContact (`ContactCard`) |
|--------|---------------------------|
| `id` | `uid: "urn:uuid:<id>"` |
| — | `@type: "Card"`, `version: "1.0"`, `kind: "individual"` |
| `name.firstName` / `name.lastName` | `name.components` (`given`, `surname`) oraz `name.full` |
| brak imienia i nazwiska | `name.full` = główny e-mail; jeśli brak, `"(bez nazwy)"` |
| `emails.primaryEmail` (+ dodatkowe, jeśli limit zostanie zwiększony) | `emails` (`address`, pierwszy z `pref: 1`) |
| `phones.primaryPhoneNumber` + kod kraju | `phones` (`number` w formacie E.164, jeśli to możliwe) |
| `jobTitle` | `titles` |
| `company.name` | `organizations` |
| `linkedinLink.primaryLinkUrl` | `links` (`kind: "profile"` lub bez `kind`, do sprawdzenia w S3) |
| `typKontaktu`, `rolaKontaktu` | `keywords` (etykiety czytelne dla człowieka z `lib/labels.ts`) |
| książka docelowa | `addressBookIds: { "<id>": true }` |

Nie synchronizujemy: `typKlienta`, `statusRelacji`, `statusZatrudnienia`, `dataWeryfikacjiZatrudnienia`, pól "last contact", relacji, zdjęć.

Przykład (szkic do potwierdzenia na Stalwarcie):

```json
{
  "@type": "Card", "version": "1.0", "kind": "individual",
  "uid": "urn:uuid:<person.id>",
  "name": { "full": "Jan Kowalski",
            "components": [{"kind":"given","value":"Jan"},{"kind":"surname","value":"Kowalski"}] },
  "emails": { "e1": {"address": "jan@firma.pl"} },
  "phones": { "p1": {"number": "+48600000000"} },
  "titles": { "t1": {"name": "CTO"} },
  "organizations": { "o1": {"name": "Firma"} },
  "keywords": { "Klient": true, "Decydent": true },
  "addressBookIds": { "<id książki>": true }
}
```

## 8. Konfiguracja

Zmienne `WORKSPACE` (`applicationVariables`):
- `STALWART_JMAP_URL` (wymagana, `https://`), np. adres serwera pocztowego. Walidować schemat `https`.
- `ADDRESS_BOOK_NAME` (domyślnie `CRM`).
- `SYNC_ENABLED` (BOOLEAN, domyślnie `true`), wyłącznik awaryjny.

`serverVariables` (wpisuje admin serwera Twenty w rejestracji aplikacji):
- `STALWART_OAUTH_CLIENT_ID`, `STALWART_OAUTH_CLIENT_SECRET` (`isSecret`): klient OAuth zarejestrowany w Stalwarcie (redirect URI `https://<twenty>/auth/apps/callback`, `client_secret_post`, zakresy `urn:ietf:params:oauth:scope:contacts` i `offline_access`).

Zmiennych `USER` z hasłem nie ma (decyzja D6).

### Połączenie członka

- Każdy członek sam dodaje połączenie: Ustawienia aplikacji, zakładka General, "Add connection", logowanie w Stalwarcie. Token (z odświeżaniem) czyta wyłącznie kod po stronie serwera przez `listConnections` / `getConnection`.
- Połączenie dodane z UI ma widoczność `workspace` (współdzieloną), więc kod bierze tylko połączenie, którego właścicielem jest członek zadania (`workspaceMemberId`).
- Stany członka (w `kv`, klucz `member:<id>:status`, bez sekretów): `unconfigured` (brak połączenia, pomijany, nie błąd), `syncing`, `connected`, `auth-error` (401 lub `authFailedAt`, bez retry w pętli), `cleared`, `halted`.
- Podsumowanie dla health checka w `kv` pod `sync:health`: zatrzymanie synchronizacji, lista członków z `auth-error`, czas ostatniego udanego sync.
- Wymaga flagi `ROLES` w roli aplikacji (odczyt ról i uprawnień do pól, spike S2/S6). Flaga obejmuje też zarządzanie rolami, kod tylko czyta.

## 9. Fazy i kryteria akceptacji

**Faza 0. Spike'i (patrz sekcja 10).** Wynik: `docs/spikes.md` z odpowiedziami i decyzjami. Kryterium: S1, S2, S3, S7 rozstrzygnięte, bo mogą zmienić projekt.

**Faza 1. Szkielet i połączenie.**
- `twenty app init` (`create-twenty-app` jest przestarzałe), konfiguracja zmiennych, rola aplikacji, health check.
- Funkcja `jmap-smoke-test` tworzy jedną kartę testową w książce "CRM" bieżącego członka.
- Połączenie OAuth dodaje sam użytkownik w CRM. Smoke test używa wyłącznie połączenia członka, który go uruchomił.
- Kryterium: karta widoczna w kliencie CardDAV i na iPhonie, polskie znaki poprawne.

**Faza 2. Biblioteki rdzenia (z testami jednostkowymi).**
- `jmap.ts` (session, `AddressBook/get|set`, `ContactCard/query|get|set`, batching z limitami z session, obsługa `notCreated/notUpdated/notDestroyed`),
- `jscontact.ts` (mapowanie z sekcji 7, testy na przypadkach brzegowych: brak nazwy, brak e-maila, znaki specjalne),
- `eligibility.ts` (sekcja 5, testy tabelaryczne: każdy warunek osobno, fail closed),
- `twenty-reader.ts` (kursor po osobach, zapytanie o istnienie po `id`).
- Kryterium: testy zielone, tryb dry-run (loguje plan zmian bez zapisu).

**Faza 3. Pełny reconcile ręcznie.**
- `sync-member` + łańcuch jobów, faza usuwania, status w `kv`.
- Kryterium: pełny import wszystkich osób, ponowne uruchomienie nie zmienia stanu książki, usunięcie osoby w Twenty znika z książki po reconcile.

**Faza 4. Zdarzenia.**
- `sync-person-events` (`person.*`, `batchMode`), `sync-company-events`, filtry `updatedFields`.
- Kryterium: zmiana/dodanie osoby widoczne w książce w kilka sekund; usunięcie osoby (do kosza i trwałe) usuwa jej kartę, a przywrócenie z kosza tworzy ją ponownie; usunięcie przy niedostępnym Stalwarcie zostaje nadrobione przez reconcile; zmiana roli na taką bez dostępu i kolejne zdarzenie czyści książkę.

**Faza 5. Cron i ręczne uruchamianie.**
- Nocny reconcile, `sync-now` (HTTP route / workflow action / command menu), podgląd statusu.
- Status członka i podsumowanie w `kv`, health check (ERROR przy zatrzymaniu, WARNING przy błędzie uwierzytelnienia). Strona ustawień członka i `test-connection` odpadły (zastępuje je połączenie OAuth).
- Kryterium: nocny przebieg bez ingerencji, ręczne uruchomienie działa.

**Faza 6. Utwardzenie.**
- Retry/backoff, limity, logi bez danych osobowych i sekretów, obsługa dezaktywowanych członków, test niedostępności Stalwarta, dokumentacja (README, instrukcja dla użytkownika: jak wpisać hasło aplikacji), lista kontrolna testu na iPhonie.
- Decyzja do podjęcia: zachowanie przy odinstalowaniu (domyślnie: nie kasujemy kart automatycznie, udostępniamy funkcję `purge`).

## 10. Spike'i (do rozstrzygnięcia na początku)

| # | Pytanie | Dlaczego ważne |
|---|---------|----------------|
| S1 | Czy logic function może łączyć się z hostem Stalwarta (sieć wewnętrzna, ochrona SSRF)? | Jeśli nie, potrzebny publiczny adres lub wyjątek w konfiguracji Twenty. |
| S2 | Jak aplikacja odczytuje role członków i uprawnienia (Metadata API) i jakiej roli aplikacji do tego potrzeba? | Cały model widoczności (sekcja 5). |
| S3 | JMAP for Contacts w Stalwart 0.16.26: capability `urn:ietf:params:jmap:contacts`, `ContactCard/set`, `AddressBook/set`, wspierane właściwości JSContact (`keywords`, `links`), jakie vCard dostaje iPhone? | Jeśli iOS odrzuca wynik, fallback: `PUT` vCard 3.0 przez CardDAV z tej samej aplikacji (D3 do zmiany). |
| S4 | Uwierzytelnianie do JMAP: Basic z hasłem aplikacji, wymagane uprawnienia konta. | Faza 1. |
| S5 | Nazwy zdarzeń `person.restored`/`deleted`/`destroyed`, działanie wildcardu `person.*` z `batchMode`, jak filtruje `updatedFields` dla relacji (`company` vs `companyId`). | Faza 4. |
| S6 | Jak odczytać uprawnienia do pól roli (Metadata API)? | Pola w karcie. |
| S7 | Zapis zmiennych `USER` przez członka. | Wynik: niemożliwy w Twenty 2.47 (patrz D6). |
| S10 | OAuth do Stalwarta przez połączenie aplikacji. | Zastępuje hasła `USER`. Wynik: działa. |
| S8 | Czy jest zdarzenie lub sposób wykrycia zmiany roli/członkostwa. | Skrócenie okna ekspozycji. |
| S9 | Format telefonu i polskie znaki w iOS/Android przez CardDAV. | Jakość danych. |

## 11. Ryzyka

- **Wyciek kontaktu do użytkownika bez dostępu:** główne ryzyko biznesowe. Środki: fail closed, ponowna weryfikacja w każdym zadaniu, testy tabelaryczne uprawnień.
- **Zmiana konfiguracji uprawnień w przyszłości** (prywatne rekordy, row-level po zmianie planu): wykrywana w każdym uruchomieniu, synchronizacja zatrzymuje się.
- **Sekrety:** hasła aplikacji tylko w zmiennych `isSecret`, nigdy w `kv`, logach ani odpowiedziach HTTP.
- **Dane osobowe w logach:** logować identyfikatory i liczniki, nie imiona, e-maile ani telefony.
- **Rozjazd stanu po awarii:** nocny reconcile i idempotentne operacje.
- **Zachowanie Stalwarta/iOS:** weryfikowane w spike S3 przed większą inwestycją.

## 12. Środowisko testowe

- Lokalny Twenty z `yarn twenty` (serwer deweloperski ze skryptu SDK) oraz testowa instancja Stalwart 0.16.x z kontami testowymi. Nie testować na produkcyjnej skrzynce.
- Testy jednostkowe: Vitest. Testy integracyjne: przeciwko lokalnemu Twenty i testowemu Stalwartowi.
- Przed fazą 4 dodać do Twenty kilka osób testowych (w tym bez nazwy, bez e-maila, ze znakami diakrytycznymi) i drugiego członka z rolą bez dostępu do `Person`.
