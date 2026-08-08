# Phase 0 — Instrumentation & developer baseline

* **Status:** Ready
* **Depends on:** nothing
* **Unlocks:** Phases 3, 4, 5 (none of them can be evaluated without this)
* **Addresses:** F11, F14, F15, part of F10
* **Rough effort:** 1–1.5 days

---

## Goal

Make it possible to see whether a planning change improved or degraded the recommended
week, and make the repository runnable from a clean clone. Nothing here changes engine
behaviour.

## Why this is first

Every later phase replaces a tuned heuristic with a different one. Today there is no
committed artifact that would show the difference: `npm run simulate:scenarios` produces
a genuinely rich report — objective resolution counts, constraint violations, fatigue
tier distribution, anchor placement, fragile-selection diagnostics — and writes it to
`app/artifacts/simulation-reports/`, which is **gitignored** (`app/.gitignore:14`).

The 0.21× event-modality suppression in F3 is the concrete case: it is visible in
`modalityDistribution` and `objectiveResolution`, and nobody saw it because no baseline
was ever committed.

---

## Work items

### 0.1 — Invariants are the CI gate; the snapshot is a diagnostic

**This item was restructured after PR #5 review.** The original version proposed a
full-output snapshot diff as the CI gate. That is the wrong contract here, and the
objection is decisive: Phases 3, 4 and 5 deliberately change objective credit,
anti-stacking, fatigue semantics and eventually the whole sequence planner. A
byte-exact gate over that would (i) freeze today's known-bad behaviour as the reference,
and (ii) turn every intentional improvement into baseline churn, which trains reviewers
to rubber-stamp the update. The gate must assert **properties that should hold across all
those changes**, not equality with today's output.

**The gate — invariant assertions (blocking).** See 0.2. These are the contract.

**Aggregate bounds (blocking, deliberately loose).** A small set of range assertions over
`runAllScenarios` output, wide enough that a correct planner change passes and only an
implausible one trips:

| Metric | Bound | Rationale |
|---|---|---|
| `constraintViolations` | exactly 0, all scenarios | already the harness's own contract |
| rest/recovery day share | 5–40 % | a planner recommending no rest, or mostly rest, is broken |
| longest same-template streak across chained weeks | ≤ 3 | catches a regression of the "tempo trap" class |
| objectives generated but never resolved in any scenario | ≤ 1 | catches an F2-class credit failure |

**The snapshot — diagnostic, non-blocking.** Still commit
`docs/analysis/simulation-baseline.json` (with `commit` and `capturedAt` stripped — they
come from `gitCommit()` and the clock in `simulate-scenarios.mjs`). Add
`npm run simulate:diff` producing a **semantic** diff — per-scenario changes in category
and modality distribution, objective resolution, and fatigue-tier day counts — and print
it in the PR. Do **not** fail CI on it. Updating the baseline is a normal, expected part
of a planner PR; the reviewer reads the semantic diff to decide whether the change is
what was intended.

**Determinism check before committing the snapshot:** run `npm run simulate:scenarios`
twice and diff. `pickTemplate` is date-hash seeded and scenarios use fixed `startDate`s,
so it should be stable — verify rather than assume. If it is not stable, the snapshot is
worthless as a diagnostic; fix the nondeterminism or drop the snapshot and keep only the
invariants.

### 0.2 — Golden coaching-contract scenario

The existing scenario assertions in `app/src/engine/scenarios.test.ts` check engine
semantics (no constraint violations, no absurd streaks). They do not assert that the
week is *coached well*. Add one scenario that does.

Add to `app/src/engine/simulation/scenarios.ts` a scenario `cycling_a_event_build_week`:
an A-priority `cycling_event` roughly 60 days out, `free_weights: true`,
`indoor_bike: true`, `environment: 'either'`, weekday 60 / weekend 150 minutes, stable
moderate readiness.

Assert, in a new `app/src/engine/goldenWeek.test.ts`:

| Invariant | Assertion |
|---|---|
| Key cycling quality is spaced | ≥ 48 h between any two picks whose `category` is `Hard Endurance`, `Moderate Endurance` or `Race-Specific Endurance` and `modality` is `Cycling` |
| Anchors are protected | no `Lower-body Strength` / `Full-body Strength` with `systemicCost >= 0.5` on the day before or after a key cycling day |
| Event modality is not penalised for frequency | the week contains **≥ 3** `Cycling` sessions |
| Required objectives resolve | `threshold_quality` and `strength_maintenance` reach `completedExposures >= targetExposures` within the 7-day strip |
| Rest exists | ≥ 1 `Rest` or `Mobility/Recovery` day |

**Expect the third row to fail today.** That is the point — it is the executable form of
F3. Land it as a documented failing assertion (`it.fails(...)`, with a comment citing
F3 and this plan) so Phase 3 has an unambiguous definition of done, rather than
weakening the assertion to match current behaviour.

### 0.3 — Make the frontend suite runnable from a clean clone

