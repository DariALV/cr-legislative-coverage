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

# ---- gate: 2 yes/no questions per candidate, one request per news ----
# same_topic was dropped (jev 2026-11-10): almost every negative had some candidate on the same topic, so it did not
# separate them, and it weighed ~8 % of the gate.

GATE_QUESTIONS = ["explicit", "implicit"]
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
  # rewritten (jev 2026-11-10): the first wording fired on deputies and institutions (17 of 24 yes quoted a deputy)
  "voice_affected": "ordinary people directly affected by the file, speaking for themselves",
}
STAGES = {
  "filing": "The file was just presented or is waiting to start in committee.",
  "committee": "The file is being discussed in a committee, or the committee just approved its report and the file "
               "now waits for the plenary.",
  "first_debate": "The plenary is discussing the file in first debate, or just voted it in first debate.",
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
                   "numbers of people affected? Penalties such as years in prison or fines count. Expediente numbers, law numbers, "
                   "dates and vote counts do not count.",
  "conflict_frame": "Does `news` present {bill} mainly as a fight between political actors, rather than explaining "
                    "the file itself?",
}

# Second round of detail questions (jev 2026-11-10): asked only for the matched bills, to test them on 100 news
# before deciding which ones go over the corpus.
PROCESS = {
  "in_headline": "Does the title of `news` refer to {bill}?",
  "names_proponent": "Does `news` say who proposed {bill}?",
  "deputy_quoted": "Does `news` quote or paraphrase a deputy about {bill}?",
  "background": "Does `news` give background on {bill}, such as when it was filed or what happened to it before?",
  "explains_procedure": "Does `news` explain how the legislative process works for {bill}, for example what a debate, "
                        "a committee report, a fast track or a waiver of procedures means, or how many votes it "
                        "needs?",
  "vote_reported": "Does `news` report how {bill} was voted, such as the vote count or how deputies or parties voted?",
  "votes_outlook": "Does `news` say whether {bill} has or lacks the votes it needs to pass?",
  "constitutionality": "Does `news` raise doubts about the constitutionality of {bill}, or mention a consultation or "
                       "a ruling of the Constitutional Court (Sala IV) about it?",
  "international": "Does `news` compare {bill} with other countries, or cite international organizations (such as "
                   "the OECD, the IMF or the UN) about it?",
  "human_story": "Does `news` illustrate {bill} with the case of a specific person or family?",
  # third round (jev 2026-11-10)
  "next_step": "Does `news` say what comes next for {bill} in the legislative process, such as its next debate, "
               "the committee or plenary it goes to, or a vote that is scheduled?",
}

# Dropped after test100 (jev 2026-11-10): fact_check (even rewritten it found ~3 of 5 checks, it is rare and its
# recall cannot be measured on the sample), and fast_track, pressure_groups, public_opinion, independents,
# executive_agenda, deadline and funding (5 % yes or less in 83 pairs: too few cases to compare outlets); then
# own_evidence (missed 16 of ~35 uses of the bill's text) and source_count (over-counted in 19 of 46 news).

DETAIL_QUESTIONS = (["centrality", "stance", "author_judges", "new_development"] + list(PARTIES)
                    + ["executive"] + list(VOICES) + ["stage"] + list(CONTENT) + list(PROCESS))

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
  questions["voice_affected"] = Noul(
    instructions = f"Does `news` quote or paraphrase ordinary people directly affected by {bill}, speaking for "
                   f"themselves?",
    criteria = {"true": "The news quotes or paraphrases people who live the consequences of the file in their own "
                        "lives, such as patients, students, workers, pensioners, residents or their relatives.",
                "false": "The only people quoted are deputies, ministers or other officials, public institutions, "
                         "unions, chambers, organizations, experts or the author."})
  questions["stage"] = Choice(instructions = f"According to `news`, where does {bill} stand in the legislative "
                                             f"process?", criteria = STAGES)
  for name, text in (CONTENT | PROCESS).items():
    questions[name] = Noul(instructions = text.format(bill = bill))
  return questions

# ---- details, news level: asked once per news inside the details request, only for news with a match ----

NEWS_KEY = "news"   # answer names are news_<question>, next to the b<number>_<question> of each bill

FRAMES = {
  "conflict": "A disagreement between political actors: who attacks whom, who wins or loses.",
  "economic": "The economic consequences of the issue: costs, gains, jobs, prices or taxes.",
  "human_interest": "The personal or emotional side of the issue, told through people affected by it.",
  "responsibility": "Who caused a problem or who should solve it.",
  "morality": "Moral or religious principles, what is right or wrong.",
  "policy": "What a public policy or a bill does and how it would work.",
}

NEWS_DETAIL_QUESTIONS = ["press_release", "main_frame", "assembly_image", "headline_misleading"]

def news_detail_questions() -> dict:
  return {
    # Rewritten after reading the test100 cases (jev 2026-11-10): the first wording also caught summaries of a bill's
    # text and reports with their own context. Read it together with genre: it only counts for news_report.
    "press_release": Noul(
      instructions = "Is `news` a news report that mainly passes on one source's statement, announcement or "
                     "communiqué (an institution, a party, a deputy, a union, an organization or a government "
                     "office) in that source's own words and framing, with little or no reporting of its own?",
      criteria = {"true": "The text is built around one source's announcement or statement: it quotes and "
                          "paraphrases that source, takes its side, and adds no other voices, no reactions, and at "
                          "most a sentence or two of background.",
                  "false": "The text is an opinion column or signed commentary, an interview or an analysis; or it is "
                           "reporting that adds other sources, reactions, data or background; or the reporter "
                           "explains a document (a bill's text and exposition of motives, a vote, a technical report) "
                           "in their own words rather than relaying someone's statements."}),
    "main_frame": Choice(instructions = "What is the dominant frame of `news`?", criteria = FRAMES),
    "assembly_image": Score(
      instructions = "How does `news` portray the Legislative Assembly as an institution?",
      criteria = ["Very negatively: useless, corrupt, obstructive or out of touch.",
                  "Somewhat negatively.",
                  "Neutrally, or the news does not judge the Assembly as a whole.",
                  "Somewhat positively.",
                  "Very positively: effective, responsive or doing its job well."]),
    "headline_misleading": Noul(
      instructions = "Does the title of `news` exaggerate or contradict what its content says?"),
  }
