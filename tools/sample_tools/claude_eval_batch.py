import csv
import json
import pathlib
import re
from collections import defaultdict

from config import Config
from tools.llm_tools.jev_context import JevContext

# The rules a person gets in the answering page (private_visuals/jev_eval/glossary.js), in English. Claude gets the
# same rules, so the two second readers answer under the same codebook. Nothing here adds to Jev's questions.
RULES = """\
- Answer every question as it is written, from what the news says, not from what you know about the subject.
- For borderline cases, read the "Yes:" / "No:" lines of a question: they define what counts.
- Candidates: for each candidate file decide `explicit` (the news names it: it gives its expediente number, quotes its
  official title, or uses a nickname that refers to it), `implicit` (the news talks about this specific file without
  naming it: what it would do or change, who proposed it, or what step it is in) or nothing.
  - If several files share the subject and nothing in the news fits one in particular, mark none of them.
  - If the news names the file and also describes it, mark `explicit`.
  - A law already in force came from a file: naming the law by its title names that file.
  - If the news covers a file that is not among the candidates, say so in `outside_list`.
- Detail questions are about the whole file. If the news is about a motion, a regulation or a change to the file,
  answer about the file: who proposed the file (not the motion), whether the file has the votes (not the motion), what
  the news thinks of the file.
- To quote or paraphrase, the source has to speak: the news reports what it said or thinks. A mere mention of the
  source does not count.
- Party positions are the ones the news attributes to the party through its deputies or spokespeople. The deputy list
  below gives each deputy's party.
- If an answer leaves you in doubt, still give your best answer and add it to `doubtful`.
"""

OUTPUT = """\
Write one JSON file with this shape (only the news of this batch, every one of them):

{"news": {"<news id>": {
  "genre": "news_report" | "opinion" | "interview" | "analysis",
  "bills": {"<file number>": {"mention": "explicit" | "implicit", "answers": {<every detail question>: <value>}}},
  "news_answers": {<every question about the news>: <value>},
  "doubtful": ["genre" | "news:<question>" | "<file number>:<question>", ...],
  "note": "<optional, at most 25 words, in your own words, never quoting the text>",
  "outside_list": "<optional: a file the news covers that is not among the candidates>"
}}}

- `bills` holds only the files you mark; leave it {} when you mark none.
- `news_answers` is filled only when you mark at least one file; otherwise leave it {}.
- Values: yes/no questions take true or false; choice questions take the option key; scale questions take the
  number of the option (0 is the first one).
"""