`app/src/firebase.ts` calls `initializeApp` / `getFirestore` / `getAuth` at module scope,
so importing any service transitively initialises Firebase. Without `VITE_FIREBASE_*`,
`trainingSettingsService.test.ts` fails to collect (verified). CI hides this by injecting
dummy values; `predev` runs `npm run check`, so a fresh clone cannot start the dev server
either.

Convert to lazy accessors:

```ts
let _app: FirebaseApp | undefined;
function app() { return (_app ??= initializeApp(firebaseConfig)); }
export function getDb() { return getFirestore(app()); }
export function getAuthInstance() { return getAuth(app()); }
```

Update the call sites (`services/*.ts`, `App.tsx`, `main.tsx`, `visual/*`) to call the
accessor at use time rather than importing a module-scope constant. Keep `export const db`
temporarily as a deprecated getter if the diff would otherwise be large; remove it in the
same phase.

Then add `app/.env.example` documenting the six `VITE_FIREBASE_*` keys, and replace
`app/README.md` — currently the **unmodified Vite starter template** — with real setup
instructions: install, env, `npm run check`, `npm run dev`, `npm run test:rules`
(requires Java + emulator), `npm run simulate:scenarios`.

**Acceptance:** `git clone && cd app && npm ci && npm test` passes with no `.env` present.

### 0.4 — Policy version guard

`POLICY_VERSION` (`app/src/engine/policy.ts`) is documented as "increment whenever a
change can alter a persisted recommendation decision" and has never moved, including
through `HEAD`'s new ranking tie-break. A frozen string makes `replay.ts`'s
`policyMatchesCurrent` check meaningless.

1. Bump it now to reflect the tie-break already shipped.
2. Add a check to `npm run check` that fails when any of `rules.ts`, `optimizer.ts`,
   `microcycle.ts`, `periodization.ts`, `fatigue.ts`, `planner.ts` or `dose.ts` differ
   from the merge base without `policy.ts` also changing. A short script comparing
   `git diff --name-only origin/main...HEAD` is sufficient; it does not need to be clever.

### 0.5 — Python lint and type checking

`AGENTS.md` requires type hints across all Python modules; nothing enforces it.

Add to `pyproject.toml` dev dependencies: `ruff`, `mypy`. Add `[tool.ruff]` and
`[tool.mypy]` sections (start permissive — `disallow_untyped_defs` on
`src/garmin_sync` only). Add both to the `python-tests` CI job. Fix whatever the first
run surfaces, or record explicit per-module ignores with a reason.

### 0.6 — Small cleanups

* Delete `garmin_login.py` (repo root). It duplicates
  `scripts/bootstrap_garmin_tokens.py` and bypasses the ADR-0002 guard by injecting
  `APP_USER_ID="bootstrap_user"`. Confirm the bootstrap script covers the same flow
  first.
* Add `npm audit --audit-level=high` and `uv run pip-audit` (or equivalent) to CI as
  non-blocking informational steps.
* **Pin `uv` in the Dockerfile.** `RUN pip install --no-cache-dir uv` is unpinned, so the
  image build tracks whatever uv releases. The `readme = "README.md"` build failure fixed
  in PR #5 surfaced with no repository change at all, which is exactly this class of
  problem. Pin to a known-good version and bump deliberately.

---

## Acceptance criteria

- [ ] invariant suite (0.2) + aggregate bounds run in CI and are blocking
- [ ] `npm run simulate:diff` emits a semantic diff and is explicitly non-blocking
- [ ] `docs/analysis/simulation-baseline.json` is committed and reproducible twice in a row
- [ ] `goldenWeek.test.ts` exists; the event-modality-frequency assertion is present and
      marked as expected-failing with a citation to F3
- [ ] `npm test` passes from a clean clone with no `.env`
- [ ] `app/.env.example` exists; `app/README.md` is project-specific
- [ ] `POLICY_VERSION` bumped; drift guard in `npm run check`
- [ ] `ruff` and `mypy` run in CI
- [ ] `garmin_login.py` removed

## Risks & rollback

* **Invariants too strict.** An invariant that encodes today's accident rather than a
  real coaching property will block a correct Phase 3-5 change. Each assertion in 0.2
  must be defensible as coaching, not as "what the engine currently does" — if it cannot
  be justified that way, it belongs in the non-blocking diagnostic instead.
* **Snapshot nondeterminism.** If the report is not reproducible the semantic diff is
  noise. Verify (0.1); if it fails, land the invariants and drop the snapshot rather than
  shipping a diagnostic nobody can trust.
* **Lazy Firebase touches many files.** Mechanical but wide. Land it as its own commit so
  it can be reverted independently.
* Everything here is additive or test-only. Rollback is per-commit.

## Out of scope

No engine behaviour changes. The golden test is expected to fail on one assertion; do not
"fix" it here.

## Docs to update

* `docs/README.md` — link `docs/plans/`
* `AGENTS.md` — add `simulate:diff`, `ruff`, `mypy` to the commands reference
* `CLAUDE.md` — same
