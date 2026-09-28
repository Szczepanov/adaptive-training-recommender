## Summary

<!--
What changed? Name the behavior, module, or artifact—not just the files.
Why now? State the defect, requirement, or decision that motivated it.
What is the user or operational impact? Say "No user-visible change" when applicable.
Keep this to 2–5 bullets.
-->

## Linked work and scope

<!--
Use "Closes #123" only when this PR fully resolves that issue.
Link related issues, ADRs, plans, analysis documents, or follow-up work.
Call out meaningful out-of-scope items so reviewers can distinguish intentional omissions from gaps.

Example:
Closes #123
Related: ADR-0044, docs/plans/example.md
Out of scope: production backfill; tracked in #456
-->

## Validation

<!--
`make verify` is the canonical scope-aware handoff/PR gate. Record what actually ran and the exact
result. Do not duplicate the repository's verification matrix here and do not say "CI will validate it."

Use narrower or additional checks when required by the change (for example engine/policy simulations,
Firestore rules, UI/E2E/visual evidence, or a focused regression test). See CLAUDE.md §3 and AGENTS.md
"What CI gates" for the current contract.

For code PRs, record Serena usage exactly as required by AGENTS.md:
- Serena: not used
- Serena: used — <specific question it answered that text search/compiler did not>
-->

- [ ] `make verify` — pass, or blocked with the exact reason
- [ ] Required scope-specific checks completed, or not applicable — details below
- [ ] Manual verification completed, or not applicable — details below

Results:
- `command`: pass/fail — what it covered
- Manual check: scenario and observed result
- Serena: not used | used — <specific question answered>

## Risk and reviewer guidance

<!--
Point reviewers at the highest-risk seams and explain why.
State what could regress, compatibility concerns, migration/deployment implications, and rollback path.
If the change is low risk, give the concrete reason rather than only writing "Low risk."
-->

## Architecture and domain invariants

<!--
State only the items relevant to this PR and explain how each was checked. For untouched concerns,
write "Not applicable — <reason>" rather than mechanically checking every box.

Consider:
- Firestore writes remain user-scoped under users/{APP_USER_ID}/...; no default_user or top-level
  recovery snapshots.
- Calendar-date logic uses Europe/Warsaw; completed totalSteps remains D - 1.
- No credentials, tokens, service-account files, or raw health payloads are committed or exposed.
- Recommendation decision logic: POLICY_VERSION was evaluated; knowledge-registry ownership and
  policy-alignment tests remain consistent where decision-authority constants changed.
- Architecture/current-behavior docs and ADRs were updated when the contract or rationale changed.
- Schema, migration, compatibility, and rollback implications are explicit when persistence changes.
-->

## Screenshots or recordings

<!--
For user-visible changes, attach before/after evidence for affected desktop and mobile states.
For non-UI changes, write "Not applicable — <reason>."
-->
