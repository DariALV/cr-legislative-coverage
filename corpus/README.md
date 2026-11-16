# Public corpus: legislative coverage in Costa Rican news (May–October 2026)

Which bills of Costa Rica's Asamblea Legislativa reached the news between May 1 and October 31, 2026, and how.
This folder holds the public dataset of the project (issues #44, #45 and #47): one SQLite file with the
Asamblea's bills, deputies and organs, the metadata of 29,875 news items from five outlets, the news–bill links
and the answers of the Jev evaluator that produced them. **It does not contain the text of any news item.**

The site built from the same data: https://darialv.github.io/cr-legislative-coverage

## Files

| File | What |
| --- | --- |
| `cr_legislative_coverage.zip` | The SQLite database (`cr_legislative_coverage.db`, ~300 MB unzipped) |
| `links.csv` | The `links` table with outlet and date, to browse without SQLite |
| `schema.sql` | Every `CREATE TABLE` and `CREATE INDEX` of the database |
| `SHA256SUMS` | SHA-256 of the zip, of the database inside it, of `links.csv` and of `schema.sql` |
| `LICENSE` | Terms of use (CC BY 4.0, with the exceptions listed there) |
| `reproduce.ipynb` | Notebook that checks the files and recomputes the main numbers and figures (#46). Needs `pandas` and `matplotlib` |
| `make_notebook.py` | Writes and runs `reproduce.ipynb` (`python corpus/make_notebook.py`) |

```bash
unzip cr_legislative_coverage.zip
sha256sum -c SHA256SUMS
sqlite3 cr_legislative_coverage.db "SELECT * FROM corpus_info"
```

In Python: `sqlite3.connect("cr_legislative_coverage.db")`, or `pandas.read_sql(query, connection)`.

The corpus is rebuilt with `python export_corpus.py` from the repository root. That script needs the
private database and Jev's results, which are not in git.

## Tables

### From the Asamblea Legislativa (SIL)

Official public data from the Sistema de Información Legislativa, copied exactly as stored. How it was
collected and cleaned is described in `docs/bills.md` and `docs/asamblea.md`.

| Table | Rows | One row per |
| --- | ---: | --- |
| `bills` | 5,898 | bill (expediente) 20000–25897: name, type, filing date, status (`in progress`, `archived`, `law`), law number, deadlines, administrative/honorific flag |
| `bill_steps` | 100,824 | step of a bill's procedure: organ, description, start and end dates |
| `bill_subjects` | 103,102 | SIL descriptor (subject) of a bill |
| `bill_proponents` | 25,240 | signer of a bill, with signing order and `deputy_id` when matched |
| `bill_texts` | 5,898 | bill: the *exposición de motivos* of the base text (as filed), with word counts. `status` is `ok`, `no_exposition` or `no_text` |
| `laws` | 10,983 | law of the Republic, with the bill it came from |
| `deputies`, `deputy_terms`, `deputy_factions`, `deputy_replacements` | 235, 260, 282, 15 | deputy per term; faction at the time; replacements |
| `deputy_bills` | 27,937 | bill signed by a deputy |
| `organs`, `organ_memberships`, `organ_bills` | 1,880, 5,230, 1,094 | committees and other organs, their members, and the bills they handled |

### News metadata

| Table | Rows | One row per |
| --- | ---: | --- |
| `news_articles` | 29,875 | news item: `id` (SHA-256 of the URL), `url`, `organization` (outlet), `title`, `date_published` (Costa Rica local time, no time zone), `author` (byline as published, empty for 2,225), `section`, `outlet_type` (`general` or `specialized`), `extraction_status` (`Partial` for the 177 whose text could not be read) |
| `news_bill_links` | 1,425 | link that a Delfino news item makes to a bill's page on Delfino (`source = 'link'`). The "gold" set used to tune the ranker |

| Outlet | `organization` | News |
| --- | --- | ---: |
| CRHoy | `crhoy` | 9,442 |
| La Nación | `nacion` | 9,424 |
| Delfino (specialized in the Asamblea) | `delfino` | 5,399 |
| El Mundo CR | `elmundo` | 3,388 |
| Semanario Universidad | `semanario` | 2,222 |

How each outlet was collected, filtered and cleaned: `docs/news.md`.

### Links and Jev's answers

Each news item goes through three stages. The Jev evaluator (TypeSafe, model `jev-1.14.0`) answers every
question with a probability for each option.

1. **Filter** (`jev_filter`, 29,698 rows: every news item with text). `assembly` is the probability that the
   item is about the Asamblea. It passes when `assembly >= 0.2` (7,431 items). `cut` = 1 when the text was cut
   to 15,000 characters.
2. **Candidates and gate** (`jev_candidates`, 371,876 rows). For each item that passed: the top 50 bills of the
   ranker (`source = 'ranker'`, with `rank` and `score`) plus any bill named by number outside that top 50
   (`source = 'explicit'`, 326 rows). For each candidate Jev answers two questions. `explicit`: the item
   identifies the bill by number, official name or nickname. `implicit`: the item covers the bill without naming
   it. `match` = 1 when either one is >= 0.5.
3. **Detail** (`jev_details`, long format, 512,290 rows). Questions about each matched pair (`bill_number` set)
   and about each item that has a match (`bill_number` empty): centrality, stance, stage of the procedure, voices
   quoted, position attributed to each party, framing, and more. For each question there is one row per option,
   with its `probability`. `choice` and `confidence` hold the winning option. `score` and `score_01` hold the
   value of scale questions, raw and scaled to 0–1.

`jev_questions` has the exact wording and options of every question (`stage` = `gate`, `details_news` or
`details`). `jev_news` has the genre that Jev gave each filtered item (news report, opinion, interview, analysis).

**`links`** (6,418 rows) puts it together: one row per (news item, bill) that Jev matched (`jev_match`, 6,329)
or that the outlet itself linked (`outlet_link`, 1,425; 1,336 pairs are both). The table carries two coverage
levels:

| Level | Rule | Pairs | News items |
| --- | --- | ---: | ---: |
| `mention` | `jev_match` and (`explicit >= 0.5` or `implicit >= 0.75`) | 4,671 | |
| `substantive` | `mention` and `centrality >= 0.25` | 3,462 | 2,620 |

The site publishes the substantive links only. Precision measured on samples: ~78–85% for mentions and ~88–91%
for substantive links.

### Other

| Table | What |
| --- | --- |
| `corpus_info` | Build date, period, model, thresholds and row counts |

## Collection

- **Period:** news published May 1 – October 31, 2026 (Costa Rica time). The SIL data was extracted on
  November 6–7, 2026, and covers every bill from 20000 (2016) to 25897, regardless of date.
- **News:** five outlets, scraped from their sitemaps or WordPress API. Only the public fields above are
  published. The body of each item was used to run the models and is kept private.
- **Matching:** embeddings (qwen3-0.6b) plus an evolved ranker propose 50 candidate bills per item, and Jev
  decides. Recall of the 50 candidates on the gold set: 0.954.
- **Cost of Jev over the corpus:** US$1.54 for the filter plus US$11.51 for the gate and the detail.

## Limitations

- **Votes are not included.** The per-deputy votes come from Delfino, whose terms of use forbid
  reproducing and redistributing its content. Official votes are in the Asamblea's plenary minutes.
- **Links are model output, not ground truth.** Jev counts background mentions of laws already in force as
  matches (the main source of false positives), and confuses sibling bills with the same name (e.g. 25400 and
  25800). Recall of the published (substantive) links on the hand-labeled sample is ~0.67 (62 positive pairs;
  the sample also counts passing mentions, which the site leaves out on purpose), so about a third of the
  coverage is missing. Counting every match at threshold 0.5, recall is ~0.87.
- **The sample is small and was pre-labeled with signals close to the ranker's** (TF-IDF, SIL activity), so the
  recall may be optimistic. Jev's questions were tuned while looking at that sample.
- **Republished items are not deduplicated:** 80 Delfino URL pairs (`url` / `url-2`, where the second one is a
  summary) and 101 La Nación republications.
- **Boilerplate** (opinion disclaimers, AI notices, El Mundo's data line) stayed in the text the models read.
- **Texts longer than 15,000 characters** were cut before going to Jev (126 of the filtered items).
- **Comparisons between outlets or parties** are out of the project's scope. With 12–19 labeled positives per
  outlet, the sample cannot rank outlets.
- **Stance and party positions** are what the news conveys, as read by a model, not the parties' actual votes.

## Privacy and ethics

- No news text, description or excerpt. Titles and URLs identify each item. The text stays with the outlet.
- Deputies appear only in their public role (name, term, faction, province, seat, committees). No national ID
  numbers (cédulas) or contact data.
- Two of Jev's questions (`headline_misleading`, `author_judges`) judge the outlet's work. They were left out of
  the corpus.
- The raw API answers and the notes of the human evaluation are not published.
