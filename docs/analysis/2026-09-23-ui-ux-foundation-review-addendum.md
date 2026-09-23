# Addendum: UI/UX foundation documentation follow-up

This addendum records documentation changes made after publication of the
[UI/UX foundation review](./2026-09-23-ui-ux-foundation-review.md). The original review
remains unchanged as a record of its findings and resulting changes at publication time.

## Follow-up changes

- The UI/UX standard now links the session-execution architecture reference to the
  accessibility and active-workout experience requirements.
- The visual-review instructions distinguish finalized review bundles from ad hoc
  Playwright captures. `npm run visual:refresh` prepares and finalizes the desktop and
  standard mobile bundle; a direct `npx playwright test` capture for the narrow and wide
  projects does not update the review manifest or contact sheet.
- The documentation hub now directs later discoveries to a new dated analysis, a tracked
  plan, or an issue rather than editing a published analysis.
