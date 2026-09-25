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
   - `<repo>` is the top-level directory basename (`basename "$(git rev-parse --show-toplevel)"`), so the pattern stays reusable across repos; sibling placement keeps the main checkout's `git status` clean.
   - If a worktree or the `issue-<N>-*` branch already exists and is yours and clean, reuse it instead of creating a new one. If it belongs to someone else or is dirty, stop and ask.
   - If the session already runs inside a clean harness-created worktree (e.g. a `claude/...` branch made by the desktop app), use that as `WORKTREE` instead of creating a sibling; do not nest worktrees.
   - Shell examples in this skill are bash (Git Bash on Windows). In PowerShell, use the equivalent: `Split-Path (git rev-parse --show-toplevel) -Leaf` for `basename "$(git rev-parse --show-toplevel)"`, and a single-quoted here-string `@'...'@` instead of a heredoc.
   - Record the worktree path as `WORKTREE`. Every later phase runs there: shell commands via workdir, file tools via absolute paths under `WORKTREE`.
   - A fresh worktree shares no installed dependencies: run the repo's install step there first if you will execute checks (`make install`, or the targeted subset).
4. Rules for the whole run:
   - Never commit secrets: `.env`, `.garth/`, Firebase service-account files, raw health JSONs.
   - Never write recovery docs to `daily_recovery_snapshot/{date}` or with `"default_user"`. User-scoped path only: `users/{APP_USER_ID}/daily_recovery_snapshots/{YYYY-MM-DD}`.
   - Calendar dates use `Europe/Warsaw` (`local_today()` in Python, `getLocalDateString()` in TypeScript). Never `toISOString().split('T')[0]` for calendar dates.
   - `totalSteps` means the completed previous calendar day (`D - 1`); do not reinterpret it without touching `fatigue.ts` deduction logic.
   - Knowledge lineage (ADR-0033): every engine threshold, weight, cadence or policy constant with decision authority is owned by a registered claim. Check the registry before changing one (Phase 3).
   - Reference symbols, never line numbers, in docs and plans (e.g. `` `rules.ts` `evaluateEnvelopes` ``).
   - Work in `WORKTREE` on its feature branch, never directly on `main` and never in the main checkout. One issue = one worktree = one branch unless the user says otherwise.
   - If Serena is available, semantic reads must come from `WORKTREE`, not the checkout that
     happened to be active when the MCP server started. Activate/retarget Serena to the absolute
     `WORKTREE` path and verify it before using symbol tools. If that cannot be done safely,
     skip Serena for this run and use ordinary repository search/read tools.

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
- For long threads (more than ~30 comments), read the body, the latest ~15 comments and any maintainer decisions in full; skim the rest for scope changes instead of pasting everything into context.
- Ambiguities or missing acceptance criteria. If the issue is ambiguous about scope or success criteria, ask before coding.

## Phase 2 — Analyze the docs (routing matters)

First check `docs/plans/README.md`, the authoritative status board: the issue may already be shipped, in progress under another plan, or deliberately shadow-mode only. Never infer delivery status from a file's existence.

Follow the `docs/README.md` precedence: **code wins, then `architecture/`, then `adr/`, then everything else.** Never treat a dated `analysis/` finding or an `Implemented`/`Archived` plan as a live instruction — verify against code.

1. If changing engine decision behavior, read `docs/architecture/recommendation-engine.md` first, then the relevant ADR, then `docs/analysis/2026-08-08-architecture-review.md` for known divergences.
2. Map the issue to its entry point from the `docs/README.md` task table (Firestore/schema → ADR-0002 + ADR-0010 + `app/firestore.rules`; dates/steps → ADR-0003; workouts → `docs/workout-library.md` + ADR-0004; session authoring/execution → session-execution architecture + ADR-0023; deployment/backfill → `docs/ops/`).
3. Record which docs describe intended design (ADRs) vs current behavior (`architecture/`). Note any doc↔code disagreement explicitly instead of silently picking one.

## Phase 3 — Analyze the code and related artifacts

- Locate affected modules using the `AGENTS.md` package-architecture map (`src/garmin_sync/`, `app/src/engine/`, `app/src/sessions/`, `app/src/responses/`, `app/src/observations/`, `app/src/outcomes/`, `app/src/knowledge/` — directory wins over the map).
- When Serena is available and correctly bound to `WORKTREE`, use semantic navigation first for
  source-code discovery: `get_symbols_overview` / `find_symbol` to locate the target,
  `find_referencing_symbols` for callers/impact radius, and `find_implementations` for
  polymorphic contracts. Use Grep/text search for literals, docs/config, generated files,
  unsupported language-server cases, and as a completeness check. Never use semantic results from
  a different checkout.
