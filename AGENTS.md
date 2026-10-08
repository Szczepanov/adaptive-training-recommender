# AGENTS.md — Repository Reference for AI Agents

The reference index for `adaptive-training-recommender`: package and command routing,
verification gates, and which document to trust.

**Scope:** this root file applies to the whole repository. A deeper `AGENTS.md`, if added,
takes precedence for its subtree.

**Read [`CLAUDE.md`](./CLAUDE.md) first** — it holds the invariants you must not violate,
the pre-change checks, and the verification loop. This file answers *"where is it and what
do I run?"*; `CLAUDE.md` answers *"what am I allowed to do?"*.

**Instruction-size invariant:** keep this file below **32 KiB UTF-8** and keep mandatory routing
near the top. Detailed inventories belong under `docs/` or in on-demand skills. Do not depend on a
developer raising a client-specific instruction limit for correctness.

## Repository overview

* **Python backend** (`src/garmin_sync/`) — ingests health and training metrics from Garmin
  Connect (and Eight Sleep / Google Health transports) into user-scoped Firestore documents.
* **Frontend app** (`app/`) — React + TypeScript + Vite + Firebase. Reads user recovery
  snapshots and computes adaptive training recommendations. The decision engine lives in
  `app/src/engine/`; its evaluators are pure, and only the orchestration entry points
  reach for IO — as a lazily-imported default when no provider was injected.

---

## Critical system constraints

