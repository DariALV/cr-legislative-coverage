# CLAUDE.md

## Commits

Follow the style of the existing commits (`git log`):

- Short, lowercase, single-line message: `<type>: <brief description> #<issue>`
  - e.g. `feature: url collector implemented closes #7`, `feature: metadata extraction #5`
- The type is normally `feature:`.
- Link the related issue with `#<number>`. Use `closes #<number>` only when the commit finishes that issue. Several issues are fine: `closes #3 closes #9`.
- If the commit genuinely doesn't relate to any issue, leave out the `#`. Don't force a link.
- Keep the body empty unless a short extra line is really useful.
- Before committing, check the issues (`gh issue list --state all`) to pick the right number.

Before committing, show the user the proposed message, plus any suggestion (another issue that might fit, whether it should be `closes`, splitting the commit, etc.).
