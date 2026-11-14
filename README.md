# cr-legislative-coverage

Which bills of Costa Rica's Asamblea Legislativa reach the news, and how. The project collects five outlets'
news (May–October 2026) and the Asamblea's bills, votes and deputies, links each news to the bills it covers
(an evolved ranker proposes candidates, the Jev evaluator decides), and publishes the result as a static site:
https://darialv.github.io/cr-legislative-coverage

## Layout

| Path | What |
| --- | --- |
| `config.py` | Paths, data period and every tunable of the pipeline |
| `main.py`, `pipeline.py` | Scraping: news, Delfino's votes and the Asamblea's SIL into the private database |
| `run_*.py` | One script per later step (embeddings, ranker, sample, Jev, evaluation); each explains its use at the top |
| `export_public.py` | Writes the site's data (`site/src/data/`, `site/public/textos/`) from the database and Jev's results |
| `download_bill_documents.py` | Original .docx of the published bills |
| `tools/` | The code behind the scripts, by area: scraping, database, embeddings, retrieval, evolution, LLM (Jev), sample |
| `results/` | Numbers only (ids, labels, scores; no news text): embeddings, evolution runs, sample, Jev |
| `results/jev/experiments/` | Superseded Jev trials (question probes, first filter, test100, compact and hybrid sample runs) |
| `private_visuals/` | Local pages (explorer, graphs, Jev viewer, blind evaluation...), all served by `private_visuals/server.py` |
| `site/` | The public Astro site, deployed to GitHub Pages on every push to `main` that touches it (see `site/README.md`) |
| `docs/` | How the data was collected and cleaned: `news.md`, `bills.md`, `asamblea.md` |

## Pipeline

Run everything from the repository root, in this order. Each step reads what the previous one left.

1. `python main.py`: news and votes. Bills, deputies and organs: `Pipeline().scrap_and_save_asamblea()` (see `docs/`).
2. `python run_embeddings.py --model <model>` and `python run_analysis.py`: embeddings of news and bills, and how
   well each configuration finds the gold links.
3. `python run_evolution.py`: evolves the candidate ranker on the gold links.
4. `python run_sample.py`: draw queue of the hand-labeled sample.
5. `python run_jev_filter.py`, then `python run_jev_corpus.py`: Jev's news filter, then candidates, gate and detail
   for the whole corpus (paid API: needs `TYPESAFE_API_KEY*` in `.env`).
6. `python run_jev_eval.py`, `python run_human_eval.py`, `python run_claude_eval.py`: evaluation of Jev against the
   sample and the blind readings.
7. `python export_public.py`, then `cd site && npm run build`: the public site.

Local pages: `python private_visuals/server.py` and open http://localhost:8766/.

## Not in git

The private database (`databases/`, with the news text), embeddings and feature caches, raw HTML (`raw/`), the full
Jev corpus run (`results/jev/corpus/`) and `.env`. They move between machines by hand. News bodies are never
committed: they are copyrighted and some sit behind a paywall.

Setup: Python 3 and `pip install -r requirements.txt` (CUDA build of torch for the GPU steps); Node 22 for the site.
