# twenty-stalwart-contacts

Aplikacja Twenty CRM, która jednokierunkowo synchronizuje osoby (`Person`) z Twenty do książek adresowych użytkowników na serwerze Stalwart (JMAP for Contacts). Kontakty pojawiają się na telefonach i w programach pocztowych przez CardDAV serwowany przez Stalwart. Twenty jest jedynym źródłem prawdy: zmiany zrobione w Stalwarcie nigdy nie wracają do Twenty.

Pełny plan i decyzje: [PLAN.md](PLAN.md). Zasady pracy nad kodem: [CLAUDE.md](CLAUDE.md). Wyniki badań: [docs/spikes.md](docs/spikes.md).

## Jak to działa

- Każdy uprawniony członek workspace'u ma w swoim koncie Stalwart książkę adresową **CRM** z kartami osób z Twenty.
- Karta ma identyfikator `urn:uuid:<id osoby>`. Aplikacja dotyka wyłącznie kart z takim identyfikatorem w książce CRM. Prywatne kontakty użytkownika zostają nietknięte.
- Zmiana, dodanie, przeniesienie do kosza, przywrócenie i trwałe usunięcie osoby docierają do Stalwarta w kilka sekund. Co noc o 02:00 działa pełny reconcile, który naprawia wszystko, co ominęły zdarzenia (także usuwa karty osób, których już nie ma).
- Karta trafia tylko do członków, których rola może czytać `Person`. Pola ukryte przed rolą nie trafiają na kartę. Gdy aplikacja nie może jednoznacznie stwierdzić, że członek ma dostęp, nie wysyła nic i czyści jego książkę CRM (fail closed).
- Co jest synchronizowane: imię i nazwisko, e-mail, telefon, stanowisko, firma, profil LinkedIn oraz etykiety z pól `Typ kontaktu` i `Rola kontaktu` (jako kategorie). Nic więcej.

## Wymagania

- Twenty self-hosted w wersji 2.46 lub nowszej, z dostępem do aplikacji (SDK 2.46).
- Stalwart 0.16 z włączonym JMAP for Contacts i serwerem OAuth. Adres serwera musi mieć `https`.
- Node 24.5 i Yarn 4 do budowania (Node 25 działa z ostrzeżeniami).

## Instalacja (administrator)

1. **Zarejestruj klienta OAuth w Stalwarcie** (zwykłe konto nie ma do tego uprawnień). Ustaw:
   - nazwa: `twenty-stalwart-contacts`
   - redirect URI: `https://<adres Twenty>/auth/apps/callback`
   - typ: poufny, uwierzytelnianie `client_secret_post`
   - zakresy: `urn:ietf:params:oauth:scope:contacts` i `offline_access`

   Zakres `contacts` nie daje dostępu do poczty.
2. **Zainstaluj aplikację** w Twenty:
   ```
   yarn install
   yarn twenty remote:add          # logowanie OAuth jako Ty
   yarn twenty apply
   ```
3. **Wpisz `client_id` i `client_secret`** z kroku 1 w ustawieniach aplikacji w Twenty (zmienne serwera `STALWART_OAUTH_CLIENT_ID` i `STALWART_OAUTH_CLIENT_SECRET`). Do tego czasu przycisk dodawania połączenia jest nieaktywny.
4. Sprawdź zmienne workspace'u: `STALWART_JMAP_URL` (adres Stalwarta, `https`), `ADDRESS_BOOK_NAME` (domyślnie `CRM`), `SYNC_ENABLED` (`false` zatrzymuje całą synchronizację).

Adres Stalwarta jest też wpisany na stałe w `src/connection-providers/stalwart-connection.ts` (punkty końcowe OAuth). Zmień go tam, jeśli serwer ma inny adres niż `mail.recoop.pl`.

## Użytkownik: jak włączyć synchronizację

Każdy członek robi to sam, raz:

1. W Twenty otwórz ustawienia aplikacji **Stalwart Contacts**, zakładka **General**.
2. Kliknij **Add connection** i zaloguj się swoim kontem Stalwart.
3. Po chwili książka **CRM** pojawi się na koncie. Pierwszy pełny sync trwa do nocnego reconcile albo do ręcznego uruchomienia (poniżej).

