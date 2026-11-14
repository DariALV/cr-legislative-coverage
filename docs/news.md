# News: sources and cleaning

How the news articles are collected, filtered and cleaned. Input for the report and the datasheet (#47). Issues: #11 (choice of outlets and terms of use), #3 #4 (CRHoy), #12 #13 (El Mundo CR), #14 #63 (La Nación), #62 (Semanario Universidad), #15 (Delfino), #17 (period), #16 (cleaning), #18 (this document).

## Outlets

| Outlet | `organization` | `outlet_type` | How it is collected | News in the corpus |
|---|---|---|---|---|
| CRHoy | `crhoy` | general | sitemaps + article HTML | 9,442 |
| La Nación | `nacion` | general | daily Arc sitemaps + article HTML | 9,424 |
| Delfino | `delfino` | specialized | yearly sitemaps + article HTML | 5,399 |
| El Mundo CR | `elmundo` | general | WordPress REST API | 3,388 |
| Semanario Universidad | `semanario` | general | WordPress REST API | 2,222 |
| **Total** | | | | **29,875** |

- **Why these outlets** (#11): over a 14-day window (2026-10-21 → 11-03) each candidate was measured by how many articles were about the Asamblea and how many cited a bill number.
  - El Mundo CR and La Nación joined CRHoy as the general outlets.
  - Semanario Universidad replaced El Observador, which had half the density and a third of the bill citations.
  - Discarded: Noticias UCR, La República, Diario Extra, Teletica, Repretel.
- **Delfino is specialized** and is always reported apart from the general outlets. It covers the Asamblea closely (about 3 in 4 of its legislative articles cite the bill number), and it is also the source of the per-deputy votes (`docs/bills.md`). Its news link to bill pages (`/asamblea/proyecto/<number>`), and those links are stored in `news_bill_links` (1,425 links). They are the "gold" set used to tune the ranker (#41 #68).

## Period

- **May 1 to October 31, 2026**, Costa Rica local time (`Config.DATA_PERIOD`, #20). Every date in the project is local time with no time zone (UTC-6, no daylight saving).
- Collection is by date. The sitemaps and REST pages are read with some margin, and the exact period filter runs after parsing, on `date_published`. All 29,875 stored news fall inside the period (#17).
- **Time zones differ by outlet:**
  - Delfino, La Nación and the WordPress outlets (`date_gmt`) publish real UTC, converted to local time.
  - CRHoy labels its local time with a `Z`. The suffix is ignored, not converted.
  - La Nación's sitemaps group articles by UTC day, and a Costa Rica day ends at 06:00 UTC the next day, so the day after the period end is also read.

## Running

```python
from pipeline import Pipeline
Pipeline(board).scrap_and_save(scrap_urls = True, scrap_new_htmls = True)   # what main.py runs
```

- Each website runs in its own thread with its own rate limit: 1 request per second, 20 s for Semanario (its robots.txt crawl-delay). User agent `uni-project`. 5 retries, 10 s timeout.
- Raw HTML and REST responses are cached under `raw/` (outside git). A second run reuses the cache, so an interrupted run resumes. `scrap_urls = False` reuses the collected urls in `raw/links/`.

## Collection, outlet by outlet

- **CRHoy** (#3 #4): every sitemap in `crhoy.com/sitemap.xml` except the news and video sitemaps, keeping urls modified on or after the period start. The article is the `NewsArticle` JSON-LD (title, description, date, author), and the body is the text of `div.wp-article`, with `(CRHoy.com)` removed.
- **La Nación** (#14 #63): the daily Arc sitemaps (`/arc/outboundfeeds/sitemap/YYYY-MM-DD/`). Metadata from the JSON-LD, body from `.article-body-wrapper`, without image captions and without the zero-width characters that pad paragraphs.
  - **Paywall:** every article is marked `isAccessibleForFree: false`, but the paywall is applied in the browser and the HTML has the full body.
  - **Agency content is skipped** (terms of use): an article is dropped when a byline is an agency or third-party outlet (AFP, EFE, AP, Reuters, Europa Press, DPA, NYT, El País, BBC…). Arc's `distributor` field doesn't mark them, so the byline is the only signal. In a test week, 7 of 242 articles were skipped and no false positives were seen.
- **El Mundo CR** (#12 #13) and **Semanario Universidad** (#62): the WordPress REST API (`/wp-json/wp/v2/posts`), 100 posts per request, with the full body in `content.rendered`. Category ids are mapped to names. Categories that only mark placement (home page, print edition, breaking news) are not sections.
  - Semanario: the weekly cartoon ("El chancletazo") and image-only posts are skipped; in-article ads are removed; posts with a broken `1970-01-01` date are dropped. Its bylines come from a plugin whose endpoint is closed, and the WordPress user is the uploader, not the journalist, so `author` is always empty (a known gap, left as is: #16, data 2026-11-09).
  - The honeypot urls disallowed in Semanario's robots.txt are never requested.
- **Delfino** (#15): the yearly posts sitemaps (`/sitemaps/posts/YYYY.xml`), whose urls carry `/YYYY/MM/`. Metadata from the JSON-LD, body from `[itemprop="articleBody"]`, one line per outermost block.

## Section filter

A broad filter drops sections with no bearing on legislative coverage: sports, world news, entertainment, lifestyle and sponsored content (`tools/scraping_tools/section_filter.py`). **Opinion sections are kept on purpose**, since columns also discuss bills.

- CRHoy, La Nación, El Mundo and Semanario: by the first segment of the url path. La Nación keeps more than the `/politica/` and `/el-pais/` planned in #14 (about 55 articles a day instead of ~16), so legislative news in Sucesos, Economía or Opinión is not lost. An article cross-posted to an excluded section is kept, because the url's first segment decides.
- El Mundo and Semanario: also by category (Semanario's `publicidad`).
- Delfino: urls have no section, so it filters by the page's `articleSection` (Cultura Colectiva, Reporte Internacional, and the branded sections Banca con Propósito, JUPEMA and Más conectados).

## Table (private corpus)

`news_articles`, one row per article:

| Field | Holds |
|---|---|
| `id` | SHA-256 of the url |
| `url`, `organization`, `outlet_type` | source; `outlet_type` is `general` or `specialized` |
| `title`, `description`, `author`, `section` | as the outlet publishes them; sections have no common taxonomy (8 to 199 distinct values per outlet) |
| `date_published` | local time, see "Period" |
| `content` | full text, one line per block (CRHoy: the raw text of the article block) |
| `date_extracted` | when it was parsed |
| `extraction_status` | `Success`, or `Partial` when no body was found (`content` empty) |

`news_bill_links` (`news_id`, `bill_number`, `source`): the bills a Delfino article links to.

The text stays private: it is used only for matching, and the public corpus (#44) has metadata and links, not the body.

## Field coverage

| Outlet | Without body (`Partial`) | Without author | Without section | Mean length (characters) |
|---|---|---|---|---|
| CRHoy | 174 | 0 | 260 | 2,098 |
| La Nación | 0 | 3 | 0 | 3,658 |
| Delfino | 2 | 0 | 0 | 4,546 |
| El Mundo CR | 0 | 0 | 0 | 3,732 |
| Semanario | 1 | 2,222 (all) | 2 | 4,587 |

The 177 news without a body are left out of matching, so the Jev filter ran on 29,698 news.

## Cleaning: what was done and what was not (#16)

Done in the parsers: block-wise text extraction, removal of scripts, styles, ads and zero-width characters, CRHoy's `(CRHoy.com)` tag, and dedup by url (the id is the url's hash).

**Not done**, documented instead. The embeddings and the whole Jev run already used this text, and the effect on the results is negligible:

- **Duplicates:** 64 articles are exact content copies of another one (57 from La Nación), and Delfino has 80 `url` / `url-2` pairs where the `-2` page is a summary of the first. In the matching they weigh 6 of the 6,329 news–bill pairs (1 + 5 of the 3,662 news with a match). They can count twice in per-outlet totals.
- **Boilerplate left in the text:** El Mundo's dateline (`San José, 24 oct (elmundo.cr) – `, also `(dpa)`) in 2,749 of 3,388 articles; Delfino's opinion notices (~1,200); La Nación's AI notices (788). At chunk level it cannot be removed cleanly: only 187 embedding chunks repeat.
- **Extraction status:** only `Success` / `Partial`. The CRHoy-style values planned in #16 (opinion, paywall, empty) were not ported.

## Known limitations

- **Sponsored content in El Mundo CR** cannot be told apart from news: the site has no tag, category or field marking it (1 in 172 relevant news in a test week). It stays in the corpus and is unlikely to match a bill. A byline heuristic was ruled out because it also drops real pieces.
- **Agency content in La Nación** is detected by byline only: agency text signed by a staff journalist, or credited only inside the text, is kept.
- **Sections** are the outlets' own, with no common taxonomy, so cross-outlet comparisons by section need a manual mapping.
- **Volume is not comparable across outlets:** La Nación and CRHoy publish far more than Semanario, and Delfino is specialized. Results are reported per outlet, and pooled numbers give both per-article and per-outlet averages (#11).

## Terms of use and ethics

A reading of the public texts, not legal advice (#11):

- **La Nación:** the general rule forbids storing or redistributing content, with an explicit exception for proven academic use with credits. Agency and third-party content is excluded even for academic use, hence the byline filter.
- **El Mundo CR:** no terms of use, only a privacy policy; copyright law applies (Ley 6683). Its robots.txt allows every crawler, AI crawlers included (checked 2026-11-05).
- **Semanario Universidad:** no terms page, only "Derechos reservados". Its robots.txt asks for a 20 s crawl-delay (respected) and blocks AI crawlers; `*` is allowed.
- **CRHoy:** collected under the same practices.
- **Delfino:** its terms reserve all rights; what can be published from it is still open in #19.

Practices for every outlet: the text stays private and is used only for matching; the public corpus has metadata and links only; every outlet is credited in the report, the site and the datasheet.
