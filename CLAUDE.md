# CLAUDE.md — Operating Instructions for Claude Code

`adaptive-training-recommender` is a hybrid repository: a Python Garmin/health ingestion
backend (`src/garmin_sync/`) and a React + TypeScript + Firebase app (`app/`) whose engine
turns recovery snapshots into adaptive training recommendations.

**This file is the rules. [`AGENTS.md`](./AGENTS.md) is the reference** — the full command
index and the file-by-file package map. Commands are listed there once, on purpose: when
they lived in both files they drifted. Read `AGENTS.md` before concluding that a module,
CLI subcommand or npm script does not exist.

---

## 1. Non-negotiable invariants

These are enforced by tests and by ADRs. If a change appears to require breaking one, stop
and say so instead of working around it.

| # | Invariant | Concretely |
|---|---|---|
| I1 | **User scoping** | Recovery documents go to `users/{APP_USER_ID}/daily_recovery_snapshots/{YYYY-MM-DD}`. Never `daily_recovery_snapshot/{date}`, never a `"default_user"` document. (ADR-0002) |
| I2 | **Warsaw calendar dates** | Use `local_today()` (Python) and `getLocalDateString()` (`app/src/utils/localDate.ts`). Never `new Date().toISOString().split('T')[0]` for a calendar date — it silently shifts the day for ~2 hours every night. (ADR-0003) |
| I3 | **`D - 1` step semantics** | `totalSteps` in a snapshot is the *previous completed* calendar day. Rolling 7d/28d baselines normalize ambient surges; estimated activity steps are deducted in `fatigue.ts` so structured training is not counted twice. (ADR-0003) |
| I4 | **Knowledge lineage** | Every engine threshold, weight, cadence or policy constant with decision authority is owned by a registered claim. Before touching one, see §2. (ADR-0033) |
| I5 | **Policy version** | A change that can alter a recommendation must bump `POLICY_VERSION` in `app/src/engine/policy.ts`. Verify with `node scripts/check-policy-drift.mjs <base-sha>` from `app/`. (ADR-0010) |
| I6 | **No credential leaks** | Never commit or print `.env`, `.garth/` token directories, Firebase service-account files, or raw health JSON payloads. Health data is personal data. |

## 2. Before you change a number in the engine

The knowledge registry is invisible exactly when it matters most: you are reading a bare
`0.40` in `optimizer.ts`, and nothing at the call site says an alignment-tested claim owns
it. So check first, every time:

1. `app/src/knowledge/knowledgeCoverage.ts` — the inventory of every decision-authority
   rule, with its classification, coverage state and research priority. Your constant is
   probably already there.
2. `app/src/knowledge/sportsKnowledgeRegistry.ts` — the registered claims. The answer, *or
   an explicit statement that the evidence does not support one*, is often already written.
3. `*PolicyAlignment.test.ts` — these assert that registered claims match the implemented
   constants. A change that does not update both sides fails here, by design.

A **new** decision-authority rule needs all three: a claim, a coverage item, and a
policy-alignment test (ADR-0033). Do not add one silently.

## 3. Working loop

**Before writing code**
- Check [`docs/plans/README.md`](./docs/plans/README.md) — the authoritative status board.
  It says what is in progress, what shipped, and what is deliberately shadow-mode only.
  Never infer delivery status from a file's existence or from this file.
- For engine behaviour: `docs/architecture/recommendation-engine.md`, then the relevant ADR,
  then `docs/analysis/2026-08-08-architecture-review.md` for known ADR/code divergences.
