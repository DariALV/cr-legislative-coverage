# Bills: collection and cleaning

How the legislative bills (expedientes) and their Plenario votes are collected and cleaned. Input for the report and the datasheet (#47). Issues: #66 (bills from SIL), #22 (votes), #21 (flags), #23 (refresh), #19 (sources and terms).

## Sources

- **Bills:** the Asamblea Legislativa's SIL (`https://produccion.asamblea.go.cr/SILConsulta/`). It is the official source, licensed CC BY 4.0. How the SIL serves data, the cache, HTTPS and politeness are described in `docs/asamblea.md`.
- **Votes:** Delfino (`https://delfino.cr/asamblea/votaciones`). The SIL lists votes only as dated steps, with neither the result nor the deputies, so the per-deputy votes still come from Delfino.
- **Why not Delfino for bills anymore** (#19, #66):
  - Delfino is a private compilation whose terms reserve all rights, while the SIL is the official, licensed record.
  - Delfino misses 624 bills in 20000–20999 and 236 laws of our range.
  - It rewrites some titles (e.g. 20486: "Acuerdo entre Costa Rica y Turquía sobre cooperación cultural" for the official "APROBACIÓN DEL ACUERDO ENTRE EL GOBIERNO DE LA REPÚBLICA DE COSTA RICA Y EL GOBI…").
  - Delfino is also one of the news outlets we measure, and it was recommended not to take the bills from an outlet whose coverage is being measured.

## Range

- **From bill 20000 (`Config.FIRST_BILL`) on**, by number, not by date: news in the period also discuss bills filed years earlier.
  - 20000 was filed on 13/06/2016, ten years before the data period (May–October 2026).
  - Bills expire after four years unless extended (art. 119). Of the 1,094 bills the active organs held in November 2026, only 3 were numbered below 20000 (two of them querellas, not bills).
- **Master list:** the SIL's bills list (one CSV with all 21,977 numbers and titles, from 1960) gives exactly which numbers exist, with no gaps from 20000 on. It is downloaded again on every run, since new bills are filed daily.

## Running

```python
from pipeline import Pipeline
Pipeline().scrap_and_save_asamblea()   # deputies, organs, then bills (see docs/asamblea.md)
```

- **Bills block:**
  1. The laws list and the bills list are downloaded (2 requests).
  2. Each bill gets 1 context + 4 tabs: General, Tramitación, Proponentes, Materias.
  3. The bills are split round-robin between `Config.ASAMBLEA_SESSIONS` (3) SIL sessions in parallel, each at 1 request per second, so about 5,900 bills take ~3 h.
  4. Then each bill's base text ("Texto base", 2 requests), with the same sessions: ~65–80 min for every bill. See "Base texts" below.
- **Stopping:** Ctrl+C asks every session to finish its current bill, then builds the tables from the cache. The next run skips the cached bills.
- **Votes** run with the news, in `main.py`: the Delfino thread reads the votes list, then the vote pages.

## Tables (private corpus)

| Table | One row per | Fields |
|---|---|---|
| `bills` | bill | `number`, `name` (official title), `file_type`, `date_proposed`, `law_number`, `archive_number`, `date_expiry`, `date_expiry_four_year`, `status`, `flag`, `date_extracted` |
| `bill_proponents` | signer | `proponent_id`, `number`, `name`, `term`, `signing_order` (1 = main signer), `deputy_id` |
| `bill_steps` | step of the Tramitación | `step_id`, `number`, `organ`, `description`, `date_start`, `date_end` |
| `bill_subjects` | bill × subject (Materias) | `number`, `subject_code`, `subject` |
| `bill_texts` | bill whose base text was downloaded | `number`, `status` (`ok`, `no_exposition`, `no_text`), `exposition`, `total_words`, `exposition_words` |
| `laws` | law | `law_id`, `law_number`, `bill_number`, `title` |
| `votes` | Plenario vote | `vote_id`, `number`, `date`, `name`, `description`, `result`, `url` |
| `vote_deputies` | vote × deputy | `vote_id`, `slug`, `name`, `party`, `seat`, `vote`, `deputy_id` |

- **Joins:**
  - `bill_proponents.deputy_id` and `vote_deputies.deputy_id` → `deputies` (`docs/asamblea.md`).
  - `organ_bills.bill_number` → `bills.number`: the organ holding each bill today.
  - `votes.number` → `bills.number`. There is no foreign key: Delfino may list votes of bills not stored yet.
- **`news_bill_links`** is unchanged: the bills a Delfino news article links to.
- **Dates** are ISO dates.

### What each field holds

- **`status`** is derived, since the SIL has no status field:
  - `law` when the laws list ties a law to the bill;
  - `archived` when it has an archive number;
  - otherwise `in progress`.
  - A bill whose General tab isn't downloaded yet has no status.
- **`archive_number`:** as the SIL writes it. Two bills have it oddly written (`16605.1`, `16335.`); they keep only the integer part, with a warning in the run log.
- **`law_number`:** taken from the laws list. One bill produced two laws; it keeps the lowest number, and both are in `laws`.
- **`laws`** has one row per law × bill: a few old laws merged several bills (e.g. law 4347 of 1969 came from 4), so the same law can appear more than once.
- **`date_expiry` / `date_expiry_four_year`:** the ordinary deadline and the four-year deadline (art. 119), as the SIL computes them.
- **Proponents:**
  - Written as the SIL does (surnames, then names), with their term and signing order.
  - `deputy_id` is matched by name and term against `deputies`, which hold the same names, so no cédula is needed.
  - Signers that aren't deputies (e.g. the executive) and deputies from terms before 2016 stay unmatched.
- **Steps:** the full Tramitación in every organ: presentation, commission assignment, reports (dictámenes), debates, votes as steps, archive and its reason.
- **Subjects:** the SIL's official descriptors (e.g. `BECA`, `DECLARATORIA`, `DESAFECTACION`). They replace Delfino's categories. Recent bills may have none yet.
- **Votes:**
  - Each vote has its kind (e.g. "Primer debate", "Moción de fondo", "Dispensa de trámites (art. 177)"), what was voted, the date and the result ("Aprobado", "Rechazado", "Anulado").
  - `vote_id` is the last part of the Delfino vote url (e.g. `20261105007`).
  - Only Plenario votes: Delfino doesn't list committee votes.
- **Deputy votes:**
  - `vote` is `for`, `against` or `absent`. Other labels are kept as Delfino writes them (elections, "Abstención", "Ausente (pierde dieta)"…); the suggested mapping is in #22.
  - `deputy_id` is matched to the deputy in office on the vote date, by name: exact name, then the same words in any order, then a single deputy whose name holds every word.

## Base texts (#32)

The SIL has no summary of a bill, so the text matched against news is the **exposición de motivos** of its "Texto base": the text the bill was filed with.

- **Download:** the "Texto base" button of the bills screen gives a .docx (see `docs/asamblea.md`). It is read in memory and only its text is kept, one line per paragraph, in `raw/text/asamblea/bills/<number>.txt` (not in git). The .docx files would take about 1.2 GB (about 200 KB each, some 1–3 MB with images).
- **Exposición de motivos:** from the line "ASAMBLEA LEGISLATIVA:" to the first "DECRETA" or "ACUERDA" after it. Lines are compared without spaces and in upper case.
  - Proyectos de acuerdo (e.g. Reglamento reforms, ciudadano distinguido) end with "ACUERDA" instead of "DECRETA".
  - The heading "LA ASAMBLEA LEGISLATIVA DE LA REPÚBLICA DE COSTA RICA" right before it is left out.
  - It usually ends with the formula that submits the bill ("Por las razones expuestas, sometemos…").
- **Only the exposición is stored** in `bill_texts`. The full text (title page, proponents, articles) stays in the raw cache, so it can be rebuilt without downloading again.
- **Status:**
  - `ok`: the exposición was found.
  - `no_exposition`: there is a text but without the markers, e.g. the budget bill ("its content is not included in the system") or special investigating commissions (only a note).
  - `no_text`: the SIL has no text for the bill ("[30016] No existe un texto asociado").
  - No row: not downloaded yet, e.g. because the bill's General tab is missing.
- **Probe before the full run** (sample of 51 bills, half from `news_bill_links`): the exposición was found in 48 (94 %), 2 had no exposición and 1 had no text. It has a median of 1,412 words and a maximum of 4,199 (about 6,000 tokens), so it always fits a model's 8,192-token limit.

## Collecting the votes

- **Votes list:** `delfino.cr/asamblea/votaciones?pagina=N`, 10 votes per page, newest first, from 2019 (~1,100 pages).
  - Each card gives the bill number, the kind of vote, what was voted, the date and the result, so Delfino's bill pages are no longer needed.
  - What has been read is saved in `raw/links/delfino/votes_list.json`.
  - Until the whole list has been read once, each run continues from the last page read; newer votes only push older ones to later pages, so none is missed.
  - After that, each run reads from page 1 until a page brings no new vote.
- **Vote pages:** `delfino.cr/asamblea/votaciones/proyecto/<vote_id>` list every deputy under "A favor", "En contra" and "Ausente".
  - They are cached in `raw/html/delfino/asamblea/votes/`; the cache from the old bill-page walk is reused.
  - A vote doesn't change once published, so a cached page isn't read again. The exception is a cached page with no deputies while the vote is less than 30 days old: Delfino may not have loaded them yet, so it is read again on the next run.
  - A few votes never show a breakdown (e.g. "Convertir el Plenario en comisión (art. 205)"); they are kept without deputies and reported.
  - Only votes of bills from 20000 on are kept.
- **Politeness:** 1 request per second, user agent `uni-project`. Delfino's robots.txt allows `/asamblea/` for `*`.

## Administrative and honorific bills (#21)

Some bills almost never make the news, so they would inflate the "no coverage" count. They are **flagged, not dropped** (`bills.flag`), so coverage can be reported with and without them. The rules are in `tools/scraping_tools/bill_flags.py`. Since #66 they use the SIL's procedure type and official title instead of Delfino's categories.

- **`honorific`** applies when either is true:
  - the procedure is "PROCEDIMIENTO PROYECTOS DE COMISION DE HONORES";
  - the title matches an honorific pattern: benemeritazgo, ciudadano distinguido, naming a building or place, national day or week (with the verb before or after it), efeméride, national symbol, folk city, or a declaration of interest or of a "ciudad".
  - "Benemérito Cuerpo de Bomberos" and "Benemérita Cruz Roja" are institution names, so they are removed from the title before matching.
- **`administrative`** applies when either is true:
  - the procedure is "PROCEDIMIENTO SOLICITUDES DE ATRAQUE Y DESEMBARQUE";
  - the title names a property operation or a permit. Property operations: segregate, donate, desafectar, transfer, swap, change of use. Permits: foreign ships docking, sailing through or landing crews.
- **Honorific wins** when both apply (e.g. naming a donated building).
- **Not used:** the SIL's subjects are broad descriptors. For example, "BENEMERIT,-O/-A" also tags a donation by the Bomberos, and requiring a matching subject lost true flags.
- **Check against the old Delfino-based flags:** on a sample of 155 of the 500 test bills (25398–25897: all 55 flagged plus 100 unflagged), the new rules agree on 154.
  - The one difference is 25481 "Declaratoria de interés público para la enseñanza del idioma portugués", now `honorific`. That is consistent with the rule for declarations of interest; Delfino had categorized it differently.
- **Not flagged on purpose:**
  - Debt condonations and housing programs are policy.
  - Appointments and investigative commissions get press coverage. They can be filtered by `file_type` if needed.
- **On the titles of every bill from 20000:** 318 `honorific` and 475 `administrative` out of 5,898 (13 %). The procedure type adds a few more once the bills are downloaded.

## Known quirks

- **No summary:** the SIL has no equivalent of Delfino's "Propósito del Proyecto". For matching news to bills, the bill is represented by its official title, its subjects and the exposición de motivos of its base text (see "Base texts").
- **Commission:** there is no "current commission" field.
  - The organ holding a bill today is in `organ_bills` (a snapshot).
  - Its history is in `bill_steps`.
- **Official titles** are upper case and may carry stray spaces or line breaks; they are stripped.
- **Proponent names** are the SIL's. Delfino's names (in `vote_deputies`) are written differently (names first, mixed case, sometimes without a second name), hence the matching rules above.
- **Votes without a bill:** cards with no "Expediente" number are skipped and logged.

## Delfino data before #66

- Until #66, bills came from Delfino's bill pages (`raw/html/delfino/asamblea/bills/`). Those pages and their link list were deleted after the switch to the SIL.
- The old tables `bill_categories`, `bill_events` and `bill_votes`, and the Delfino columns of `bills`, are dropped the first time the new tables are created.
- Delfino's per-deputy votes are rebuilt from its votes list and the cached vote pages.
