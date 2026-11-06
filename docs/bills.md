# Bills: collection and cleaning

How the legislative bills (expedientes) are collected from Delfino and cleaned. Input for the report and the datasheet (#47). Issues: #5, #21, #22, #23, #24.

## Source

- **Pages:** `https://delfino.cr/asamblea/proyecto/<number>`, one per bill. Parsed by `BillParser`.
- **Range:** collected by bill number, not by date, from `Config.FIRST_BILL` (20000) upwards. News in the period also discuss bills filed years earlier.
  - The walk stops after `Config.MAX_CONSECUTIVE_ERRORS` (5) errors in a row past the last bill already collected, or at `max_bill`.
- **Cache:** every page is saved under `raw/html/delfino/asamblea/bills/` (file name = SHA-256 of the url). Later runs read the cache and don't fetch again.
- **Politeness:** 1 request per second, user agent `uni-project`. Delfino's robots.txt allows `/asamblea/` for `*` and sets no crawl-delay.
- **Terms of use:** see #19. Delfino is a private compilation of public records, and its terms reserve all rights. The official source is the Asamblea's SIL (CC BY 4.0).

## Tables (private corpus)

| Table | One row per | Fields |
|---|---|---|
| `bills` | bill | `number`, `name` (title), `description` (Propósito del Proyecto), `file_type` (Tipo), `status` (Estado), `commission` (Comisión), `date_proposed` (Presentado), `law_number` (Número de Ley), `flag`, `date_extracted` |
| `bill_categories` | bill × category | Delfino's own categories. `-` means none. |
| `bill_proponents` | bill × signer | `slug`, `name`, `role` (`main` = Firma Principal, `co` = Co-proponentes), `kind` (`deputy` or `special`), `party`, `position`, `province`, `seat` |
| `bill_events` | bill × history entry | `event_type` (`text` = Histórico de Textos, `vote` = Histórico de Votaciones), `position` (page order per type), `date`, `name`, `description`, `result`, `url` |
| `news_bill_links` | news × bill | Bills a Delfino news links to (`source = "link"`). Not a foreign key: a news item can cite a bill that isn't collected yet. |

### What each field holds

- **`kind = "special"`:** a signer that isn't a deputy and links to `/asamblea/perfiles-especiales/`. Examples:
  - the executive ("Gobierno Chaves Robles", "Gobierno Fernández Delgado");
  - "Poder Judicial";
  - "Contraloría General de la República".
  - Special signers have no party, province or seat.
- **Text events:** the date and the kind of document, e.g. "Texto base", "Criterio Servicios Técnicos", "Informe de Mayoría", "Texto final". `url` points to the PDF.
- **Vote events:** the kind of vote (e.g. "Primer debate", "Moción de fondo", "Dispensa de trámites (art. 177)"), what was voted (`description`), the date and the `result` ("Aprobado", "Rechazado", "Anulado"). `url` points to Delfino's vote page. Individual votes per deputy are not collected.

## Refreshing (#23)

- **Why:** status, commission, law number, proponents and history change over time. A cached page is a snapshot from the day it was downloaded.
- **How:** run `Pipeline().scrap_and_save(..., refresh_bills_before = <datetime>)`.
  - Every cached bill page saved before that moment is downloaded again.
  - Pages already refreshed are kept, so an interrupted refresh resumes where it stopped.
- **Database:** `insert_bill` is an upsert (`ON CONFLICT DO UPDATE`). Categories, proponents and events are deleted and inserted again for each bill, so the database always matches the latest page.
- **Cost:** a full refresh of about 5,200 bills at 1 request per second takes roughly 1.5 h.

## Cleaning criteria

- **Title:** the part of `og:title` after `" - "`.
- **Zero-width characters:** removed from proponent fields. Delfino puts them in positions such as "Jefe​ de fracción​".
- **Dates:** parsed from Spanish text ("14 de abril de 2026"). Both "setiembre" and "septiembre" are accepted.
- **Law number:**
  - `law_number` is set only for bills that became law.
  - Thousands separators and the "(VETADO)" suffix are removed.
  - One malformed value ("6933-22-23") is stored as null.
- **Unreadable pages:** a page whose layout can't be parsed is reported and skipped, and the walk goes on.

## Administrative and honorific bills (#21)

Some bills almost never make the news, so they would inflate the "no coverage" count. They are **flagged, not dropped** (`bills.flag`), so coverage can be reported with and without them. The rules are in `tools/scraping_tools/bill_flags.py`.

- **`honorific`** applies when either is true:
  - the bill has the category "Declaratorias y Benemeritazgos";
  - the bill has no category (`-`) and its title matches an honorific pattern: benemeritazgo, ciudadano distinguido, naming a building or place, national day or week, efeméride, national symbol, declaration of interest or of a "ciudad".
- **`administrative`** applies when the title names a property operation or a permit, **and** the bill either:
  - has the category "Autorizaciones, donaciones y segregaciones",
  - has no category, or
  - is an "Acuerdo Legislativo".
  - Property operations: segregate, donate, desafectar, transfer, swap, change of use. Permits: foreign ships docking, sailing through or landing crews.
- **Not flagged on purpose:**
  - Debt condonations and housing programs share the "Autorizaciones" category but are policy.
  - Appointments (`file_type` "Nombramiento por la Asamblea Legislativa") and investigative commissions ("Comisiones") get press coverage. They are left unflagged and can be filtered by `file_type` if needed.
- **Result on the 500 test bills (25398–25897):** 26 honorific, 29 administrative, 445 unflagged.
  - Titles alone are not enough. "Benemérito Cuerpo de Bomberos" and "Benemérita Cruz Roja" are institution names inside policy bills, which is why title patterns only apply to bills with no category.

## Known quirks

- **Only the last commission:** `commission` is the current one. Delfino shows no history of earlier commissions, and some bills show "Pendiente" or "Plenario".
- **Purpose text:**
  - "Propósito del Proyecto" is Delfino's own summary, not the official text.
  - It doesn't always match the bill (known quirk listed in #24, not measured yet), so don't rely on it alone for matching.
  - It must not be published (#19).
- **Optional fields:** law number, commission and categories can be missing. Many bills only have the category `-` (53 of the 500 test bills).
- **Bills without a main signer:** 12 of the 500 test bills have no Firma Principal. Most are investigative commissions, which are created by a motion.
- **Party:**
  - `party` is the logo Delfino shows today, not necessarily the party the deputy had when signing.
  - Deputies who left their faction appear as "Independiente".
- **Legislatures:** bills from the 2022–2026 legislature are signed by deputies of that legislature. The current one started on May 1, 2026. The slug identifies a person across bills.
- **Vote history:** it lists plenary and procedural votes as Delfino records them. Bills with no votes show "No hay votaciones registradas".

## Test run (Nov 5, 2026)

- **Scope:** the 500 cached bills 25398–25897.
- **Result:** all 500 parsed with no errors.
  - 2,067 proponents: 62 of them special (the executive, the judiciary, the comptroller).
  - 605 events: 543 text and 62 vote.
  - 7 bills have no text history.
