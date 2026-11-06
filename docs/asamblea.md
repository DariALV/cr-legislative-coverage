# Asamblea SIL: deputies and organs

How deputies and legislative organs (commissions, Plenario, Directorio…) are collected from the Asamblea Legislativa's SIL and stored. Issue: #65. Source findings: #19. Bills from SIL: #66.

## Source

- **Site:** the SIL (Sistema de Información Legislativa), `https://produccion.asamblea.go.cr/SILConsulta/`. The public page `asamblea.go.cr/Centro_de_informacion/Consultas_SIL` only frames it.
  - It is the Asamblea's production database, with official data.
  - Site content is licensed CC BY 4.0.
- **Access:** no login. Requests run as the anonymous user `USR_SIL_ANONIMO`.
- **How it serves data:** a stateful ASP.NET app. `AsambleaFetcher` follows the same steps as the browser:
  1. `GET Monitor/Principal` sets the session cookie.
  2. `POST SIL_<MODULE>_PRINCIPAL` opens the screen (window) in the session.
  3. `POST SIL_<MODULE>_PRINCIPAL/Contexto` selects a deputy, organ or legislature. The server keeps the selection.
  4. `POST Utilidades/DescargarArchivoPlano` exports a screen's query as a whole CSV. This is the "Descargar CSV" button, and it returns every row with no paging.
  - Form fields are sent as `base64|<base64>`, with headers `sistema: SIL`, `basedatos: SIL`, `diseno: DT`.
  - The export only accepts columns the query already returns.
  - Form tabs (queries named `C_ff_…`, e.g. a deputy's "Información general") can't be exported. Their rows are read from the data embedded in the tab's window and cached as a CSV with the same layout.
- **Cache:** every CSV goes under `raw/csv/asamblea/<deputies|organs>/` (file name = SHA-256 of the key, e.g. `1127/positions`).
  - Writes are atomic (temp file + rename).
  - Cached files are never downloaded again, unless `refresh_before` is given.
- **Politeness:** 1 request per second, user agent `uni-project`, one session.
  - `produccion.asamblea.go.cr` has no `robots.txt` (404).
  - Its pages say `noindex, nofollow, noarchive`, which is aimed at search engines.
- **HTTPS:** the server leaves the GlobalSign intermediate certificate out of its chain. The fetcher verifies against certifi plus that public certificate, kept in `tools/scraping_tools/certs/` (see the README there).

## Running

```python
from pipeline import Pipeline
Pipeline().scrap_and_save_asamblea()   # optional: refresh_before = datetime(...), deputies_since = datetime(...)
```

1. **Deputies block:** the deputies list (1 request), then every tab of each selected deputy term (1 context + 6 tabs).
2. **Organs block:** the organs list (1 request), then "Expedientes que atiende" for each active organ (1 context + 1 export).
3. **Tables:** every SIL table is rebuilt from the cache, in one transaction.

- **Stopping and resuming:**
  - Ctrl+C or a network failure stops the downloads, and the tables are still rebuilt with what is cached.
  - The next run skips everything cached and continues where the last one stopped.
  - A deputy or organ that fails is warned about and retried on the next run.
- **Expired session:** a request that comes back as an error page or `SesionCaducada` is retried once on a new session, with the window and context set again.

## Scope

- **Deputies:** every deputy term still running on or after **13/06/2016** (`Config.DEPUTIES_SINCE`), the filing date of bill 20000 (`Config.FIRST_BILL`).
  - Terms are fixed (May 1 to April 30, four years), and deputies can't be re-elected for the next term (Constitution, art. 107).
  - The rule keeps the 2014-2018, 2018-2022, 2022-2026 and 2026-2030 terms, including replacements who joined mid-term. Earlier terms couldn't sign or handle any bill from 20000 on.
  - Earlier terms of the selected people are still listed in `deputy_terms`.
- **Organs:** the whole list (1,880 organs, all legislatures; the list is the same whatever legislature is selected).
  - "Expedientes que atiende" is fetched only for the 37 active organs, since dissolved ones hold no bills.
  - The organs' members come from each deputy's Puestos tab, not from each organ × legislature (same data, far fewer requests).
- **Not stored:**
  - Cédulas: they are needed to select a deputy, so they are read in memory and never cached or stored.
  - The organs' "Personal soporte" tab (names of support staff).
  - Plenary minutes.

## Tables (private corpus)

| Table | One row per | Fields |
|---|---|---|
| `deputies` | deputy term (`IdDIPUTADO`) | `deputy_id`, `person_id`, `surnames`, `names`, `term` ("2018-2022"), `province`, `seat` (placa), `status` ("VIGENTE"/"NO VIGENTE"), `date_from`, `date_to`, `date_extracted` |
| `deputy_factions` | person × faction stint | `person_id`, `faction_id`, `term`, `faction`, `province`, `date_from`, `date_to` |
| `deputy_terms` | person × term (Administraciones) | `person_id`, `term`, `province` |
| `deputy_replacements` | replacement | `person_id`, `detail`, `name`, `date` |
| `deputy_bills` | deputy term × bill signed (Expedientes presentados) | `deputy_id`, `bill_number`, `proponent_id`, `term` |
| `organs` | organ | `organ_code`, `organ_id`, `organ_type`, `name`, `date_constituted`, `date_dissolved`, `status`, `date_extracted` |
| `organ_memberships` | position of a deputy term in an organ (Puestos) | `membership_id`, `deputy_id`, `organ_code`, `organ_name`, `position`, `legislature` (one year, "2019-2020"), `date_joined`, `date_left` |
| `organ_bills` | bill held by an active organ today (Expedientes que atiende) | `organ_code`, `bill_number`, `date_start`, `date_end`, `last_step`, `date_extracted` |

- **Joins:**
  - `deputies.person_id` = `deputy_factions.person_id` = `deputy_terms.person_id` = `deputy_replacements.person_id`.
  - `deputy_bills.deputy_id` and `organ_memberships.deputy_id` → `deputies`.
  - `organ_memberships.organ_code` and `organ_bills.organ_code` → `organs`.
  - `bill_number` has no foreign key, like `news_bill_links`: bills from SIL come in #66, and today's `bills` table (Delfino) misses some numbers.
- **Dates** are ISO dates (`YYYY-MM-DD`). The SIL gives `dd/mm/yyyy 00:00:00`, always with no real time.

## Source quirks

- **One row per faction stint:** the deputies list has one row for each stint, so a deputy who changed faction (e.g. became independent) is listed twice in the same term with the same `IdDIPUTADO`. Rows are merged per `IdDIPUTADO`, keeping the first `Desde` and the last `Hasta`.
- **Two kinds of tab:**
  - Per term: Expedientes presentados and Puestos.
  - Per person (every term of that person): Fracciones, Administraciones and Reemplazos. A person with two selected terms gets these rows once.
- **Person id:** `IdCEDULA` is the SIL's internal person id (e.g. 949 for the same person in 2010-2014 and 2018-2022), not the cédula. It is used as `person_id`.
- **Faction id:** `IdFRACCION` identifies the faction, e.g. 43 = Liberación Nacional in every term. It does not identify the stint.
- **Organ codes:**
  - Permanent organs use small codes (100 Directorio, 101 Agropecuarios…).
  - Special commissions often use the number of the bill or motion that created them (e.g. 25839).
  - Code 0 ("COMISION NO DEFINIDA") appears in some positions.
- **Snapshot:** "Expedientes que atiende" is what each organ holds on the day of the download, not a history. Selecting a past legislature returns nothing. A bill's full path through organs comes from its Tramitación (#66).
- **Texts:** the SIL pads many texts with spaces, so they are stripped and inner runs of spaces collapsed. Exports come in Windows-1252 and are cached as UTF-8.
