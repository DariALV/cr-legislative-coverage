# CLAUDE.md

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
