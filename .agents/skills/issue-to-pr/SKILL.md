---
name: issue-to-pr
description: Implement a GitHub issue end-to-end from its number — read issue plus history, analyze docs and code, write a plan, implement it, verify docs and repo checks, and open a linked PR. Use when the user gives a GitHub issue number to implement.
---

# Issue to PR: GitHub Issue Implementation Workflow

You take a GitHub issue number as input and drive it to an opened PR: issue intake, docs/code analysis, detailed plan, implementation, docs verification, static checks, PR creation.

## Input

- Required: GitHub issue number `N` (accepts `123`, `#123`, or an issue URL — extract `N`).
- If `N` is missing or ambiguous, ask for it and stop. Do not guess which issue to implement.
- Optional overrides: base branch (default `main`), plan-approval gate (default on for high-risk changes, see Phase 4), draft PR vs ready PR.

## Phase 0 — Preconditions (do first, every time)

1. Read `AGENTS.md` (system constraints, command cheat sheet) and `docs/README.md` (which doc directory is authoritative for what).
2. Confirm starting state of the main checkout (you will not work in it):
   - `git status --short --branch`
   - `git log --oneline -5`
   - `git worktree list` — an existing worktree/branch for this issue.
3. Create an isolated worktree from updated `main` — never implement in the main checkout:
   ```bash
   git fetch origin
   git worktree add ../<repo>-issue-<N>-<short-slug> -b issue-<N>-<short-slug> origin/main
   ```
   - `<repo>` is the top-level directory basename (`Split-Path (git rev-parse --show-toplevel) -Leaf`), so the pattern stays reusable across repos; sibling placement keeps the main checkout's `git status` clean.
   - If a worktree or the `issue-<N>-*` branch already exists and is yours and clean, reuse it instead of creating a new one. If it belongs to someone else or is dirty, stop and ask.
   - Record the worktree path as `WORKTREE`. Every later phase runs there: shell commands via workdir, file tools via absolute paths under `WORKTREE`.
   - A fresh worktree shares no installed dependencies: run the repo's install step there first if you will execute checks (`make install`, or the targeted subset).
4. Rules for the whole run:
   - Never commit secrets: `.env`, `.garth/`, Firebase service-account files, raw health JSONs.
   - Never write recovery docs to `daily_recovery_snapshot/{date}` or with `"default_user"`. User-scoped path only: `users/{APP_USER_ID}/daily_recovery_snapshots/{YYYY-MM-DD}`.
   - Calendar dates use `Europe/Warsaw` (`local_today()` in Python, `getLocalDateString()` in TypeScript). Never `toISOString().split('T')[0]` for calendar dates.
   - `totalSteps` means the completed previous calendar day (`D - 1`); do not reinterpret it without touching `fatigue.ts` deduction logic.
    - Reference symbols, never line numbers, in docs and plans (e.g. `` `rules.ts` `evaluateEnvelopes` ``).
    - Work in `WORKTREE` on its feature branch, never directly on `main` and never in the main checkout. One issue = one worktree = one branch unless the user says otherwise.

## Phase 1 — Read the GitHub issue and its history

Fetch, do not paraphrase from memory:

```bash
gh issue view <N> --json number,title,body,state,labels,assignees,milestone,url,createdAt,updatedAt,author
gh issue view <N> --comments
```

Then check for prior/related work so you do not duplicate or contradict it:

- `gh pr list --limit 100 --json number,title,state,headRefName,baseRefName,body --search "#<N>"` (PRs mentioning the issue).
- `git log --oneline --grep="#<N>" -20` and `git log --oneline --grep="<N>" -20`.
- `git branch -a | grep -i "<N>"` for existing issue branches.

Summarize back, briefly:

- Issue title, state (open/closed), labels, assignee.
- The actual request in 2–4 bullets (problem, desired behavior, acceptance criteria if stated).
- History: key comment decisions, scope changes, rejected approaches, linked PRs/issues.
- Ambiguities or missing acceptance criteria. If the issue is ambiguous about scope or success criteria, ask before coding.

## Phase 2 — Analyze the docs (routing matters)

Follow the `docs/README.md` precedence: **code wins, then `architecture/`, then `adr/`, then everything else.** Never treat a dated `analysis/` finding or an `Implemented`/`Archived` plan as a live instruction — verify against code.

