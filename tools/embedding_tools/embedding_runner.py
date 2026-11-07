import hashlib
import json
import logging
import os
import pathlib
import platform
import re
import sqlite3
import time
from dataclasses import dataclass
from datetime import datetime
from importlib import metadata as package_metadata

import numpy as np

from config import Config, EmbeddingModel
from tools.display_tools.progress import ProgressBoard, ProgressTask, silent_task
from tools.embedding_tools.embedder import Embedder

logger = logging.getLogger("cr")

BILL_VARIANTS = ["name", "subjects", "exposition"]
TITLE_SEPARATOR = "\n\n"
MIN_CHUNK_BODY = 64   # tokens of content per news chunk even when the title is huge

@dataclass
class EmbeddingItem:
  """One text to embed and what to store next to its vector."""
  key: str            # news id or bill number (as text)
  text: str
  tokens: int         # tokens of text, without the model's special tokens
  chunk_index: int = 0
  fallback: bool = False   # bill exposition variant: no exposition, the name was used instead

class EmbeddingRunner:
  """
  Embeds the news and the bills for one model (#32, #6) and saves one .npz per run in
  <Config.EMBEDDINGS_DIR>/<model key>/:
    news_<size>[_o<overlap>].npz   chunks of title + content (title repeated in every chunk), size in tokens
    bills_<variant>.npz            one vector per bill: name, name + subjects, or name + exposition
  Runs whose file already exists are skipped, so an interrupted run resumes at the next file. Inside a run, what is
  done is saved every checkpoint_seconds to <name>.checkpoint.npz, and a cut run resumes from it when the texts and
  the model are the same (the checkpoint is deleted once the .npz is written). Every file holds the
  vectors, one row of ids per vector, and a JSON 'meta' with everything needed to reproduce it.
  The news side gets the model's query prompt (if any); bills are the documents and get none.
  Reads the database read-only.
  """

  def __init__(self, model_key: str, board: ProgressBoard | None = None, database_path: str | None = None,
               output_dir: str = Config.EMBEDDINGS_DIR, tokens_per_batch: int = Config.EMBEDDING_TOKENS_PER_BATCH,
               embedder: Embedder | None = None, checkpoint_seconds: float = Config.EMBEDDING_CHECKPOINT_SECONDS):
    self.model_key = model_key
    self.model: EmbeddingModel = Config.EMBEDDING_MODELS[model_key]
    self.board = board
    self.database_path = database_path or f"{Config.DATABASE_DIR}/{Config.PRIVATE_DATABASE}.db"
    self.output_dir = pathlib.Path(output_dir) / model_key
    self.tokens_per_batch = tokens_per_batch
    self.checkpoint_seconds = checkpoint_seconds
    self.embedder = embedder   # loaded on the first run that needs it, so a run with nothing left loads no model
    self.connection = sqlite3.connect(f"file:{self.database_path}?mode=ro", uri = True)

  # ---- entry points ----

  def run_all(self, sizes: list[int] | None = None, overlap: int = 0, variants: list[str] | None = None,
              news: bool = True, bills: bool = True, news_ids: list[str] | None = None, tag: str | None = None):
    if news:
      for size in sizes or Config.EMBEDDING_CHUNK_SIZES:
        self.run_news(size, overlap, news_ids, tag)
    if bills:
      for variant in variants or BILL_VARIANTS:
        self.run_bills(variant)

  def run_news(self, size: int, overlap: int = 0, news_ids: list[str] | None = None, tag: str | None = None):
    """news_ids = None embeds the gold set (news with news_bill_links). Other ids need a tag, used in the file name."""
    if news_ids is not None and not tag:
      raise ValueError("custom news_ids need a tag, or they would overwrite the gold set's file")
    name = f"news_{size}" + (f"_o{overlap}" if overlap else "") + (f"_{tag}" if tag else "")
    path = self.output_dir / f"{name}.npz"
    if path.exists():
      logger.info(f"[embeddings] {self.model_key}/{path.name} already exists, skipped")
      return
    ids_source = "custom" if news_ids is not None else "gold"
    news_ids = news_ids if news_ids is not None else self.gold_news_ids()
    items = self.news_items(news_ids, size, overlap)
    extra = {"kind": "news", "chunk_size": size, "overlap": overlap, "ids_source": ids_source, "tag": tag,
             "n_news": len(news_ids), "n_chunks": len(items), "prompt": self.model.query_prompt,
             "chunks_per_news_max": max((i.chunk_index + 1 for i in items), default = 0)}
    self.embed_and_save(path, items, self.model.query_prompt, extra, f"news {size}",
                        arrays = {"news_ids": np.array([i.key for i in items]),
                                  "chunk_index": np.array([i.chunk_index for i in items], dtype = np.int32)})

  def run_bills(self, variant: str):
    if variant not in BILL_VARIANTS:
      raise ValueError(f"unknown bill variant {variant!r}, expected one of {BILL_VARIANTS}")
    path = self.output_dir / f"bills_{variant}.npz"
    if path.exists():
      logger.info(f"[embeddings] {self.model_key}/{path.name} already exists, skipped")
      return
    items, flags = self.bill_items(variant)
    extra = {"kind": "bills", "variant": variant, "n_bills": len(items), "prompt": None,
             "n_fallback_to_name": sum(i.fallback for i in items)}
    self.embed_and_save(path, items, None, extra, {"name": "name", "subjects": "subjects", "exposition": "expo"}[variant],
                        arrays = {"numbers": np.array([int(i.key) for i in items], dtype = np.int32),
                                  "fallback": np.array([i.fallback for i in items]),
                                  "flags": np.array(flags)})

  # ---- texts ----

  def gold_news_ids(self) -> list[str]:
    return [row[0] for row in self.connection.execute("SELECT DISTINCT news_id FROM news_bill_links ORDER BY news_id")]

  def news_items(self, news_ids: list[str], size: int, overlap: int) -> list[EmbeddingItem]:
    """Title + content cut in chunks of at most size tokens, the title (and separator) counted in every chunk."""
    embedder = self.get_embedder()
    rows = {row[0]: row[1:] for row in self.connection.execute(
      f"SELECT id, title, content FROM news_articles WHERE id IN ({','.join('?' * len(news_ids))})", news_ids)}
    missing = [news_id for news_id in news_ids if news_id not in rows]
    if missing:
      raise ValueError(f"{len(missing)} news ids are not in news_articles, e.g. {missing[:3]}")
    items: list[EmbeddingItem] = []
    for news_id in news_ids:
      title, content = (clean_text(rows[news_id][0]), clean_text(rows[news_id][1]))
      head = title + TITLE_SEPARATOR if title else ""
      body_size = max(size - embedder.count_tokens(head), MIN_CHUNK_BODY)
      pieces = embedder.chunk_by_size(content, body_size, min(overlap, body_size - 1)) if content else []
      for index, piece in enumerate(pieces or [""]):
        text = (head + piece).strip()
        items.append(EmbeddingItem(news_id, text, embedder.count_tokens(text), index))
    return items

  def bill_items(self, variant: str) -> tuple[list[EmbeddingItem], list[str]]:
    """Every bill, in number order; the flag (administrative, honorific, ...) is kept for the analysis to filter."""
    embedder = self.get_embedder()
    subjects: dict[int, list[str]] = {}
    if variant == "subjects":
      for number, subject in self.connection.execute("SELECT number, subject FROM bill_subjects ORDER BY number, rowid"):
        cleaned = clean_subject(subject)
        if cleaned and cleaned not in subjects.setdefault(number, []):
          subjects[number].append(cleaned)
    expositions: dict[int, str] = {}
    if variant == "exposition":
      expositions = {number: text for number, text in self.connection.execute(
        "SELECT number, exposition FROM bill_texts WHERE status = 'ok' AND exposition IS NOT NULL")}
    items: list[EmbeddingItem] = []
    flags: list[str] = []
    for number, name, flag in self.connection.execute("SELECT number, name, flag FROM bills ORDER BY number"):
      name = clean_text(name)
      fallback = False
      if variant == "subjects" and subjects.get(number):
        text = f"{name}. Materias: {', '.join(subjects[number])}"
      elif variant == "exposition":
        exposition = clean_text(expositions.get(number))
        fallback = not exposition
        text = name if fallback else f"{name}. {exposition}"
      else:
        fallback = variant == "subjects"   # a bill without subjects keeps only its name
        text = name
      items.append(EmbeddingItem(str(number), text, embedder.count_tokens(text), fallback = fallback))
      flags.append(flag or "")
    return items, flags

  # ---- embedding ----

  def get_embedder(self) -> Embedder:
    if self.embedder is None:
      logger.info(f"[embeddings] loading {self.model.name}")
      self.embedder = Embedder(self.model.name, max_tokens = self.model.max_tokens)
    return self.embedder

  def embed_and_save(self, path: pathlib.Path, items: list[EmbeddingItem], prompt: str | None, extra: dict,
                     phase: str, arrays: dict[str, np.ndarray]):
    embedder = self.get_embedder()
    task: ProgressTask = self.board.task(self.model_key, phase, total = len(items)) if self.board else silent_task()
    started = time.perf_counter()
    started_at = datetime.now().isoformat(timespec = "seconds")
    prompt_tokens = embedder.count_tokens(prompt) if prompt else 0
    limit = embedder.model.max_seq_length - 2   # room for the model's special tokens
    checkpoint_path = path.with_name(path.stem + ".checkpoint.npz")
    fingerprint = self.fingerprint(items, prompt, limit)
    vectors, done, previous = self.load_checkpoint(checkpoint_path, fingerprint, len(items))
    self.oom_splits = previous.get("oom_batch_splits", 0)
    elapsed_before = previous.get("elapsed_seconds", 0.0)
    started_at = previous.get("started", started_at)
    resumed = int(done.sum())
    task.advance(resumed)
    last_checkpoint = time.perf_counter()
    pending = [i for i in range(len(items)) if not done[i]]
    for batch in self.batches(items, prompt_tokens, limit, pending):
      batch_vectors = self.embed_batch(embedder, [items[i].text for i in batch], prompt)
      if vectors is None:
        vectors = np.zeros((len(items), batch_vectors.shape[1]), dtype = np.float32)
      vectors[batch] = batch_vectors
      done[batch] = True
      task.advance(len(batch))
      if time.perf_counter() - last_checkpoint >= self.checkpoint_seconds and not done.all():
        self.save_checkpoint(checkpoint_path, vectors, done, fingerprint, {
          "oom_batch_splits": self.oom_splits, "started": started_at,
          "elapsed_seconds": elapsed_before + time.perf_counter() - started})
        last_checkpoint = time.perf_counter()
    task.finish()
    tokens = np.array([i.tokens for i in items], dtype = np.int32)
    meta = {**self.base_meta(), **extra,
            "dim": int(vectors.shape[1]) if vectors is not None else None,
            "tokens_total": int(tokens.sum()), "tokens_max": int(tokens.max(initial = 0)),
            "n_truncated": int((tokens + prompt_tokens > limit).sum()), "truncation_limit": limit,
            "oom_batch_splits": self.oom_splits,
            "elapsed_seconds": round(elapsed_before + time.perf_counter() - started, 1),
            "resumed_from_checkpoint": resumed,
            "started": started_at, "finished": datetime.now().isoformat(timespec = "seconds")}
    path.parent.mkdir(parents = True, exist_ok = True)
    temporary = path.with_name(path.stem + ".partial.npz")
    np.savez(temporary, vectors = vectors if vectors is not None else np.zeros((0, 0), dtype = np.float32),
             tokens = tokens, meta = np.array(json.dumps(meta, ensure_ascii = False)), **arrays)
    os.replace(temporary, path)   # a cut run never leaves a file that looks finished
    checkpoint_path.unlink(missing_ok = True)
    logger.info(f"[embeddings] {self.model_key}/{path.name}: {len(items):,} vectors, {meta['tokens_total']:,} tokens, "
                f"{meta['n_truncated']} truncated, {meta['elapsed_seconds']} s"
                + (f", {resumed:,} from a checkpoint" if resumed else ""))

  # ---- checkpoints ----

  def fingerprint(self, items: list[EmbeddingItem], prompt: str | None, limit: int) -> str:
    """Hash of the model and of every text in order: a checkpoint is only reused for exactly the same run."""
    digest = hashlib.sha256(json.dumps([self.model.name, prompt, limit]).encode())
    for item in items:
      digest.update(json.dumps([item.key, item.chunk_index, item.text]).encode())
    return digest.hexdigest()

  def load_checkpoint(self, checkpoint_path: pathlib.Path, fingerprint: str,
                      n_items: int) -> tuple[np.ndarray | None, np.ndarray, dict]:
    """(vectors, done mask, saved state) from a checkpoint of this same run, or an empty start."""
    empty = (None, np.zeros(n_items, dtype = bool), {})
    if not checkpoint_path.exists():
      return empty
    try:
      with np.load(checkpoint_path, allow_pickle = False) as saved:
        state = json.loads(str(saved["state"]))
        vectors, done = saved["vectors"], saved["done"]
    except Exception as error:
      logger.warning(f"[embeddings] {self.model_key}/{checkpoint_path.name} unreadable ({error!r}), starting over")
      return empty
    if state.get("fingerprint") != fingerprint or len(done) != n_items:
      logger.warning(f"[embeddings] {self.model_key}/{checkpoint_path.name} is from different texts or another "
                     f"model, starting over")
      return empty
    logger.info(f"[embeddings] {self.model_key}/{checkpoint_path.name}: resuming, {int(done.sum()):,} of "
                f"{n_items:,} already embedded")
    return vectors, done, state

  def save_checkpoint(self, checkpoint_path: pathlib.Path, vectors: np.ndarray, done: np.ndarray, fingerprint: str,
                      state: dict):
    checkpoint_path.parent.mkdir(parents = True, exist_ok = True)
    temporary = checkpoint_path.with_name(checkpoint_path.stem + ".tmp.npz")
    np.savez(temporary, vectors = vectors, done = done,
             state = np.array(json.dumps({**state, "fingerprint": fingerprint})))
    os.replace(temporary, checkpoint_path)   # a cut while saving keeps the previous checkpoint

  # ---- batching ----

  def batches(self, items: list[EmbeddingItem], prompt_tokens: int, limit: int,
              indices: list[int] | None = None) -> list[list[int]]:
    """
    Indices (all, or the given ones) grouped longest first so that (texts in batch) x (longest text) stays under
    tokens_per_batch. Lengths are capped at the model's limit, since the model truncates anything longer.
    """
    indices = range(len(items)) if indices is None else indices
    order = sorted(indices, key = lambda i: items[i].tokens, reverse = True)
    batches: list[list[int]] = []
    for index in order:
      if batches:
        longest = min(items[batches[-1][0]].tokens + prompt_tokens, limit) + 2
        if (len(batches[-1]) + 1) * longest <= self.tokens_per_batch:
          batches[-1].append(index)
          continue
      batches.append([index])
    return batches

  def embed_batch(self, embedder: Embedder, texts: list[str], prompt: str | None) -> np.ndarray:
    """Halves the batch while the GPU runs out of memory; a single text that doesn't fit is an error."""
    try:
      return embedder.embed(texts, prompt = prompt, batch_size = len(texts))
    except Exception as error:
      if not is_out_of_memory(error) or len(texts) == 1:
        raise
      import torch
      torch.cuda.empty_cache()
      self.oom_splits += 1
      logger.warning(f"[embeddings] out of GPU memory with {len(texts)} texts, splitting the batch")
      half = len(texts) // 2
      return np.concatenate([self.embed_batch(embedder, texts[:half], prompt),
                             self.embed_batch(embedder, texts[half:], prompt)])

  def base_meta(self) -> dict:
    device = str(self.embedder.model.device) if self.embedder is not None and hasattr(self.embedder, "model") else None
    gpu = None
    if device and device.startswith("cuda"):
      import torch
      gpu = torch.cuda.get_device_name(0)
    database = pathlib.Path(self.database_path)
    return {"model_key": self.model_key, "model_name": self.model.name, "max_tokens": self.model.max_tokens,
            "tokens_per_batch": self.tokens_per_batch, "device": device, "gpu": gpu, "python": platform.python_version(),
            "packages": {name: package_version(name) for name in ["torch", "sentence-transformers", "transformers", "numpy"]},
            "database": str(database),
            "database_modified": datetime.fromtimestamp(database.stat().st_mtime).isoformat(timespec = "seconds")}

