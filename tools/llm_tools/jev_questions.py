"""
Wording of every question asked to Jev (#34, #39). Kept apart from the request logic so the report can quote it as it
is and so changing a question never touches the code that sends it.

Questions name parts of the request state by path in backticks: `news`, `candidates.b25703`, `bills.b25703`,
`deputies`. A bill is any file the Asamblea numbers in the SIL (bills, appointments, investigative committees, rule
changes), not only bills of law: the hand-labeled sample counts all of them as coverage (#27, #29).
"""
from typesafe_sdk import Choice, Noul, Score

FILE_DEFINITION = ("a file of Costa Rica's Legislative Assembly, identified by its expediente number: a bill of law, "
                   "a constitutional reform, an appointment, an investigative committee or a change to the Assembly's "
                   "rules")

# ---- gate: 3 yes/no questions per candidate, one request per news ----

GATE_QUESTIONS = ["explicit", "implicit", "same_topic"]
MATCH_QUESTIONS = ["explicit", "implicit"]   # a candidate is a match when either reaches Config.JEV_MATCH_THRESHOLD

def gate_questions(key: str) -> dict:
  """Gate questions for the candidate stored at candidates.<key>."""
  bill = f"`candidates.{key}`"
  return {
    "explicit": Noul(
      instructions = f"Does `news` identify {bill} directly, by its expediente number, its official name, or a "
                     f"nickname for it? {bill} is {FILE_DEFINITION}.",
      criteria = {"true": "The news gives this file's expediente number, quotes its official title, or uses a "
                          "nickname that refers to this file.",
                  "false": "The news never names this file, even if it discusses a similar subject."}),
    "implicit": Noul(
      instructions = f"Does `news` talk about {bill} without naming it, by describing what it would do or change, "
                     f"or by pointing to who proposed it or where it stands in the Assembly? {bill} is "
                     f"{FILE_DEFINITION}.",
      criteria = {"true": "The news describes this specific file, or says who proposed it or what step it is in, "
                          "without giving its number or title.",
                  "false": "The news does not describe this specific file."}),
    "same_topic": Noul(
      instructions = f"Is `news` about the same public problem or subject that {bill} deals with, whether or not "
                     f"it mentions the file?"),
  }

# ---- filter: one question per news, asked over the whole corpus before the ranker and the gate (#43) ----

def filter_questions() -> dict:
  """The broad news-level question: tested on 832 news (all 102 positives of the sample pass, 526 of 532 gold news
  with threshold 0.2; general 2026-11-08 20:52). The narrower «bill» question lost 14-23 % of the positives."""
  return {
    "assembly": Noul(
      instructions = "Does `news` talk about the Legislative Assembly or about a proposed law, even without naming a "
                     "specific bill?",
      criteria = {"true": "The news reports or comments on a bill, a proposed reform, a vote, a committee or the "
                          "plenary session, or on what deputies are doing as legislators.",
                  "false": "The news is about something else, and the Assembly or any proposed law does not come up."}),
  }

GENRES = {
  "news_report": "A news report on recent events.",
  "opinion": "An opinion column, editorial or letter, where the author argues a position.",
  "interview": "An interview, mostly the questions and answers of one person.",
  "analysis": "An analysis, explainer or long feature that goes beyond the latest event.",
}

def genre_question() -> Choice:
  return Choice(instructions = "What kind of piece is `news`?", criteria = GENRES)

# ---- details: only for the bills that passed the gate, one request per news ----

