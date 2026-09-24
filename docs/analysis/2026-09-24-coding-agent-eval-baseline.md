# 2026-09-24 Coding-Agent Evaluation Baseline (Capability & Routing Suite)

**Date:** 2026-09-24
**Corpus:** `agent-evals/cases.json` (`schema_version: 1`, `adaptive-training-recommender-coding-agents`)
**Evaluated Agent / Model:** Antigravity (`Gemini 3.8 Flash (High)`)
**Scope:** Initial isolated-worktree baseline trials for the three P0 capability and tool-routing cases introduced in PR #793 (`53eafbaa`).

---

## 1. Purpose

Following the introduction of the provider-neutral coding-agent evaluation suite (`agent-evals/`) and the Agent Tooling Standard (`docs/standards/agent-tooling.md`), this run establishes the first empirical baseline for:

1. **Positive external documentation routing (`external-library-version-routing`)** — verifying that the agent derives the exact installed package version from repository manifests (`app/package.json` and `app/package-lock.json`) before querying Context7 for version-appropriate API semantics.
2. **Negative external documentation routing (`internal-architecture-no-external-docs`)** — verifying that the agent answers repository-internal authority precedence and knowledge-lineage questions purely from repository docs without unnecessary external tool invocations.
3. **Combined capability & implementation verification (`firestore-targeted-prior-revision-query`)** — verifying that the agent validates Firestore query/index semantics against current documentation, replaces a broad per-date scan with a targeted equality query, preserves scheduled-state and identity invariants, and passes the full `npm --prefix app run check` gate in an isolated worktree.

---

## 2. Trial Methodology

Each trial followed the isolation protocol in `agent-evals/README.md`:

1. **Isolated Git Worktree at `start_ref`**:
   - `external-library-version-routing`: detached worktree at `e2181760c566783c7d3c9a27865135a639035e50`.
   - `internal-architecture-no-external-docs`: detached worktree at `e2181760c566783c7d3c9a27865135a639035e50`.
   - `firestore-targeted-prior-revision-query`: detached worktree at `77887528235cf8446e23495b466edc4d1a6e0d7e` (immediately prior to PR #790).
2. **Zero Prompt Leakage**:
   - Subagents received only the isolated worktree path and the exact `prompt` string from `agent-evals/cases.json` without case IDs, PR numbers, or grading rubrics.
3. **Deterministic Grading**:
   - Changed-file lists and `forbidden_modified_globs` were evaluated against `start_ref`.
   - Implementation grader commands (`npm --prefix app run check`) were executed inside the isolated worktree after `npm --prefix app ci --prefer-offline --no-audit`.
   - Result documents were validated with `uv run python scripts/agent_eval.py validate-result`.

---

## 3. Results Matrix

| Case ID | Kind | `start_ref` | Outcome | Grader / Diff Verification | Tool Routing (Expected $\rightarrow$ Observed) | Turns / Tool Calls |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `external-library-version-routing` | `capability` | `e2181760` | **PASS** | `0` modified files (`forbidden_modified_globs: ["**"]` satisfied) | `context7`: `required` $\rightarrow$ **Used** (`resolve-library-id` + `query-docs`)<br>`semantic_navigation`: `not_expected` $\rightarrow$ **Not used** | `11` turns / `29` calls |
| `internal-architecture-no-external-docs` | `capability` | `e2181760` | **PASS** | `0` modified files (`forbidden_modified_globs: ["**"]` satisfied) | `context7`: `not_expected` $\rightarrow$ **Not used**<br>`semantic_navigation`: `optional` $\rightarrow$ **Not used** | `5` turns / `5` calls (`76s`) |
| `firestore-targeted-prior-revision-query` | `capability` | `77887528` | **PASS** | `npm --prefix app run check` exited `0` (`536` test files, `6301` tests, `tsc`, `eslint`, knowledge & workout validators)<br>Changed files: `sessionOccurrenceService.ts`, `sessionOccurrenceService.test.ts` (`forbidden_modified_globs` clean) | `context7`: `recommended` $\rightarrow$ **Used** (verified Firestore nested dot-path equality & single-field index merging) | `40` turns / `50` calls |

---

## 4. Case-by-Case Observations

### 4.1 `external-library-version-routing`
* **Version Discipline:** The agent inspected `app/package.json` (`"firebase": "^12.19.0"`) and `app/package-lock.json` (`firebase@12.19.0`, `@firebase/firestore@4.17.2`) before querying Context7 (`/firebase/firebase-js-sdk` and `/websites/firebase_google`).
* **Evidence Separation:** Clearly separated what the repository proves (existing `where()` + `orderBy()` / range queries in `PerformedTrainingOccurrenceRepository`, `firestore.indexes.json` composite definitions, and client-side post-filtering in `SessionExecutionService`) from what external documentation proves (variadic `where(..., '==', ...)` and composite `and(...)` filters, plus automatic single-field index merging for equality-only compound queries).

### 4.2 `internal-architecture-no-external-docs`
* **Negative Routing:** Completed in 5 tool calls (`view_file` on `CLAUDE.md`, `AGENTS.md`, `docs/README.md`, and `docs/adr/0033-sports-knowledge-registry.md`) with zero external documentation calls.
* **Accuracy:** Stated the exact authority hierarchy (`app/src/engine/` $\rightarrow$ `docs/architecture/` $\rightarrow$ `docs/adr/` $\rightarrow$ `docs/analysis/` & `docs/plans/`) and identified all three knowledge-lineage artifacts (`knowledgeCoverage.ts`, `sportsKnowledgeRegistry.ts`, `*PolicyAlignment.test.ts`) plus `POLICY_VERSION` in `app/src/engine/policy.ts`.

### 4.3 `firestore-targeted-prior-revision-query`
* **Implementation Quality:** Replaced the full-day scan (`getOccurrencesForDate`) inside `SessionOccurrenceService.getOrCreateExternalPlanOccurrence` with a targeted `findScheduledPriorRevisionOccurrence` query combining five equality constraints (`date`, `authority`, `state`, `externalPlanRef.planId`, `externalPlanRef.sessionId`).
* **Invariant Preservation:** Skipped the target `deterministicId` document prior to parsing while preserving `parseSessionOccurrenceDocument` validation and deterministic tie-breaking (`placementOrder`, then `occurrenceId`), plus unit tests in `sessionOccurrenceService.test.ts`.

---

## 5. Operational Findings for Worktree Trials

1. **Vite / Vitest Worker Module Resolution in Git Worktrees:**
   - Sharing `app/node_modules` via a directory junction or symlink across worktrees causes Vite's internal module runner (`realpathSync`) to load `@vitest/runner` from the primary checkout while resolving test files from the worktree path, resulting in `TypeError: Cannot read properties of undefined (reading 'config')` across worker threads even when `NODE_OPTIONS=--preserve-symlinks` is set.
   - Running `npm --prefix app ci --prefer-offline --no-audit` directly inside the isolated worktree resolves this deterministically and should be treated as mandatory for frontend implementation trials.
2. **Semantic Navigation Project Root Alignment:**
   - Because Serena (`mcp_serena_*`) binds to a project directory, trials that evaluate `semantic_navigation` on a historical `start_ref` must activate Serena on the isolated worktree path before launching the agent (and restore the primary checkout afterward) so symbol lookups reflect `start_ref` rather than `HEAD`.
