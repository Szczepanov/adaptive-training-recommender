## Summary

<!--
What changed? Name the behavior, module, or artifact—not just the files.
Why now? State the defect, requirement, or decision that motivated it.
What is the user or operational impact? Say "No user-visible change" when applicable.
Keep this to 2–5 bullets. Link the issue, ADR, plan, or analysis document when relevant.
-->

## Validation

<!--
For every applicable check, replace the checkbox with [x] and record the exact outcome below.
For any skipped applicable check, leave it unchecked and explain why. Do not claim CI will validate it.
Include focused manual verification when an automated check cannot prove the change.

Results:
- `command`: pass/fail; what it covered
- Manual check: scenario and observed result
-->

- [ ] `uv run pytest` (backend changes)
- [ ] `uv run ruff check .` and `uv run mypy src/garmin_sync` (backend changes)
- [ ] `cd app && npm run check` (frontend changes)
- [ ] `cd app && npm run test:rules` (Firestore rules changes)
- [ ] `cd app && npm run simulate:scenarios` (recommendation-engine changes)
- [ ] `cd app && npm run visual:refresh` (material UI changes)

## Risk and reviewer guidance

<!--
What should a reviewer inspect most closely, and why?
What could regress? Include data migration, deployment, compatibility, or rollback notes.
Say "Low risk: ..." only with a concrete reason. Link relevant ADRs, architecture docs, or issues.
-->

## Domain invariants

<!--
For each invariant touched by this change, replace [ ] with [x] and state how it was checked.
If none apply, delete the checklist and write "Not applicable — [reason]."
-->

- [ ] Firestore writes remain user-scoped under `users/{APP_USER_ID}/...`; no `default_user` or top-level recovery snapshots were introduced.
- [ ] Calendar-date logic uses `Europe/Warsaw`; completed `totalSteps` still means the previous calendar day (`D - 1`).
- [ ] No credentials, tokens, service-account files, or raw health payloads are included.
- [ ] Recommendation decision logic changed: `POLICY_VERSION` was evaluated and relevant architecture/ADR documentation was updated.

## Screenshots or recordings

<!--
For user-visible changes, attach before/after evidence for the affected desktop and mobile states.
For non-UI changes, write "Not applicable — [reason]."
-->