- Identify: reusable utilities, existing test fixtures (`tests/fixtures/`, engine `tests/`, `simulation/`), schema validators, and the `TrainingHistoryProvider` / Firestore boundaries if history or persistence is involved.
- When correctness depends on an external library/API contract, use Context7 for current,
  version-appropriate documentation as defined by `docs/standards/agent-tooling.md`. Do not use
  Context7 for repository-internal behavior.
- **Before changing any number in the engine** (threshold, weight, cadence, policy constant), check the knowledge registry: `app/src/knowledge/knowledgeCoverage.ts` (inventory), `app/src/knowledge/sportsKnowledgeRegistry.ts` (claims — the answer, or an explicit "evidence does not support one", is often already there), and the matching `*PolicyAlignment.test.ts`. Changing a constant means updating the claim and the alignment test together; if the issue asks for a value the registry contradicts, stop and ask.
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
- [ ] If an engine constant changed: the owning claim in `sportsKnowledgeRegistry.ts` and its `*PolicyAlignment.test.ts` were updated together. A **new** decision-authority rule has all three: claim, coverage item in `knowledgeCoverage.ts`, alignment test (ADR-0033).
- [ ] If Firestore paths, rules, or schema changed: ADR-0002/ADR-0010 consistency + `app/firestore.rules` + relevant `docs/architecture/` page.
- [ ] If workouts/templates changed: `docs/workout-library.md` contract still holds.
- [ ] No line-number references added to docs; no present-tense problem statements left in a finished plan.
- [ ] Any doc↔code divergence found was either fixed in the doc or recorded in the current review document, with the choice stated.

## Phase 7 — Static analysis and tests with repository tools

All commands run in `WORKTREE` (shell workdir / `git -C WORKTREE`). A fresh worktree has no installed dependencies — run the repo install step there first if checks fail with missing modules.

The canonical gate is `make verify` (defined in `scripts/verify_repo.py`, documented in `docs/standards/agent-tooling.md`). Do not recreate its command matrix here — it drifts.

- **Iterate** with the narrowest relevant check (`cd app && npm test`, `uv run pytest <path>`, `make check`; `make help` lists targets).
- **Finish** with `make verify`.
- **Docs-only change:** `uv run pre-commit run --all-files` is enough; skip the code/test/simulation suites.
- **Engine or policy change:** also `make simulate`, `cd app && npm run simulate:plan-judge`, and `node scripts/check-policy-drift.mjs <base-sha>` (all three gate CI). `simulate:diff` is advisory in CI — read it, do not block on it.
- **Firestore rules change:** `cd app && npm run test:rules` (needs Java + emulator).
- **Material UI change:** verify against `docs/standards/ui-ux.md`, run component tests and browser E2E, and `cd app && npm run visual:refresh` (after `npm run visual:install` once).
- `npm run dev` runs a `check` pre-flight; it is not a substitute for the checks above.
- Record exact command plus pass/fail for the PR body. If an applicable check is skipped, say why — never claim CI will cover it.
- Fix failures in place; re-run the affected scope until green. Do not open a PR on red checks without explicit user instruction.

## Phase 7.5 — Independent review (before the PR)

Do not rely on the implementer's own "checks passed" claim.

- Always run a read-only review of the branch diff (the `code-reviewer` subagent when available) against I1–I6, knowledge lineage and engine purity. Address CRITICAL/HIGH findings.
- If the change touches auth, Firestore rules/paths, ingestion, secrets or logging, also run `security-reviewer`.
- For engine, rules, auth or ingestion changes, have a separate read-only validator (`code-validator`) re-run the key checks and report command, working directory and exit code.
- Skip only for trivial docs-only changes, and say so in the PR.

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
5. Add any attribution footer your harness requires. If the host provides PR-tracking tools (e.g. the Claude desktop app's `ccd_pr` tools), bind the new PR there instead of polling CI yourself.
6. Return the PR URL plus a one-paragraph summary: what merged-readiness state it is in, which checks passed, and any follow-ups.
7. Cleanup: leave the worktree in place until the PR is merged (reviewers may ask for follow-ups). After merge, or if the run is abandoned:
   - `git worktree remove ../<repo>-issue-<N>-<short-slug>` (never `--force` on a dirty tree — ask first).
   - `git worktree prune` to drop stale entries.

## Stop conditions — ask instead of guessing

- Issue number missing, issue closed with no reopen instruction, or two issues could match.
- A worktree or `issue-<N>-*` branch already exists that is not yours, or is dirty — reuse-or-delete needs your call.
- Acceptance criteria absent and the correct behavior is a product decision.
- The fix requires credentials, live API calls, production data access, or destructive migration.
- Static checks fail for reasons outside the issue scope — report, do not silently expand scope.