Full statements, with rationale and the checks that enforce them, are in
[`CLAUDE.md` § 1](./CLAUDE.md#1-non-negotiable-invariants). In short:

1. **User isolation** — write to `users/{APP_USER_ID}/daily_recovery_snapshots/{YYYY-MM-DD}`; never `daily_recovery_snapshot/{date}`, never `"default_user"` (ADR-0002).
2. **Timezone semantics** — `Europe/Warsaw` for every calendar date, via `local_today()` / `getLocalDateString()`; never UTC `toISOString().split('T')[0]` (ADR-0003).
3. **`D - 1` step semantics** — `totalSteps` is the previous completed day; baselines normalize ambient surges and `fatigue.ts` deducts estimated activity steps (ADR-0003).
4. **Knowledge lineage** — decision-authority constants are owned by registered claims with alignment tests; check `app/src/knowledge/` before changing one (ADR-0033).
5. **Policy version** — bump `POLICY_VERSION` when a change can alter a recommendation (ADR-0010).
6. **No credential leaks** — never commit `.env`, `.garth/`, service-account files, or raw health JSON.

---

## Shared agent skills

Cross-agent workflow skills live in `.agents/skills/` (single source of truth):

- `issue-to-pr` — GitHub issue number → plan → implementation → verification → linked PR.
- `planner` — implementation planning.
- `external-library-docs` — Context7-first third-party documentation lookup.
- `semantic-code-discovery` — route exact lookup, local Canopy semantic discovery/graph hints, and Jev semantic judgment without broad source loading.

Claude Code only discovers skills under `.claude/skills/`, so a Claude-visible skill there is a
thin pointer to the `.agents/skills/` file. Edit the shared file, never the pointer.

## Code navigation

Code navigation uses lexical search, optional semantic judgment/discovery, direct source reads, and
the compiler as the type-level impact list. Do not block a task on optional tool setup, and do not
perform ceremonial navigation calls for docs-only work or a known tiny edit whose target is already
established.

### Retrieval policy

Pick the cheapest tool that answers the actual question:

1. **Exact lookup:** when a symbol, string, error, path, configuration key, or other repository
   vocabulary is known, use text search (`Grep`/`rg`) and direct reads. This remains the default
   for literals, docs, YAML/JSON, generated files, and exact callers.
2. **Unknown repository vocabulary/location:** for a non-trivial task, make one query-only
   `python scripts/agent_canopy.py search "<behavior>"` attempt before broad lexical exploration.
   The wrapper locates the maintained main-checkout index and never invokes index-maintenance commands. Exit code
   3 / `CANOPY_UNAVAILABLE` means fall back immediately. Treat hits as candidates and verify them
   in the current worktree. If the result is materially ambiguous and location remains unknown, use
   one tightly scoped `python scripts/agent_jev.py find` as a second opinion before escalating
   to broader search.
3. **Semantic property on a known target:** use a targeted direct read when one small/localized
   source region answers the question. If one semantic property would otherwise require inspecting
   multiple substantial regions/files, use **one atomic, narrowly scoped
   `python scripts/agent_jev.py ask`** before broad reading. Keep each question independently
   testable; split compound "A/B/C or wiring?" questions.
   Verify the cited source in the current worktree. Do not call Jev after direct evidence already
   answered the question.
4. **Graph orientation:** after a useful Canopy result, `canopy map`/`canopy trace` may cheaply
   orient callers/callees. The graph is advisory: a missing/ambiguous entity is not evidence that a
   real source symbol is absent.
5. **Type-level ripple:** when a change adds a union member or `Record` key, adds a required
   field, or changes an exported signature, make the change and run the compiler
   (`cd app && npx tsc -b`; `uv run mypy` for Python). Its errors are the complete,
   authoritative impact list at no extra cost. In `app/`, `tsc -p .` checks nothing; use
   `tsc -b`.
6. If Canopy/Jev are unavailable or uncertain, fall back to exact text search and targeted reads;
   the repository must never require optional semantic tooling to make progress.

### Canopy index lifecycle

Normal coding-agent work is **consumer-only** for Canopy indexes. The supported agent entry point is:

```bash
python scripts/agent_canopy.py search "where is this behavior implemented?"
python scripts/agent_canopy.py map SomeSymbol
python scripts/agent_canopy.py trace Caller Callee
python scripts/agent_canopy.py status
```

The wrapper discovers a maintained main/master checkout (or
`AGENT_CANOPY_BASELINE_WORKTREE` / `--baseline-worktree` override) and exposes only query/non-maintenance
Canopy commands. `CANOPY_UNAVAILABLE` / exit code 3 is a routing signal to fall back, not a setup
failure to repair.

- Do not run `canopy init`, `canopy reindex`, switch/pull embedding models, or rebuild an index
  because a temporary worktree lacks `.canopy/`; use the query-only wrapper and fall back if it is unavailable.
- Do not mutate a shared index with `canopy index` from a temporary worktree. A persistent
  primary/main checkout may maintain its own index through an explicit developer/tool-maintenance
  workflow.
- The query-only wrapper exposes the maintained persistent-main index as baseline-main discovery when
  such an index exists. Verify all located behavior against the current branch/worktree before
  editing or concluding.
- Never share one writable `.canopy/` directory across concurrent worktrees. The wrapper
  serializes query consumers because upstream Canopy opens the redb store through a write-capable
  initialization path even for query commands; explicit index maintenance must not overlap them.
- Missing Canopy is a normal fallback condition, not a reason to substitute a smaller embedding
  model. Qwen3-Embedding-4B remains the evaluated baseline; smaller models belong in explicit
  retrieval benchmarks.

Generated Canopy state remains ignored/local. See `docs/standards/agent-tooling.md` for the
normative lifecycle and evidence rules.

The automatic Jev large-read narrowing hook is not a repository default because it can hide source.
Client-local experiments may enable it, but correctness must be compared against full-source runs
before adopting it broadly.

Jev sends selected content to an external provider. Never scan repository root `.`, `artifacts/`,
`app/artifacts/`, raw health/provider exports, credentials/token stores, service-account material,
or other personal/production data. Do not treat `.gitignore` as a DLP boundary; for any directory
that may contain ignored/untracked data, inspect candidates first with
`python scripts/agent_jev.py scan --list <scope>`, or narrow to explicit safe files. See
`docs/standards/agent-tooling.md` for the full data-egress rule.

The objective is better evidence with less broad reading, not tool-call count.

### Review economy

For one cohesive issue, refactor, or review, prefer **one discovery pass by the primary
agent**.

- Once the target file/symbol and its relevant callers are established, read the code directly
  instead of rediscovering already-known locations.
- Do not have multiple subagents independently reconstruct the same call graph or architecture,
  including by repeating the same Canopy searches or Jev sweeps. The primary agent owns broad discovery; give reviewers
  the issue acceptance criteria, implementation summary, changed-file list and diff first. Further
  lookup is only for a specific unresolved wiring/impact question.

This matters especially before changing an engine constant
([`CLAUDE.md` § 2](./CLAUDE.md#2-before-you-change-a-number-in-the-engine)): the constant, its
knowledge claim/coverage ownership, and the `*PolicyAlignment.test.ts` assertions must remain
aligned.

---

---

## Commands reference

### Full suite (Makefile, repository root)

* `make verify` — the canonical scope-aware handoff/PR gate for coding agents; it reuses CI's docs-vs-code classification and runs the deterministic local gates required for that scope.\n* `make agent-evals` — validate the provider-neutral coding-agent evaluation corpus.\n* `make check` — the core local code gate: `ruff check`, `ruff format --check`, `mypy`,
  `pytest`, `tsc -b`, `eslint`, `vitest`, knowledge validation, knowledge-coverage
  validation, knowledge-freshness reporting, workout validation, and `npm audit --audit-level=high`. `check-frontend` mirrors the app's `npm run check`
  gate; CI adds further path-specific checks such as dependency audits, policy drift,
  coverage/rules, simulations, and Docker validation.
* `make all` — alias for `make verify` (the default target)
* `make test` — unit tests only (`pytest` + `vitest`)
* `make typecheck` / `make lint` — both stacks
* `make format` — auto-format Python and TypeScript; `make format-check` verifies Python formatting without writing
* `make validate-knowledge` / `make validate-knowledge-coverage` / `make validate-knowledge-freshness` / `make validate-workouts` — run the frontend registry/coverage/freshness/catalog checks individually
* `make simulate` — scenario simulations + baseline diff verification
* `make simulate-calibrate` / `make simulate-fatigue-fusion` / `make simulate-subjective-drift` / `make compare-sequence-search` — targeted evidence runs
* `make build` — production frontend build
* `make install` — install Python and Node dependencies
* `make deploy` / `make deploy-all` / `make deploy-rules` / `make deploy-indexes` — Firebase Hosting / all assets / security rules (with drift check) / indexes
* `make clean`, `make help` — housekeeping and target listing

### Python backend

* `uv sync` — restore dependencies
* `uv run pre-commit install` — install git hooks locally
* `uv run pre-commit run --all-files` — run every pre-commit check
* `uv run pytest` — unit tests
* `uv run ruff check .` — lint and import sort
* `uv run ruff format --check .` — formatting check (`uv run ruff format .` to apply)
* `uv run mypy` — static type check of `src/garmin_sync` and `scripts/` (scope set by `[tool.mypy] files`
  in `pyproject.toml`; passing a path explicitly narrows it)
* `uv run python scripts/bootstrap_garmin_tokens.py` — Garmin OAuth token bootstrap
* `uv run python scripts/respiration_baseline_evidence.py` — synthetic respiration baseline sweep (ADR-0024)

**`garmin_sync` CLI** (`uv run python -m garmin_sync <command>`):

| Command | Does |
|---|---|
| `sync [--date YYYY-MM-DD] [--force]` | Daily ingestion for `APP_USER_ID` |
| `sync-all` | Daily ingestion for every active Garmin link |
| `backfill --days 56 [--force]` | Historical backfill |
| `backfill-activity-response --days 20 [--force] [--dry-run]` | Enrich historical cycling activities with bounded `activityResponse` telemetry |
| `backfill-health --days 56` | Google Health backfill (Eight Sleep & Garmin) |
| `backfill-eight-sleep-direct --days 56` | Direct Eight Sleep connector backfill (ES8/ES9) |
| `rebuild --start-date X --end-date Y` | Offline snapshot rebuild from the raw archive |
| `audit --days 90` | Sync/archive completeness report |
| `audit-multisource --days 60` | Multisource shadow audit, Garmin direct vs Eight Sleep (MS14) |
| `probe-health` | Google Health source-provenance probe (MS0) |
| `compare-transports --days 60` | Garmin direct vs Google Health transport equivalence (MS10) |
| `compare-eight-sleep-transports --days 60` | Eight Sleep direct vs Google Health equivalence (ES9) |
| `export-identity-replay --days 60` | Export real data in `identityReplay.ts`'s input shape (PI8) |
| `export-training-occurrence-evidence --user-id <uid> --start-date ... --end-date ... [--with-fit]` | Bounded, user-scoped TO4 record export and transient TO5 FIT aggregates for #646; private output under `app/artifacts/training-occurrence/` only |
| `export-activities --days 7` | Export recent activity telemetry as JSON for planning |
| `push-workout`, `push-pending-workouts[-all]` | Push queued/pending structured workouts to Garmin |
| `poll-manual-sync[-all]` | Poll manual sync status for one or every active link |

### Frontend app (run from `app/`)

* `npm ci` — install dependencies
* `npm run check` — the frontend gate: `npm audit --audit-level=high`, `tsc -b`, `eslint`, `vitest run`, knowledge validation, knowledge-coverage validation, knowledge-freshness reporting, workout catalog validation
* `npm test` — `vitest run` only; the fast inner loop (`npm run test:watch`, `npm run test:coverage`)
* `npm run test:perf` — wall-clock latency gates (`*.perf.test.ts`, `vitest.perf.config.ts`), run in a single worker; excluded from `npm test` because sibling workers preempt them. Part of `npm run check` / `make check`
* `npm run test:rules` — Firestore security-rule suite inside the Firebase emulator on dynamically leased ports (needs Java)
* `npm run test:e2e` — Playwright browser E2E suite inside Auth + Firestore emulators on dynamically leased ports (`playwright.e2e.config.ts`; one worker by default, `E2E_WORKERS=<n>` opts into concurrent workers; `npm run e2e:serve` serves the E2E app at `http://127.0.0.1:4173` for manual runs)
* `npm run emulators:exec:rules -- "<cmd>"` / `npm run emulators:exec:e2e -- "<cmd>"` — run a command inside dynamically leased emulators that `test:rules` / `test:e2e` use; CI shards with e.g. `npm run emulators:exec:rules -- "npm run test:rules:emulator -- --shard=1/2"` (`test:e2e:emulator` is the Playwright counterpart)
* `npm run test:rules:shard -- <index>/<total>` — one rules shard on dynamically leased emulator ports (`scripts/run-rules-shard.mjs`), so shards can run side by side with each other and with `test:e2e` across multiple agent worktrees; `make verify` uses it
* `npm run harness:status` / `npm run harness:reap [-- --yes]` — inspect active and stale port leases and hub locators; reap orphan processes and files left by abnormal terminations. **Never kill processes by port number**; use these commands.
* `npm run preview:start` / `npm run preview:stop` — start/stop background preview environment on leased ports, saving connection details to `app/.preview.json`
* `npm run build` — `npm run check && vite build`
* `npm run dev` — Vite dev server (`predev` runs `npm run check` first)
* `npm run validate:workouts` / `npm run validate:knowledge` / `npm run validate:knowledge-coverage` — catalog and registry validators, individually
* `npm run validate:knowledge-freshness` — SKR5 due/stale review-cadence report for every knowledge claim; always exits 0, never gates CI (see `app/src/knowledge/knowledgeFreshness.ts`)
* `npm run simulate:scenarios` — multi-week engine simulations → `artifacts/simulation-reports/latest/`
* `npm run simulate:diff` — non-blocking semantic diff against `docs/analysis/simulation-baseline.json` (`npm run simulate:update-baseline` to re-baseline)
* `node scripts/check-policy-drift.mjs <base-sha>` — verify `POLICY_VERSION` was bumped when decision logic changes
* `npm run replay:recommendation -- <audit.json>` — replay a persisted decision against its own audit
* `npm run build:plan-judge-corpus && npm run report:sequencing` — deterministic sequencing collision/spacing/opportunity-cost diagnostics (issue #458; report only, no gate)
* `judge:*` and `persona:*` are script-name families, **not executable npm wildcards**. Use concrete scripts such as `npm run judge:run`, `npm run judge:diff`, `npm run judge:update-baseline`, `npm run persona:run`, `npm run persona:diff`, and `npm run persona:update-baseline`; see `app/package.json` for local/quick/e2e/resume variants.
* `npm run evidence:velocity-agreement -- --pairs <pairs.json> --output <basename> [--segmentation concentric-segmentation-v2] [--min-overlap 0.5] [--force]` — local WL/OpenBar rep agreement report, JSON + Markdown; private inputs, no upload or recommendation authority
* `npm run evidence:health-anomaly`, `npm run evidence:identity-replay`, `npm run evidence:training-occurrence:prepare` / `npm run evidence:training-occurrence`, `npm run measure:garmin-zone-credit` — shadow-mode evidence runs
* `npm run visual:install` → `npm run visual:refresh` — finalized Playwright review bundle for `visual-desktop` (1440 px) + `visual-mobile` (390 px) in `artifacts/visual-review/latest/`; `npx playwright test` can ad hoc capture `visual-mobile-narrow` (360 px) and `visual-mobile-wide` (412 px), but does not prepare/finalize the review bundle; `npm run visual:serve` runs the harness at `http://127.0.0.1:4174`

### What CI gates (`.github/workflows/ci.yml`)

CI is path-sensitive. `detect-changes` chooses the applicable jobs, and the final `CI Gate`
fails the PR if any required job on that path fails.

| Change class | Job | Gates on |
|---|---|---|
| Docs-only | Documentation & security hygiene | repository-hygiene `pre-commit` checks (the CI job skips the code-only uv-lock/Ruff/mypy/ESLint hooks) |
| Code | Python test suite | `uv lock --check`, repository-hygiene `pre-commit`, `ruff check`, `ruff format --check`, `mypy` (`src/garmin_sync` + `scripts/`), `pytest` with coverage, `uvx pip-audit` |
| Code | Frontend hygiene & static gates | `npm run audit` (`npm audit --audit-level=high`), `typecheck`, `lint`, `validate:knowledge`, `validate:knowledge-coverage`, `validate:knowledge-freshness` (reports only, non-blocking), `validate:workouts`, policy-version drift vs the PR base, `build:bundle` |
| Code | Frontend unit tests, Firestore rules & browser E2E | `npm run test:coverage` then `npm run test:perf`, `npm run test:rules`, `npm run test:e2e` (emulators + Java + Chromium), run as parallel jobs; the rules and E2E suites are each split into two `--shard` jobs with their own emulator, and one aggregate check passes only when every job and shard passes |
| Code | Engine simulations & AI gates | `simulate:scenarios` plus committed-baseline `git diff --exit-code`, `simulate:plan-judge`, persona corpus build; `simulate:diff` is advisory (`continue-on-error`) |
| Code | Docker build & compose smoke | root image build, Compose config/build/up, smoke checks |

`make check` already covers Python lint **and formatting**, mypy, pytest, frontend dependency
audit, typecheck, ESLint, Vitest, the knowledge validators, and workout validation. The important CI-only
additions are Python dependency/lock audits, pre-commit hygiene, policy-drift and bundle checks,
coverage/rules tests, simulation/AI gates, and Docker validation.

### Docker

* `docker compose build` (`make docker-build`) — build backend and frontend images
* `docker compose up -d` (`make docker-up`) — backend API on 8081, frontend Nginx SPA on 8080
* `docker compose down` (`make docker-down`) — stop and remove services and networks
* `make docker-smoke` — health and reverse-proxy smoke checks against running containers
* `docker build -t adaptive-training-garmin-sync .` — standalone Garmin sync image

---

## Package architecture

The detailed package/file routing map lives in
[`docs/reference/package-architecture.md`](./docs/reference/package-architecture.md).
Keeping that inventory out of this always-loaded file is deliberate: root agent instructions must
stay compact enough to survive conservative client instruction budgets.

| Concern | Primary location |
|---|---|
| Python ingestion, providers, Firestore persistence | `src/garmin_sync/` |
| Adaptive recommendation engine | `app/src/engine/` |
| Source-neutral sessions / execution | `app/src/sessions/` |
| Session responses and outcome interpretation | `app/src/responses/`, `app/src/outcomes/` |
| Canonical observations / testing | `app/src/observations/` |
| Source-neutral concentric rep segmentation / rule identities | `app/src/observations/concentricSegmentation.ts` |
| Velocity-file import checks / OpenBar parser and proposals | `app/src/observations/velocityFileImport.ts`, `openBarAnalysis.ts`, `openBarAnalysisImport.ts` |
| Sports knowledge registry and alignment | `app/src/knowledge/` |
| Current architecture / ADRs / delivery status | `docs/architecture/`, `docs/adr/`, `docs/plans/README.md` |

**Before changing engine behaviour**, read `docs/architecture/recommendation-engine.md`
(the two selection paths) and the relevant ADR. Known divergences between ADRs and code are tracked
in `docs/analysis/2026-08-08-architecture-review.md`, with remediation sequenced in `docs/plans/`.

---
## External library documentation with Context7

Context7 is configured per developer/client rather than committed as repository MCP state. When its
tools are available, use Context7 **before relying on model memory** for external library/API
documentation, setup/configuration, migrations, deprecations, or version-specific code examples.

Before querying, derive the installed dependency version from this repository's manifest/lockfile
when practical and request version-appropriate docs. Do not use Context7 for repository-internal
architecture, business rules, ADRs, current implementation, or Git history.

If Context7 is unavailable or lacks the required version, use the dependency's official docs/source
and state the fallback when it materially affects confidence.

The normative routing and versioning policy is
[`docs/standards/agent-tooling.md`](./docs/standards/agent-tooling.md).

---

## Reading the documentation

`docs/` directories are not interchangeable — each has a different relationship to the
truth, and reading one as if it were another has already caused a fixed defect to be
re-reported three times. **[`docs/README.md`](./docs/README.md) opens with the routing
table**: which directory is authoritative for what, precedence when two documents disagree,
and task-oriented entry points. Read it before trusting any other document here.

The short version:

| Directory | Is | Trust for | Do not trust for |
|---|---|---|---|
| `docs/adr/` | Immutable decisions | Intended design and rationale | What the code does today |
| `docs/architecture/` | Living reference | How it works today | Why it was chosen |
| `docs/standards/` | Normative living standards | Cross-cutting quality requirements | What the code necessarily does today |
| `docs/analysis/` | Dated audit | Evidence as of its date | Current state — verify against code |
| `docs/plans/` | Mutable, status-tracked | Work to be done; the status board in [`docs/plans/README.md`](./docs/plans/README.md) | Anything marked `Implemented`/`Archived` — that is history |
| `docs/ops/` | Runbooks | Operational procedure | Design intent |

**When documents disagree about current behaviour, the code wins, then `architecture/`,
then `adr/`.** Standards are normative: a code/standard mismatch is a deviation to fix or
document explicitly, not evidence that the standard should silently change.

**Before changing user-facing UI, responsive layout, navigation, accessibility, forms,
dialogs, or interaction behavior**, read [`docs/standards/ui-ux.md`](./docs/standards/ui-ux.md)
first, then [`docs/architecture/user-flows.md`](./docs/architecture/user-flows.md) and the
relevant flow-specific architecture document. Dated UX analyses and implemented plans are
evidence/history, not the current quality bar.

### Writing conventions

* **Reference symbols, never line numbers.** Write `` `rules.ts` `evaluateEnvelopes` `` or
  `` `prescription.ts:workoutForTemplate` ``, never `` `rules.ts:544-556` ``. Line numbers
  drift within hours; a 2026-08-08 audit found 91 of them in `docs/plans/`, three of six
  sampled already pointing at the wrong code on the day they were written.
* **A finished plan must not read like a work list.** When a plan reaches `Implemented`,
  strike or delete its present-tense problem statements. See
  [`docs/plans/README.md`](./docs/plans/README.md#conventions-that-exist-because-they-were-violated).

---

## Code style & testing standards

* **Python** — type hints on every module; `uv run mypy` (covering `src/garmin_sync` and
  `scripts/`) stays clean. Format with `ruff format`; lint with `ruff check`.
* **TypeScript** — every change must pass `tsc -b` and `eslint`. Engine evaluators stay
  pure: no Firestore, no `fetch`, no `Date.now()` in a decision path (there is none today).
  IO arrives through an injected boundary — `trainingHistory.ts` in TypeScript,
  `provider.py` in Python. `rules.ts`, `trainingIntent.ts` and `replay.ts` are the
  orchestration exceptions: they lazily import a Firestore-backed default only when the
  caller injected nothing. Do not widen that set.
* **Immutability** — derive new objects rather than mutating inputs; the engine's replay and
  audit guarantees (ADR-0010) depend on it.
* **Tests** — synthetic fixtures only (`tests/fixtures/` in Python,
  `app/src/sessions/fixtures/` and inline builders in the frontend). Never call a live API
  from a test. New decision-authority behaviour needs a policy-alignment test (ADR-0033);
  new engine behaviour needs a scenario the simulation harness can see.
* **Commits** — conventional-commit prefixes (`feat:`, `fix:`, `docs:`, `chore:`, …).
  Reference symbols, not line numbers, in messages too.