class ClaudeEvalBatch:
  """
  Writes the input files for Claude to answer Jev's questions blind, as a person does in private_visuals/jev_eval/: the
  news as Jev saw it (JevContext), its candidate files with the same card, every question with its options, the
  deputies with their party and the same rules the page's glossary gives. Nothing from Jev's answers or the person's
  goes in. The files hold news text, so they go outside git.
  """

  def __init__(self, folder: str = "raw/claude_eval", corpus_dir: str = f"{Config.JEV_RESULTS_DIR}/corpus"):
    self.folder = pathlib.Path(folder)
    self.corpus = pathlib.Path(corpus_dir)
    self.context = JevContext()
    self.questions = json.loads((self.corpus / "questions.json").read_text(encoding = "utf-8"))

  def write(self, news_ids: list[str], size: int) -> list[pathlib.Path]:
    candidates = self.load_candidates(set(news_ids))
    self.folder.mkdir(parents = True, exist_ok = True)
    paths = []
    for start in range(0, len(news_ids), size):
      number = start // size + 1
      path = self.folder / f"batch_{number:02d}.md"
      path.write_text(self.render(number, news_ids[start:start + size], candidates), encoding = "utf-8")
      paths.append(path)
    return paths

  def load_candidates(self, ids: set[str]) -> dict[str, list[int]]:
    """Jev's candidates for each news (ranker top-K plus files named by number), in the ranker's order."""
    found: dict[str, dict[int, float]] = defaultdict(dict)
    with open(self.corpus / "candidates.csv", encoding = "utf-8", newline = "") as file:
      for row in csv.DictReader(file):
        if row["news_id"] in ids:
          rank = float(row["rank"]) if row["rank"] else float("inf")
          bills = found[row["news_id"]]
          bills[int(row["bill"])] = min(rank, bills.get(int(row["bill"]), float("inf")))
    return {news_id: sorted(bills, key = bills.get) for news_id, bills in found.items()}

  def render(self, number: int, news_ids: list[str], candidates: dict[str, list[int]]) -> str:
    parts = [f"# Batch {number:02d}: answer Jev's questions for {len(news_ids)} news\n",
             "You answer the same questions a system called Jev answered about Costa Rican news and the files (bills and "
             "other expedientes) of the Legislative Assembly. Your answers are compared with a person's and with Jev's, "
             "so answer each question on its own merits.\n",
             "## Rules\n", RULES, "## Output\n", OUTPUT, "## Questions\n", self.render_questions(),
             "## Deputies in office (2026-2030) and their party\n",
             "\n".join(f"- {deputy['name']}: {deputy['party']}" for deputy in self.context.roster()) + "\n"]
    for position, news_id in enumerate(news_ids, start = 1):
      news, cut = self.context.news(news_id)
      lines = [f"## News {position} of {len(news_ids)} · id {news_id}\n",
               f"Outlet: {news['outlet']} · Date: {news['date']}\n", f"Title: {news['title']}\n", "Text:\n",
               news["content"] + "\n"]
      if cut:
        lines.append(f"(The text is cut at {self.context.max_news_chars} characters, as Jev saw it.)\n")
      lines.append("Candidate files, in the order the system gave them:\n")
      for bill in candidates.get(news_id, []):
        lines.append(f"- {self.render_card(self.context.card(bill))}")
      parts.append("\n".join(lines) + "\n")
    return "\n".join(parts)

  @staticmethod
  def render_card(card: dict) -> str:
    bits = [str(card["number"]), card.get("name", "")]
    if card.get("date_filed"):
      bits.append(f"filed {card['date_filed'][:7]}")
    if card.get("proponents"):
      bits.append("proponents: " + ", ".join(f"{person['name']} ({person['party']})" if person.get("party") else person["name"]
                                             for person in card["proponents"]))
    if card.get("subjects"):
      bits.append("subjects: " + ", ".join(card["subjects"]))
    return " · ".join(bits)

  def render_questions(self) -> str:
    sections = [("gate", "About each candidate file (`explicit` / `implicit`) and the genre of the news", ["genre", "explicit", "implicit"]),
                ("details_news", "About the news as a whole (`news_answers`; only when you mark at least one file)", None),
                ("details", "About each file you mark (`bills.<number>.answers`; every question for every marked file)", None)]
    out = []
    for scope, title, keys in sections:
      out.append(f"### {title}\n")
      for key in keys or self.questions[scope]:
        spec = self.questions[scope][key]
        text = (spec["instructions"].replace("`news`", "the news").replace("`candidates.b<number>`", "the file")
                .replace("`bills.b<number>`", "the file").replace("`deputies`", "The deputy list below"))
        text = re.sub(r"(^|[.?!]\s+)the file", lambda match: f"{match.group(1)}The file", text)
        out.append(f"- `{key}` ({self.kind(spec)}): {text}")
        criteria = spec.get("criteria")
        if isinstance(criteria, dict):
          for option, meaning in criteria.items():
            label = {"true": "Yes", "false": "No"}.get(option, f"`{option}`")
            out.append(f"  - {label}: {meaning}")
        elif isinstance(criteria, list):
          for index, meaning in enumerate(criteria):
            out.append(f"  - {index}: {meaning}")
      out.append("")
    return "\n".join(out) + "\n"

  @staticmethod
  def kind(spec: dict) -> str:
    return {"noul": "yes/no: true or false", "choice": "choice: one option key", "score": "scale: one option number"}.get(spec["type"], spec["type"])
