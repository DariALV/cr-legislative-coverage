# CLAUDE.md

## Claude memory: STATUS and topic logs (always)

`claude_logs/` is the project's persistent memory across chats. It has two layers, so that what is read every chat stays small and the history is never lost:

- `claude_logs/STATUS.md`: **the current state**. What is true now in each topic, the decisions in force, the decisions still pending and the actions left waiting. It is short and gets rewritten, not appended. It is the handoff between chats: whatever one chat leaves open, this one or another can pick up from here.
- `claude_logs/<topic>.md`: **append-only journals**, one per topic. The history of what was done, how and why. Docs and STATUS get rewritten and lose things; the journals never do.
- `claude_logs/archive/`: the old daily logs (up to 2026-11-08), kept untouched. Their entries were copied verbatim into the topic journals, so don't read them.

Logs and STATUS are written in Spanish, like the chat.

### STATUS.md: always read it, always keep it current

- **Start of every chat:** read `STATUS.md` whole (it is small) before anything else. If the request touches a pending decision or waiting action listed there, say so.
- **Before writing it, read it again**, even if it was read earlier in the chat: another chat may have changed it in the meantime. Merge, never overwrite another chat's changes.
- **Write it whenever the state changes**, not only at the end:
  - a decision is taken: remove it from *Pendiente* and add it to *Decisiones vigentes* (or drop it, if it is only history);
  - a decision is left open (Claude proposed options, the user hasn't answered, or the chat ends first): add it to *Pendiente* with the question, the options, Claude's recommendation and the journal entry where it was discussed;
  - something finishes or changes state (an implementation, a run, a commit, a closed issue): update that topic's *Estado*;
  - something is left waiting (a run in progress, a commit not made, waiting on the user or on another machine): add it to *En espera*.
- At the latest, update it before proposing each commit and before the chat ends.
- Keep it short (aim for under ~100 lines). Remove what is no longer true; the history lives in the journals. Every line points to its journal entry (`ranker 2026-11-07 14:32`) or issue when relevant.

### Topic journals

Closed list of topics. Ask the user before creating a new one; anything that fits none goes to `general.md`.

| File | Covers | Issues |
|---|---|---|
| `data.md` | SIL scraping, bill base text and expositions, votes, deputies matcher, database audits | #16 #22 #65 #66 |
| `explorer.md` | local database explorer (`private_visuals/db_explorer`) | #67 |
| `embeddings.md` | embedding runner and variants, embedding analyzer, full news corpus | #6 #32 #38 |
| `sample.md` | manual labeled sample, pre-labeled batches, negatives review | #25–#31 |
| `ranker.md` | learning-to-rank, evolutionary ranker, fitness on GPU, folds and runs | #33 #41 #68 |
| `general.md` | repo rules (CLAUDE.md), issue housekeeping, machines, anything cross-cutting | — |

- Always log. Anything worth remembering goes in: decisions taken with the user (and the options discarded), observations about sources and data (e.g. "SIL has no X column"), what was implemented and how, caveats, errors and their fixes, counts and results of runs.
- Each entry starts with `## YYYY-MM-DD HH:MM — <title> (#<n>)` (local time, Costa Rica). The title must say what happened, because titles are the index Claude reads. Start it with `decisión:` when the entry records a decision taken, and with `pendiente:` when it leaves one open.
- Short entries: one per decision, result or finding, not one per step, ideally 3–8 lines. Long outputs (tables, run logs) go in `results/` and the entry links them.
- An entry that spans topics goes whole in its main topic. The other topic gets a one-line pointer (`## <date time> — ver ranker.md: <title>`).
- Never guess the time or the date. Right before writing each entry, read the clock with `date -u -d '-6 hours' "+%Y-%m-%d %H:%M"` (Git Bash; Costa Rica is UTC-6 with no daylight saving). Don't use `TZ=America/Costa_Rica`: Git Bash has no time zone data and silently gives UTC.
- Append-only. Never edit or delete past entries; if something turns out wrong, add a new entry that corrects it.
- **Append without reading:** write entries with a Bash heredoc (`cat >> claude_logs/<topic>.md <<'EOF' ... EOF`), never with Read + Edit, which loads the whole journal.
- **Never read a journal whole.** Read the titles (`grep -h '^## ' claude_logs/<topic>.md | tail -40`), then only the entries needed (`grep -A 15 '<title words>'`, or `tail -n 60` for the latest). Read a topic's titles only when the chat goes into that topic. Cross-topic timeline: `grep -h '^## ' claude_logs/*.md | sort | tail -40`. Past decisions: `grep -h '^## .*decisión:' claude_logs/*.md`.
- Log as you go, not only at the end of the chat, so nothing is lost if the session is cut.

## Code in English (always)

Everything inside code files is in English, even though the chat is in Spanish:

- Identifiers (variables, functions, classes, files, CLI flags), comments, docstrings, strings, log messages and CLI help.
- When proposing a design in chat, name things in English too (e.g. `evaluate(genes) -> fitness`, not `matriz_de_genes`), with the explanation in Spanish.

## Design before code

Don't write project code for an issue until its design and its caveats have been agreed with the user. Claude doesn't decide them alone, even when asked to "do everything you can". Running code is always fine: scripts, tests and inspecting data or sources.

- After reading the issue and the data, list the open decisions, each with the options and a recommendation, and wait for the user's answer. For example:
  - table schemas and fields;
  - inclusion, exclusion and flagging criteria;
  - changes in behavior (error handling, what gets overwritten);
  - what is stored or published;
  - where docs go and in what language.
- Also agree how each known caveat will be handled before implementing.
- If a new decision comes up halfway through, stop and ask. Don't pick one and report it afterwards.

## Commits

Follow the style of the existing commits (`git log`):

- Short, lowercase, single-line message: `<type>: <brief description> #<issue>`
  - e.g. `feature: url collector implemented closes #7`, `feature: metadata extraction #5`
- The type is normally `feature:`.
- Link the related issue with `#<number>`. Use `closes #<number>` only when the commit finishes that issue. Several issues are fine: `closes #3 closes #9`.
- If the commit genuinely doesn't relate to any issue, leave out the `#`. Don't force a link.
- Keep the body empty unless a short extra line is really useful.
- Add the `Co-Authored-By: Claude ...` trailer only when Claude makes the commit. Never add it to commits the user makes.
- Before committing, check the issues (`gh issue list --state all`) to pick the right number.

Before committing, show the user the proposed message, plus any suggestion (another issue that might fit, whether it should be `closes`, splitting the commit, etc.).

## Issues

- Read the issue's full description (`gh issue view <number>`), not just its title, before linking or closing it.
- When implementing an issue leaves caveats ("peros"), document them in a comment on that issue. They feed the report's limitations and considerations section. For example:
  - Content behind a paywall, or decisions about what is stored (full text vs. public fields only).
  - Heuristics that may give false positives or false negatives (e.g. filtering agency news by byline).
  - Data that was excluded and why (sections, agency content, broken dates), with rough counts when known.
  - Differences from what the issue originally asked for, and why.
  - Source quirks that affect the data (time zones, missing fields, how the site groups or labels things).
- Keep each caveat short and concrete, with numbers or examples when they exist.

## Stay issue-aware and commit often (always)

- Keep the issue list in mind all the time (`gh issue list --state all`), not only when committing. Whenever a topic comes up, check whether an issue already covers it or relates to it.
- If an issue matches what is being discussed (e.g. the conversation is exactly what #60 asks for), say so, and add a comment to that issue with the relevant findings, decisions or caveats.
- Right after implementing something, check which issue(s) it belongs to, so the work gets linked and, if it finishes the issue, closed.
- Commit as often as it makes sense: as soon as a coherent piece of work is done, propose the commit (following "Commits" above) instead of letting uncommitted changes pile up. Prefer several small, well-linked commits over one large mixed one.
