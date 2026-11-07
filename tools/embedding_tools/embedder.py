import numpy as np

class Embedder:
  """
  Thin, model-agnostic wrapper around a sentence-transformers model (#32). It only takes strings and returns strings
  or vectors: building the texts, storing vectors and scoring belong elsewhere.
  Vectors are L2-normalized, so the dot product of two of them is their cosine similarity.
  """

  def __init__(self, model_name: str, max_tokens: int | None = None, batch_size: int = 8, device: str | None = None):
    # Imported here so the rest of the project (and this module) loads on machines without torch.
    import torch
    from sentence_transformers import SentenceTransformer

    device = device or ("cuda" if torch.cuda.is_available() else "cpu")
    self.model = SentenceTransformer(model_name, device = device)
    if device == "cuda":
      self.model.half()   # fp16 halves memory, needed for long texts on a 6 GB card
    if max_tokens is not None:
      self.model.max_seq_length = max_tokens   # longer texts are truncated by the model
    self.tokenizer = self.model.tokenizer
    self.batch_size = batch_size

  def embed(self, texts: list[str], prompt: str | None = None, show_progress: bool = False) -> np.ndarray:
    """
    One normalized vector per text, shape (len(texts), dim). prompt is put before every text (e.g. the query
    instruction some models expect for the searching side); leave it None for models or sides that don't use one.
    """
    embeddings = self.model.encode(texts, prompt = prompt, batch_size = self.batch_size, normalize_embeddings = True,
                                   convert_to_numpy = True, show_progress_bar = show_progress)
    return embeddings.astype(np.float32)

  def count_tokens(self, text: str) -> int:
    return len(self._token_offsets(text))

  def chunk_by_size(self, text: str, max_tokens: int, overlap: int = 0) -> list[str]:
    """
    Chunks of at most max_tokens tokens; consecutive chunks share overlap tokens. The number of chunks follows from
    the text's length. The model adds its special tokens on top, so keep max_tokens a bit under its limit.
    """
    if max_tokens <= 0 or not 0 <= overlap < max_tokens:
      raise ValueError("max_tokens must be positive and 0 <= overlap < max_tokens")
    offsets = self._token_offsets(text)
    starts = [0]
    while starts[-1] + max_tokens < len(offsets):
      starts.append(starts[-1] + max_tokens - overlap)
    return self._slice(text, offsets, [(start, start + max_tokens) for start in starts])

  def chunk_by_count(self, text: str, n_chunks: int, overlap: int = 0) -> list[str]:
    """
    n_chunks chunks of (nearly) equal size, each extended by overlap tokens into the next one. E.g. 2000 tokens in
    10 chunks: 10 chunks of 200 tokens (+ overlap). A text shorter than n_chunks tokens gives one chunk per token.
    """
    if n_chunks <= 0 or overlap < 0:
      raise ValueError("n_chunks must be positive and overlap can't be negative")
    offsets = self._token_offsets(text)
    n_chunks = min(n_chunks, len(offsets))
    bounds = [i * len(offsets) // n_chunks for i in range(n_chunks + 1)]
    return self._slice(text, offsets, [(bounds[i], bounds[i + 1] + overlap) for i in range(n_chunks)])

  @staticmethod
  def mean(embeddings: np.ndarray) -> np.ndarray:
    """Average of several vectors (e.g. the chunks of one text), normalized again."""
    average = embeddings.mean(axis = 0)
    return average / np.linalg.norm(average)

  def _token_offsets(self, text: str) -> list[tuple[int, int]]:
    """(start, end) character positions of each token, without special tokens."""
    return self.tokenizer(text, add_special_tokens = False, return_offsets_mapping = True, verbose = False)["offset_mapping"]

  @staticmethod
  def _slice(text: str, offsets: list[tuple[int, int]], spans: list[tuple[int, int]]) -> list[str]:
    """Pieces of the original text covering tokens [start, end) for each span. Empty text gives []."""
    if not offsets:
      return []
    return [text[offsets[start][0]:offsets[min(end, len(offsets)) - 1][1]] for start, end in spans]