PARTIES = {
  "pueblo_soberano": "Pueblo Soberano (PPSO), the governing party since May 2026. News call it «el oficialismo» when "
                     "they talk about the Assembly that took office in May 2026; «el oficialismo» of the previous "
                     "Assembly (2022-2026) was another party and does not count as Pueblo Soberano",
  "liberacion_nacional": "Liberación Nacional (PLN)",
  "frente_amplio": "Frente Amplio (FA)",
  "unidad_social_cristiana": "Unidad Social Cristiana (PUSC)",
  "agenda_ciudadana": "Coalición Agenda Ciudadana (CAC)",
}
POSITIONS = {
  "not_mentioned": "The news does not say what this actor thinks of the file.",
  "strongly_against": "The actor firmly opposes the file.",
  "against": "The actor has objections to the file or leans against it.",
  "neutral_or_divided": "The actor's position is neutral, undecided, or its members are split.",
  "in_favor": "The actor supports the file, maybe with reservations.",
  "strongly_in_favor": "The actor firmly supports or champions the file.",
}
VOICES = {
  "voice_business": "business owners, chambers of commerce or industry associations",
  "voice_labor": "unions or workers",
  "voice_experts": "academics, researchers or independent experts",
  "voice_civil_society": "non-profit organizations, activists or community groups",
  "voice_institutions": "public institutions other than the Assembly and the Executive (for example CCSS, the "
                        "Comptroller General, the Ombudsman, the Constitutional Court or a municipality)",
  "voice_affected": "people directly affected by the file, speaking for themselves",
}
STAGES = {
  "filing": "The file was just presented or is waiting to start in committee.",
  "committee": "The file is being discussed or reported in a committee.",
  "first_debate": "The file is in the plenary for, or just went through, the first debate.",
  "second_debate": "The file is in the plenary for, or just went through, the second and final debate.",
  "veto_or_signing": "The file was approved and is being signed, vetoed or published as law.",
  "constitutional_court": "The file is under review by the Constitutional Court (Sala IV).",
  "archived_or_rejected": "The file was archived, rejected or withdrawn.",
  "not_stated": "The news does not say where the file stands.",
}
CONTENT = {
  "explains_content": "Does `news` explain what {bill} would do or change?",
  "explains_impact": "Does `news` say who would be affected by {bill} or what its consequences would be?",
  "gives_figures": "Does `news` give figures about what {bill} would do or cause, such as costs, amounts, rates or "
                   "numbers of people affected? Expediente numbers, law numbers, dates and vote counts do not count.",
  "conflict_frame": "Does `news` present {bill} mainly as a fight between political actors, rather than explaining "
                    "the file itself?",
}

DETAIL_QUESTIONS = (["centrality", "stance", "author_judges", "new_development"] + list(PARTIES) + ["executive"]
                    + list(VOICES) + ["stage"] + list(CONTENT))

def detail_questions(key: str) -> dict:
  """Detail questions for the bill stored at bills.<key>."""
  bill = f"`bills.{key}`"
  questions = {
    "centrality": Score(
      instructions = f"How much of `news` is about {bill}?",
      criteria = ["The file appears in passing, in one sentence or in a list, and the news is about something else.",
                  "The file is one part of the news but not its main subject.",
                  "The news is mainly about the file."]),
    "stance": Score(
      instructions = f"What opinion of {bill} does `news` convey as a whole, counting the people it quotes?",
      criteria = ["The news is strongly critical of the file.", "The news is mildly critical of the file.",
                  "The news is neutral or balanced about the file.", "The news is mildly favorable to the file.",
                  "The news is strongly favorable to the file."]),
    "author_judges": Noul(
      instructions = f"Does the author of `news`, and not a person the news quotes, say that {bill} is good or "
                     f"bad?"),
    "new_development": Noul(
      instructions = f"Does `news` report something that just happened to {bill} in the legislative process, such "
                     f"as its filing, a committee report, a vote, a veto or its publication as law?"),
  }
  for party, name in PARTIES.items():
    questions[party] = Choice(
      instructions = f"What position on {bill} does `news` attribute to the party {name}, through its deputies or "
                     f"spokespeople? `deputies` lists each deputy's party.",
      criteria = POSITIONS)
  questions["executive"] = Choice(
    instructions = f"What position on {bill} does `news` attribute to the Executive Branch: the President, a "
                   f"minister or a government spokesperson?",
    criteria = POSITIONS)
  for voice, who in VOICES.items():
    questions[voice] = Noul(instructions = f"Does `news` quote or paraphrase {who} about {bill}?")
  questions["stage"] = Choice(instructions = f"According to `news`, where does {bill} stand in the legislative "
                                             f"process?", criteria = STAGES)
  for name, text in CONTENT.items():
    questions[name] = Noul(instructions = text.format(bill = bill))
  return questions