def load_run(path: str | pathlib.Path) -> tuple[dict[str, np.ndarray], dict]:
  """Arrays of a saved run and its metadata."""
  with np.load(path) as data:
    arrays = {name: data[name] for name in data.files if name != "meta"}
    return arrays, json.loads(str(data["meta"]))

CONTROL_CHARACTERS = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")

def clean_text(text: str | None) -> str:
  """Control characters (e.g. \\x1a in some SIL names) become spaces; surrounding whitespace is dropped."""
  return CONTROL_CHARACTERS.sub(" ", text or "").strip()

def clean_subject(subject: str | None) -> str:
  """
  SIL descriptor to plain lowercase words: 'EDUCATIV,-O/-A' -> 'educativo', 'REGULADOR,-A' -> 'regulador'
  (a single ending is the feminine one, so the stem is already the word), 'SALVADOR (EL)' -> 'el salvador'.
  Bare numbers ('1', '6', ...) carry no meaning in text and give ''.
  """
  subject = clean_text(subject)
  if "," in subject:
    stem, endings = subject.split(",", 1)
    alternatives = [ending.strip(" -") for ending in endings.split("/") if ending.strip(" -")]
    subject = stem.strip() + (alternatives[0] if len(alternatives) > 1 else "")
  article = re.fullmatch(r"(.+?)\s*\((EL|LA|LOS|LAS)\)", subject)
  if article:
    subject = f"{article.group(2)} {article.group(1)}"
  if subject.isdigit():
    return ""
  return re.sub(r"\s+", " ", subject).lower()

def is_out_of_memory(error: Exception) -> bool:
  return type(error).__name__ == "OutOfMemoryError" or "out of memory" in str(error).lower()

def package_version(name: str) -> str | None:
  try:
    return package_metadata.version(name)
  except package_metadata.PackageNotFoundError:
    return None