1. If changing engine decision behavior, read `docs/architecture/recommendation-engine.md` first, then the relevant ADR, then `docs/analysis/2026-08-08-architecture-review.md` for known divergences.
2. Map the issue to its entry point from the `docs/README.md` task table (Firestore/schema → ADR-0002 + ADR-0010 + `app/firestore.rules`; dates/steps → ADR-0003; workouts → `docs/workout-library.md` + ADR-0004; session authoring/execution → session-execution architecture + ADR-0023; deployment/backfill → `docs/ops/`).
3. Record which docs describe intended design (ADRs) vs current behavior (`architecture/`). Note any doc↔code disagreement explicitly instead of silently picking one.

## Phase 3 — Analyze the code and related artifacts

- Locate affected modules using the `AGENTS.md` package-architecture map (`src/garmin_sync/`, `app/src/engine/`, `app/src/sessions/`, `app/src/responses/`, `app/src/observations/`, `app/src/outcomes/`, `app/src/knowledge/` — directory wins over the map).
- Use search/read tools, not assumptions: find definitions, callers, validators, and existing tests/fixtures for each touched area.
- Identify: reusable utilities, existing test fixtures (`tests/fixtures/`, engine `tests/`, `simulation/`), schema validators, and the `TrainingHistoryProvider` / Firestore boundaries if history or persistence is involved.
- Check `app/src/engine/policy.ts` `POLICY_VERSION` relevance early: if the issue changes recommendation decision logic, a version bump plus `node scripts/check-policy-drift.mjs <base-sha>` will be required later.

## Phase 4 — Create the detailed implementation plan

Write the plan out (in chat, and only create a `docs/plans/` file if the repo conventions call for a durable plan — most single-issue fixes should not create one). Structure:

```markdown
# Implementation Plan: #<N> <short title>
## Goal (2–3 sentences + success criteria)
## Scope (in / out)
## Docs & code findings (doc refs, symbols, current behavior)
## Steps (ordered, each: action, exact file + symbol, dependencies, risk, rollback)
## Tests (new/updated tests + exact verification commands)
## Docs updates required (architecture/ADR/plan changes, POLICY_VERSION yes/no)
## Risks & mitigations
```

- Order steps contracts/models → core logic → adapters/UI → tests → docs.
- Each step must leave the tree compiling/passing.
- **Approval gate:** present the plan and wait for approval when the change (a) alters engine decision logic, Firestore rules/schema, auth, ingestion, or deployment, (b) is high-risk or irreversible, or (c) the issue was ambiguous. For trivial, well-specified fixes, state the plan briefly and proceed — do not over-ceremonialize.

## Phase 5 — Implement the plan

1. Worktree and branch already exist from Phase 0 — verify before touching code:
   - `git -C WORKTREE status --short --branch` shows the `issue-<N>-<short-slug>` branch with a clean tree on top of recent `origin/main`.
   - If the worktree is missing or dirty, stop and fix that first; never fall back to implementing in the main checkout silently.
2. Implement step by step, keeping diffs minimal and following existing patterns, lint rules, and type constraints.
3. Add or update tests alongside behavior (synthetic fixtures only — no live API calls in tests).
4. Commit in logical increments with messages referencing the issue (e.g. `fix(engine): ... (#<N>)`). Never commit secrets, never `git push --force` on shared branches, never amend a hook-rejected commit — fix and recommit.

## Phase 6 — Verify related docs were updated properly

Before running checks, confirm:

- [ ] If decision logic changed: `POLICY_VERSION` bumped in `app/src/engine/policy.ts`, and `docs/architecture/recommendation-engine.md` (current behavior) updated; ADR updated only if intent/rationale changed.
- [ ] If Firestore paths, rules, or schema changed: ADR-0002/ADR-0010 consistency + `app/firestore.rules` + relevant `docs/architecture/` page.
- [ ] If workouts/templates changed: `docs/workout-library.md` contract still holds.
- [ ] No line-number references added to docs; no present-tense problem statements left in a finished plan.
- [ ] Any doc↔code divergence found was either fixed in the doc or recorded in the current review document, with the choice stated.

## Phase 7 — Static analysis and tests with repository tools

