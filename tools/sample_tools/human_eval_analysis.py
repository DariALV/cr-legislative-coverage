import csv
import json
import pathlib
from collections import defaultdict

from config import Config
from tools.sample_tools.human_eval_draw import HumanEvalDraw

# The two levels of the corpus analysis (jev 2026-11-10 16:11): a mention is explicit >= 0.5 or implicit >= 0.75;
# substantive coverage is a mention whose centrality (0-1) reaches 0.25. A hand answer is substantive from "one part
# of the news" up (centrality 1 or 2 on the 0-2 scale).
GATE_THRESHOLD = Config.JEV_MATCH_THRESHOLD
MENTION_IMPLICIT = 0.75
SUBSTANTIVE_CENTRALITY = 0.25
HUMAN_SUBSTANTIVE = 1
LEVELS = ("gate", "mention", "substantive")

class HumanEvalAnalysis:
  """
  Compares the hand answers of the blind evaluation with Jev's answers from the corpus run. Only news answered in full
  count. Writes, without any news text:
    pairs.csv     every candidate of the answered news, plus bills added by hand: the hand mark and Jev's explicit,
                  implicit and the three levels (gate, mention, substantive)
    answers.csv   every question both answered: the hand answer, Jev's answer, the probability Jev gave to the hand
                  answer, whether they agree and whether the hand answer was marked doubtful
    timing.csv    active seconds, characters and bills per news
    summary.json  gate counts by pair and by news at the three levels, and agreement per question
  """

  def __init__(self, folder: str = Config.HUMAN_EVAL_DIR, corpus_dir: str = f"{Config.JEV_RESULTS_DIR}/corpus"):
    self.folder = pathlib.Path(folder)
    self.corpus = pathlib.Path(corpus_dir)
    self.questions = json.loads((self.corpus / "questions.json").read_text(encoding = "utf-8"))

  def run(self) -> dict:
    entries = json.loads((self.folder / "answers.json").read_text(encoding = "utf-8"))["news"]
    with open(self.folder / "draw.csv", encoding = "utf-8", newline = "") as file:
      drawn = [row["news_id"] for row in csv.DictReader(file)]
    ids = [news_id for news_id in drawn if entries.get(news_id, {}).get("complete")]
    gate, details, news = self.load_jev(set(ids))
    lengths = HumanEvalDraw.content_lengths()

    pairs, rows, timing = [], [], []
    for news_id in ids:
      entry = entries[news_id]
      news_pairs = self.pairs_of(news_id, entry, gate.get(news_id, {}), details)
      pairs += news_pairs
      rows += self.answers_of(news_id, entry, news[news_id], news_pairs, details)
      timing.append({"news_id": news_id, "seconds": entry.get("seconds", 0), "chars": lengths.get(news_id, 0),
                     "bills": sum(pair["human"] != "none" for pair in news_pairs)})
    summary = self.summarize(ids, pairs, rows, timing)
    out = self.folder / "analysis"
    self.write_csv(out / "pairs.csv", pairs)
    self.write_csv(out / "answers.csv", rows)
    self.write_csv(out / "timing.csv", timing)
    (out / "summary.json").write_text(json.dumps(summary, ensure_ascii = False, indent = 2), encoding = "utf-8")
    return summary

  def load_jev(self, ids: set[str]) -> tuple[dict, dict, dict]:
    """gate[news][bill] = row; details[(news, bill)][question] = {options, choice, score, score_01}; news[news] = row."""
    gate: dict[str, dict[str, dict]] = defaultdict(dict)
    with open(self.corpus / "gate.csv", encoding = "utf-8", newline = "") as file:
      for row in csv.DictReader(file):
        if row["news_id"] in ids:
          gate[row["news_id"]][row["bill"]] = row
    details: dict[tuple[str, str], dict[str, dict]] = defaultdict(dict)
    with open(self.corpus / "details.csv", encoding = "utf-8", newline = "") as file:
      for row in csv.DictReader(file):
        if row["news_id"] not in ids:
          continue
        answer = details[(row["news_id"], row["bill"])].setdefault(row["question"], {"options": {}})
        answer["options"][row["option"]] = float(row["probability"] or 0)
        for key in ("choice", "score", "score_01"):
          if row[key]:
            answer[key] = row[key]
    news = {news_id: row for news_id, row in HumanEvalDraw.read_csv(self.corpus / "news.csv").items() if news_id in ids}
    return gate, details, news

  @staticmethod
  def pairs_of(news_id: str, entry: dict, candidates: dict[str, dict], details: dict) -> list[dict]:
    pairs = []
    bills = set(candidates) | set(entry.get("bills", {}))
    for bill in sorted(bills, key = lambda number: float(candidates[number]["rank"]) if number in candidates else 1e9):
      hand = entry.get("bills", {}).get(bill, {})
      row = candidates.get(bill)
      explicit = float(row["explicit"]) if row else None
      implicit = float(row["implicit"]) if row else None
      gate = bool(row) and (explicit >= GATE_THRESHOLD or implicit >= GATE_THRESHOLD)
      mention = bool(row) and (explicit >= GATE_THRESHOLD or implicit >= MENTION_IMPLICIT)
      centrality = details.get((news_id, bill), {}).get("centrality", {}).get("score_01")
      hand_centrality = hand.get("answers", {}).get("centrality")
      pairs.append({
        "news_id": news_id, "bill": bill, "rank": row["rank"] if row else "", "added_by_hand": int(bool(hand.get("added"))),
        "human": hand.get("mention", "none"), "human_centrality": "" if hand_centrality is None else hand_centrality,
        "jev_explicit": "" if explicit is None else explicit, "jev_implicit": "" if implicit is None else implicit,
        "jev_centrality_01": centrality or "",
        "jev_gate": int(gate), "jev_mention": int(mention),
        "jev_substantive": int(mention and centrality is not None and float(centrality) >= SUBSTANTIVE_CENTRALITY),
        "human_match": int(bool(hand.get("mention"))),
        "human_substantive": int(bool(hand.get("mention")) and hand_centrality is not None and hand_centrality >= HUMAN_SUBSTANTIVE),
      })
    return pairs

  def answers_of(self, news_id: str, entry: dict, news_row: dict, pairs: list[dict], details: dict) -> list[dict]:
    doubtful = set(entry.get("doubtful", []))
    rows = []
    genre = entry.get("genre")
    genre_options = {key[len("genre_"):]: float(value) for key, value in news_row.items()
                     if key.startswith("genre_") and key != "genre_confidence" and value}
    rows.append(self.compare(news_id, "", "genre", "choice", genre, {"options": genre_options, "choice": news_row["genre"]},
                             "genre" in doubtful))
    both = [pair for pair in pairs if pair["human_match"] and pair["jev_gate"]]
    if both:
      for question, spec in self.questions["details_news"].items():
        rows.append(self.compare(news_id, "", question, spec["type"], entry.get("news_answers", {}).get(question),
                                 details.get((news_id, ""), {}).get(question), f"news:{question}" in doubtful))
    for pair in both:
      bill = pair["bill"]
      hand = entry["bills"][bill].get("answers", {})
      for question, spec in self.questions["details"].items():
        rows.append(self.compare(news_id, bill, question, spec["type"], hand.get(question),
                                 details.get((news_id, bill), {}).get(question), f"{bill}:{question}" in doubtful))
    return [row for row in rows if row is not None]

  @staticmethod
  def compare(news_id: str, bill: str, question: str, kind: str, human, jev: dict | None, doubtful: bool) -> dict | None:
    if human is None or not jev:
      return None
    options = jev.get("options", {})
    if kind == "noul":
      p_true = options.get("true", 0.0)
      jev_answer, p_human = p_true >= 0.5, p_true if human else 1 - p_true
    elif kind == "score":
      jev_answer = int(max(options, key = options.get))
      p_human = options.get(str(human), 0.0)
    else:
      jev_answer = jev.get("choice") or max(options, key = options.get)
      p_human = options.get(str(human), 0.0)
    return {"news_id": news_id, "bill": bill, "question": question, "type": kind, "human": human, "jev": jev_answer,
            "jev_score": jev.get("score", ""), "p_human": round(p_human, 3), "agree": int(jev_answer == human),
            "doubtful": int(doubtful)}

  @staticmethod
  def summarize(ids: list[str], pairs: list[dict], rows: list[dict], timing: list[dict]) -> dict:
    def rate(numerator: int, denominator: int):
      return round(numerator / denominator, 3) if denominator else None

    gate = {}
    news_level = {}
    for level in LEVELS:
      human_key = "human_substantive" if level == "substantive" else "human_match"
      counts = {"tp": 0, "fp": 0, "fn": 0, "tn": 0}
      for pair in pairs:
        human, jev = pair[human_key], pair[f"jev_{level}"]
        counts["tp" if human and jev else "fp" if jev else "fn" if human else "tn"] += 1
      gate[level] = {**counts, "precision": rate(counts["tp"], counts["tp"] + counts["fp"]),
                     "recall": rate(counts["tp"], counts["tp"] + counts["fn"])}
      table = {"both": 0, "human_only": 0, "jev_only": 0, "neither": 0}
      for news_id in ids:
        news_pairs = [pair for pair in pairs if pair["news_id"] == news_id]
        human = any(pair[human_key] for pair in news_pairs)
        jev = any(pair[f"jev_{level}"] for pair in news_pairs)
        table["both" if human and jev else "jev_only" if jev else "human_only" if human else "neither"] += 1
      news_level[level] = table
    matched = [pair for pair in pairs if pair["human_match"] and pair["jev_gate"]]
    explicit_agree = sum((pair["human"] == "explicit") == (float(pair["jev_explicit"]) >= GATE_THRESHOLD) for pair in matched)

    by_question: dict[str, dict] = {}
    for row in rows:
      stats = by_question.setdefault(row["question"], {"n": 0, "agree": 0, "p_human": 0.0})
      stats["n"] += 1
      stats["agree"] += row["agree"]
      stats["p_human"] += row["p_human"]
    for stats in by_question.values():
      stats["p_human"] = round(stats["p_human"] / stats["n"], 3)
    detail_rows = [row for row in rows if row["question"] != "genre"]
    doubtful_rows = [row for row in detail_rows if row["doubtful"]]
    with_bills = [row["seconds"] for row in timing if row["bills"]]
    without_bills = [row["seconds"] for row in timing if not row["bills"]]
    return {
      "news_answered": len(ids),
      "minutes_total": round(sum(row["seconds"] for row in timing) / 60, 1),
      "minutes_per_news": {"with_bills": round(sum(with_bills) / len(with_bills) / 60, 1) if with_bills else None,
                           "without_bills": round(sum(without_bills) / len(without_bills) / 60, 1) if without_bills else None},
      "gate_by_pair": gate,
      "gate_by_news": news_level,
      "explicit_on_shared_matches": {"n": len(matched), "agree": explicit_agree},
      "details": {"n": len(detail_rows), "agree": sum(row["agree"] for row in detail_rows),
                  "doubtful": {"n": len(doubtful_rows), "agree": sum(row["agree"] for row in doubtful_rows)}},
      "by_question": dict(sorted(by_question.items())),
    }

  @staticmethod
  def write_csv(path: pathlib.Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents = True, exist_ok = True)
    with open(path, "w", encoding = "utf-8", newline = "") as file:
      if not rows:
        return
      writer = csv.DictWriter(file, fieldnames = list(rows[0]))
      writer.writeheader()
      writer.writerows(rows)