- See [`AGENTS.md` § Reading the documentation](./AGENTS.md#reading-the-documentation) for
  which `docs/` directory is authoritative for what. **Code wins, then `architecture/`,
  then `adr/`.**

**While writing code**
- Keep evaluators pure — no Firestore, no `fetch`, no `Date.now()` inside a decision path.
  Only the orchestration entry points (`rules.ts`, `trainingIntent.ts`, `replay.ts`) reach
  for IO, and only as a lazily-imported default when the caller injected no provider
  (`trainingHistory.ts` in TypeScript, `provider.py` in Python). Follow that pattern rather
  than importing a service into an evaluator.
- Python: type hints everywhere; `mypy src/garmin_sync` must stay clean.
- Tests use synthetic fixtures (`tests/fixtures/`). Never call a live API from a test.
- Reference symbols in docs and commit messages, never line numbers (§5).

**Before you call it done**
```bash
make check          # ruff + mypy + pytest, tsc + eslint + vitest + workout validation
```
- `make format` first if you touched Python: CI gates on `ruff format --check`, which
  `make check` does not run.
- Knowledge-registry or coverage change → `cd app && npm run check`. `make check` runs the
  frontend gates individually and skips `validate:knowledge` / `validate:knowledge-coverage`;
  CI does not.
- Engine or policy change → `make simulate` (scenario run, aggregate-bounds gate) plus
  `cd app && npm run simulate:plan-judge` and the policy-drift check (I5). All three gate
  CI; `simulate:diff` is advisory there, so read it but do not block on it.
- Firestore rules change → `cd app && npm run test:rules` (needs the emulator and Java).
  CI runs it on every code change, not only rules changes.
- `make all` = `check` + `simulate` + `build`. Run it when the change is broad.
- The full CI gate list is in
  [`AGENTS.md` § What CI gates](./AGENTS.md#what-ci-gates-githubworkflowsciyml).

Report what you actually ran and what it said. A skipped suite is a fact worth stating.

## 4. Daily commands

The full index is in [`AGENTS.md` § Commands](./AGENTS.md#commands-reference). The ones you
need most:

```bash
make check                             # everything that gates a commit
make test                              # pytest + vitest only
make simulate                          # scenario simulations + baseline diff
uv sync                                # restore Python deps
uv run python -m garmin_sync sync      # daily ingestion for APP_USER_ID
cd app && npm run check                # frontend gate (tsc, eslint, vitest, knowledge, workouts)
cd app && npm test                     # vitest only — the fast inner loop
```

## 5. Repository conventions that exist because they were violated

- **Reference symbols, never line numbers.** Write `` `rules.ts` `evaluateEnvelopes` ``, not
  `` `rules.ts:544-556` ``. A 2026-08-08 audit found 91 line references in `docs/plans/`;
  three of six sampled already pointed at the wrong code the day they were written.
- **A finished plan must not read like a work list.** When a plan reaches `Implemented`,
  strike its present-tense problem statements — otherwise they get acted on as live work.
  A fixed defect was re-reported three times this way.
- **Do not restate mutable status in an instruction file.** Delivery status belongs in
  `docs/plans/README.md` alone; PR numbers and "not yet wired up" notes go stale here
  faster than anyone updates them.

## 6. Where things live

| Looking for | Go to |
|---|---|
| Full file-by-file map of every package | [`AGENTS.md` § Package architecture](./AGENTS.md#package-architecture) |
| Adaptive engine (rules, fatigue, optimizer, planner, coverage) | `app/src/engine/` |
| Knowledge registry, coverage inventory, alignment tests | `app/src/knowledge/` |
| Source-neutral session authoring, execution, response, outcomes (ADR-0023) | `app/src/sessions/`, `app/src/responses/`, `app/src/observations/`, `app/src/outcomes/` |
| Canonical performed-training-occurrence reconciliation (ADR-0034) | `app/src/training-occurrence/` — check `docs/plans/README.md` for what is live vs shadow |
| Python ingestion (sync, backfill, rebuild, audit, CLI) | `src/garmin_sync/` |
| Garmin OAuth bootstrap | `scripts/bootstrap_garmin_tokens.py` |
| Warsaw date helper / user-scoped Firestore reader / security rules | `app/src/utils/localDate.ts`, `app/src/services/recoverySnapshotService.ts`, `app/firestore.rules` |
| Which document to trust | [`docs/README.md`](./docs/README.md) — routing table and precedence |