All commands run in `WORKTREE` (shell workdir / `git -C WORKTREE`). A fresh worktree has no installed dependencies — run the repo install step there first if checks fail with missing modules.

Run the narrow checks first, then widen. Use the Makefile as the authority (`make help` lists targets):

| Touching… | Run |
|---|---|
| Python backend | `uv run ruff check .`, `uv run ruff format --check .`, `uv run mypy`, `uv run pytest` |
| TypeScript frontend | `cd app && npm run check` (tsc + eslint + vitest + workout validation); narrow: `npm run typecheck`, `npm run lint`, `npm run test`, `npm run validate:workouts` |
| Firestore rules | `cd app && npm run test:rules` (needs Java / emulator) |
| Recommendation engine | `cd app && npm run simulate:scenarios`, `cd app && npm run simulate:diff`, `node scripts/check-policy-drift.mjs <base-sha>` when decision logic changed |
| Material UI change | `cd app && npm run visual:refresh` (after `npm run visual:install` once) |
| Mixed / unsure | `make check` (ruff + mypy + pytest + tsc + eslint + vitest + workout validation); engine changes add `make simulate`; release readiness adds `make build` |

- Prefer `make check` / `make simulate` / `make build` over ad-hoc commands when verifying the whole change.
- `npm run dev` runs a `check` pre-flight; do not use it as a substitute for the explicit checks above.
- Record exact command plus pass/fail for the PR body. If an applicable check is skipped, say why — never claim CI will cover it.
- Fix failures in place; re-run the affected scope until green. Do not open a PR on red checks without explicit user instruction.

## Phase 8 — Create the PR with detailed description and linked issue

1. Push the branch from the worktree: `git -C WORKTREE push -u origin issue-<N>-<short-slug>`.
2. Verify what the PR will contain: `git -C WORKTREE status`, `git -C WORKTREE diff --stat origin/main...HEAD`, `git -C WORKTREE log --oneline origin/main..HEAD`.
3. Create the PR (use `--draft` only if checks are incomplete or the user asked):
   ```bash
   gh pr create --base main --head issue-<N>-<short-slug> \
     --title "<type>(<scope>): <behavior change> (#<N>)" \
     --body "$(cat <<'EOF'
   ## Summary
   - What changed (behavior/module, not just files) and why now.
   - User/operational impact, or "No user-visible change" with reason.
   - Closes #<N>. Related ADR/plan/analysis links.
   ## Validation
   - [x] `command`: pass — what it covered
   - Manual check: scenario + observed result (or why N/A)
   ## Risk and reviewer guidance
   - What to inspect closely, what could regress, migration/deployment/rollback notes.
   ## Domain invariants
   - Firestore writes remain user-scoped ... — how checked.
   - Calendar-date logic uses `Europe/Warsaw`; `totalSteps` still `D - 1` — how checked.
   - No credentials/tokens/service-account files/raw health payloads included.
   - Decision logic changed: POLICY_VERSION evaluated (bumped/not needed because ...) + docs updated.
   ## Screenshots or recordings
   - Before/after evidence for UI changes, else "Not applicable — [reason]."
   EOF
   )"
   ```
4. Follow the repo's `.github/pull_request_template.md` sections (Summary / Validation / Risk and reviewer guidance / Domain invariants / Screenshots). Always include `Closes #<N>` so the issue links automatically.
5. Return the PR URL plus a one-paragraph summary: what merged-readiness state it is in, which checks passed, and any follow-ups.
6. Cleanup: leave the worktree in place until the PR is merged (reviewers may ask for follow-ups). After merge, or if the run is abandoned:
   - `git worktree remove ../<repo>-issue-<N>-<short-slug>` (never `--force` on a dirty tree — ask first).
   - `git worktree prune` to drop stale entries.

## Stop conditions — ask instead of guessing

- Issue number missing, issue closed with no reopen instruction, or two issues could match.
- A worktree or `issue-<N>-*` branch already exists that is not yours, or is dirty — reuse-or-delete needs your call.
- Acceptance criteria absent and the correct behavior is a product decision.
- The fix requires credentials, live API calls, production data access, or destructive migration.
- Static checks fail for reasons outside the issue scope — report, do not silently expand scope.