Hasła do skrzynki nigdzie nie wpisujesz. Aplikacja dostaje token tylko do kontaktów, który odświeża się sam. Członek bez połączenia jest pomijany (to nie błąd). Gdy token przestanie działać, health check pokaże ostrzeżenie i trzeba połączyć konto ponownie.

Uwaga: połączenie dodane z interfejsu ma widoczność współdzieloną w workspace'ie. Aplikacja i tak używa wyłącznie połączenia, którego właścicielem jest dany członek, nigdy cudzego.

## Ręczne uruchamianie

- Pełny sync własnego konta: `POST <adres funkcji>/stalwart/sync-now`. Z `?dryRun=true` tylko pokazuje plan.
- Wszystkie konta, z konsoli: `yarn twenty dev:function:exec -n reconcile-all -p '{"dryRun":false}'`. Domyślnie to dry-run.
- Funkcje należy uruchamiać jako członek (`remote:add` bez klucza API). Klucz API nie jest członkiem i nie widzi niczyich połączeń.

## Usuwanie kart i odinstalowanie

Odinstalowanie aplikacji **nie usuwa kart** ze Stalwarta. Żeby usunąć karty synchronizowane z Twenty z własnej książki CRM:

- `POST <adres funkcji>/stalwart/purge` pokazuje, co zostałoby usunięte.
- `POST <adres funkcji>/stalwart/purge?confirm=true` usuwa.

Usunięcie jest trwałe po stronie Stalwarta (bez kosza). Karta usunięta ręcznie na telefonie wróci przy najbliższej synchronizacji, dopóki osoba istnieje w Twenty.

## Bezpieczeństwo

- Rola aplikacji czyta tylko `Person` i `Company` i nic nie zapisuje w Twenty. Ma też uprawnienie systemowe `ROLES`, potrzebne do odczytu ról i uprawnień do pól. To uprawnienie obejmuje w Twenty także zarządzanie rolami, dlatego kod musi pozostać tylko do odczytu.
- Jeśli któraś rola dostanie ograniczenia na poziomie rekordów dla `Person` albo `Person` przestanie być otwarty, synchronizacja zatrzymuje się dla wszystkich, książki CRM są czyszczone, a health check pokazuje błąd. Aplikacja nie zgaduje.
- Tokeny OAuth są tylko w połączeniach Twenty, a sekret klienta w zmiennych serwera. Nic z tego nie trafia do logów, `kv` ani odpowiedzi HTTP. Logi zawierają identyfikatory i liczniki, bez imion, e-maili i telefonów.

## Rozwiązywanie problemów

| Objaw | Co sprawdzić |
|-------|--------------|
| Przycisk Add connection jest nieaktywny | Brak `client_id` / `client_secret` w zmiennych serwera aplikacji. |
| Health check: ERROR "Contact sync is stopped" | Niewspierana konfiguracja uprawnień (predykaty wierszowe na `Person` albo `Person` nie jest otwarty). Cofnij ją. |
| Health check: WARNING o połączeniu | Członek musi ponownie dodać połączenie Stalwart. |
| Brak książki CRM | Czy dodano połączenie, czy `SYNC_ENABLED` nie jest `false`, czy rola członka czyta `Person`. |
| Funkcja zwraca błąd uwierzytelnienia | Uruchomiono ją kluczem API zamiast jako członek. |

## Lista kontrolna testu na telefonie (iPhone)

1. Dodaj konto CardDAV Stalwarta (Ustawienia, Kontakty, Konta).
2. Sprawdź, że grupa CRM jest widoczna i zawiera karty.
3. Polskie znaki w imionach, nazwiskach i firmach wyświetlają się poprawnie.
4. Telefon jest w formacie międzynarodowym i da się z niego zadzwonić.
5. Kategorie (typ i rola kontaktu) są widoczne na karcie.
6. Zmień osobę w Twenty i po kilku sekundach odśwież kontakty na telefonie.
7. Usuń osobę testową w Twenty i sprawdź, że karta znika.

## Rozwój

```
yarn test        # testy jednostkowe (Vitest)
yarn typecheck
yarn twenty plan # podgląd zmian metadanych bez zapisu
yarn twenty apply
```

Testuj wyłącznie na kontach testowych i danych syntetycznych.
