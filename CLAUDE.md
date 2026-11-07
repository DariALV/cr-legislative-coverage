# CLAUDE.md

## Claude logs (always)

`claude_logs/` is the project's persistent memory across chats: a history of what was done, how, and why. Docs get updated and lose things; the logs never do.

- Always log. Anything worth remembering goes in: decisions taken with the user (and the options discarded), observations about sources and data (e.g. "SIL has no X column"), what was implemented and how, caveats, errors and their fixes, counts and results of runs.
- One file per day: `claude_logs/YYYY-MM-DD.md`. Each entry starts with `## HH:MM — <short title>` (local time, Costa Rica) and says what happened and why, linking issues (`#<n>`) and files when relevant.
- Append-only. Never edit or delete past entries; if something turns out wrong, add a new entry that corrects it.
- Log as you go, not only at the end of the chat, so nothing is lost if the session is cut.
- At the start of a chat, read the recent logs to pick up the context.

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
