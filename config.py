from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

# Every date in the project is Costa Rica local time, stored without timezone (UTC-6, no daylight saving).
COSTA_RICA_TZ = timezone(timedelta(hours = -6))

@dataclass(frozen = True)
class DataPeriod:
  start: datetime   # inclusive, Costa Rica local time
  end: datetime     # inclusive, Costa Rica local time

  def contains(self, moment: datetime) -> bool:
    return self.start <= moment <= self.end

  def months(self) -> list[tuple[int, int]]:
    """(year, month) pairs the period touches, in order."""
    months: list[tuple[int, int]] = []
    year, month = self.start.year, self.start.month
    while (year, month) <= (self.end.year, self.end.month):
      months.append((year, month))
      year, month = (year + 1, 1) if month == 12 else (year, month + 1)
    return months

  def years(self) -> list[int]:
    return list(range(self.start.year, self.end.year + 1))

  def start_date(self) -> date:
    return self.start.date()

@dataclass(frozen = True)
class EmbeddingModel:
  name: str                         # Hugging Face model id
  max_tokens: int                   # longer texts are truncated by the model
  query_prompt: str | None = None   # instruction put before the searching side (news); None if the model uses none

def to_costa_rica_time(moment_text: str) -> datetime:
  """
  ISO timestamp (with 'Z' or an offset) converted to naive Costa Rica local time. Naive input is returned as is.
  Only for sources whose 'Z' is real UTC (Delfino). CRHoy labels local time with 'Z': don't use it there.
  """
  moment = datetime.fromisoformat(moment_text.replace("Z", "+00:00"))
  if moment.tzinfo is None:
    return moment
  return moment.astimezone(COSTA_RICA_TZ).replace(tzinfo = None)

class Config:
  # Data period (see #20): six full months, May to October 2026.
  DATA_PERIOD = DataPeriod(datetime(2026, 5, 1), datetime(2026, 10, 31, 23, 59, 59))

  # Fetching. Each website runs in its own thread with its own rate limit, so sites don't slow each other down.
  USER_AGENT = "uni-project"
  RATE_LIMIT = 1                       # seconds between requests to the same website
  RATE_LIMITS = {"semanario": 20}      # per-website overrides (Semanario's robots.txt asks for a 20 s crawl-delay)
  RETRIES = 5
  TIMEOUT = 10
  SITEMAP_TIMEOUT = 60   # some sitemaps list 30,000 urls

  # Asamblea Legislativa's SIL (#65): official source for deputies and legislative organs.
  ASAMBLEA_URL = "https://produccion.asamblea.go.cr/SILConsulta/"
  ASAMBLEA_TIMEOUT = 120               # the server builds whole CSV exports, the big ones take a while
  # Deputies still in office on or after this date: the filing date of bill FIRST_BILL (20000), so every
  # deputy who could sign or handle one of our bills is kept. Earlier terms can't touch them.
  DEPUTIES_SINCE = datetime(2016, 6, 13)
  ASAMBLEA_SESSIONS = 3                # bills (#66) are downloaded by this many SIL sessions in parallel, each at RATE_LIMIT

  # Storage
  RAW_HTML_DIR = "raw/html"
  RAW_CSV_DIR = "raw/csv"
  RAW_LINKS_DIR = "raw/links"
  RAW_TEXT_DIR = "raw/text"
  DATABASE_DIR = "databases"
  PRIVATE_DATABASE = "private_corpus"
  COMMIT_BATCH_SIZE = 50

  # Bills (SIL, #66) and their votes (Delfino) are collected by number, not by period: news in the period discuss
  # older bills too. 20000 was filed on 13/06/2016, ten years before the data period (see docs/bills.md).
  FIRST_BILL = 20000

  @staticmethod
  def rate_limit_for(website: str) -> float:
    return Config.RATE_LIMITS.get(website, Config.RATE_LIMIT)

  # Outlet types, used to group the analysis
  GENERAL_OUTLET = "general"
  SPECIALIZED_OUTLET = "specialized"

  # Embedding runs (#32): one .npz per (model, news chunk size) and per (model, bill variant), see EmbeddingRunner.
  EMBEDDINGS_DIR = "databases/embeddings"
  EMBEDDING_CHUNK_SIZES = [256, 512, 1024, 2048, 8000]   # tokens per news chunk, title included; 8000 ≈ whole news
  EMBEDDING_TOKENS_PER_BATCH = 8192   # texts per GPU batch = this / longest text in it (32 for 256, 1 for 8000)
  EMBEDDING_CHECKPOINT_SECONDS = 300  # a run saves what it has done this often, and a cut run resumes from there

  # Embedding analysis (#38, #33): recall of the gold bills over the .npz files, see EmbeddingAnalyzer.
  EMBEDDING_RESULTS_DIR = "results/embeddings"   # numbers only, kept in git
  EMBEDDING_CROSS_DATA = "private_visuals/output/embedding_cross/data.js"   # top-K with titles, not in git
  EMBEDDING_KS = [1, 5, 10, 20, 30, 50, 100]
  EMBEDDING_BOOTSTRAP = 1000          # resamples over news for the 95 % intervals
  EMBEDDING_RANK_BY = "recall@30"     # metric that picks the best configuration (K = 30 is the initial K of #33)

  # Candidate ranker features (#33, #68): one value per (gold news, bill), see FeatureBuilder.
  RETRIEVAL_DIR = "databases/retrieval"          # cached feature matrices, not in git
  RETRIEVAL_MODEL = "qwen3-0.6b"                 # embeddings the features use (best of the analysis, #38)
  RETRIEVAL_CHUNK_SIZE = 256
  RETRIEVAL_BACKGROUND_SIZE = 2000               # legislative news (not gold, not in the sample) for the bill z-scores
  RETRIEVAL_BACKGROUND_SEED = 20261107
  RETRIEVAL_MAX_WINDOW_BEFORE = 60               # widest activity window the evolution can choose, in days
  RETRIEVAL_MAX_WINDOW_AFTER = 14

  # Evolutionary tuning of the ranker (#68), see GeneticAlgorithm and RankingProblem.
  EVOLUTION_RESULTS_DIR = "results/evolution"    # numbers only, kept in git
  EVOLUTION_REPLAY_DATA = "private_visuals/output/evolution_replay/data.js"
  EVOLUTION_K = 100                              # candidates per news; fitness = bill coverage at this K
  EVOLUTION_REPORT_KS = [50, 100]
  EVOLUTION_FOLDS = 5
  EVOLUTION_SEED = 7

  # Hand-labeled sample (#27, #28, #31): draw queue built by SampleBuilder, labeled from the top down.
  SAMPLE_DIR = "results/sample"       # ids, urls, dates and labels only (no news text), kept in git
  SAMPLE_SEED = 20261107
  SAMPLE_POOL_A_SHARE = 0.8           # share of each outlet queue taken from the keyword filter, the rest from outside
  SAMPLE_QUEUE_PER_OUTLET = 100       # queue length per general outlet; labeling stops when the quotas are met
  SAMPLE_DELFINO = 15                 # Delfino news with gold links, to compare their links with the hand labels

  # Embedding models to try (#6, #32). Adding one is adding an entry; Embedder takes these values as arguments.
  EMBEDDING_MODELS = {
    "bge-m3": EmbeddingModel("BAAI/bge-m3", max_tokens = 8192),
    "qwen3-0.6b": EmbeddingModel(
      "Qwen/Qwen3-Embedding-0.6B", max_tokens = 8192,
      query_prompt = "Instruct: Given a Costa Rican news article, retrieve the legislative bills it discusses\nQuery: "),
  }
