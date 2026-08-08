# Codebase, Docs & Decision Review — 2026-08-08

Scope: full repository at `2ea45cd` (`main`), both the Python ingestion package and the
TypeScript engine/app, plus `docs/adr/*`, `docs/architecture/*`, `AGENTS.md`, `CLAUDE.md`,
`README.md` and CI.

Method: read every engine module and ADR; ran `uv run pytest`, `npx tsc -b`, `npm test`,
`npm run simulate:scenarios`; wrote throwaway probes to confirm the two behavioural
claims below that a reader could reasonably doubt (F2, F3). Findings are ordered by
consequence, not by discovery order.

---

## 0. Verdict

The engineering craft here is unusually high for a personal project: layered boundaries
(`TrainingHistoryProvider`, `DataState`, provider/repository split on the Python side),
comments that explain *why* rather than *what*, real ADRs, an emulator-backed rules
suite, and a decision-provenance/replay path. `uv run pytest` is green (86 tests) and
`npx tsc -b` is clean.

The problem is not code quality. It is that **the system has grown a documented policy
layer that is, in several load-bearing places, not connected to any data**. Five of the
six Tier-1 findings share one shape: an ADR states a guarantee, the code that would
enforce it exists and is unit-tested in isolation, and the wire that feeds it real
input was never run. Tests pass because they inject the fixture the production adapter
never produces.

The second theme is **unretired scaffolding**. There are now three objective-crediting
models (two live, one dead), two stimulus vocabularies, and two selection paths — all
shipped simultaneously, with the newest layer merged at `HEAD` explicitly labelled "not
yet wired". Each was individually a reasonable step; together they are the main source
of the divergences below.

Neither theme requires a rewrite. Both require finishing things that were started.

---

## 1. What is genuinely strong (keep, don't churn)

* **Ingestion pipeline.** `_build_and_store_snapshot` as a single derive→map→store path
  shared by `sync`/`backfill`/`rebuild` is exactly right — it structurally prevents the
  three commands from drifting. Prehistory seeding, content-addressed raw archive, and
  the `audit`/`rebuild` pair give real data lineage.
* **The `DataState` discipline.** `INVALID`/`UNAVAILABLE` blocking planning instead of
  silently degrading to "empty training week" (`trainingHistorySnapshot.ts`,
  `Home.tsx:150-168`) is the correct call for a system that makes load decisions, and
  it is applied consistently.
* **Timezone handling.** `periodization.ts:getDaysBetween` using `Date.UTC` purely as a
  DST-free ordinal, with the reasoning written down, is better than most production code.
* **The `TrainingHistoryProvider` boundary (ADR-0009).** Keeping Firebase out of engine
  tests via an injected provider is the right seam and it works.
* **Comment quality as design record.** `rules.ts`'s explanation of why `MODIFY_MAX_SYSTEMIC_COST`
  admits upper-body strength, or `optimizer.ts`'s Patch 1c "tempo trap" note, are the kind
  of thing that normally lives only in a reviewer's head.

---

## 2. Tier 1 — Decisions that do not currently hold

### F1. The documented hard injury gate has no data source at all

`adapters.ts:154` — the sole production constructor of `UserContext` — hardcodes:

```ts
constraints: { ..., injuries: [], ... }
```

Everything downstream that consumes it is therefore dead code in production:

* `optimizer.ts:183-187` — *"Hard safety gating: Physical injuries strictly exclude
  matching modalities"* — filters against an always-empty list.
* `rules.ts:544-556` — `hasRunningInjury`, and the `isPain && injuries.length > 0`
  branch that populates `restrictedModalities`, can never fire. `restrictedModalities`
  is therefore *always* `[]`, which also means `evaluateTrainingWithIntent`'s
  `.filter(t => !restrictedModalities.includes(...))` (rules.ts:492) is a no-op, and the
  persisted audit's `safetyRestrictedModalityCount` is always `0`.
* `planner.ts:352,482` — same, for the whole 7-day forecast.

ADR-0007 §6 states: *"Physical pain/injury constraints (`UserConstraint`) are hard safety
gates."* That guarantee is not implemented. The legacy `users/{uid}/constraints/*`
collection is `allow write: if false` (firestore.rules) and the README states the v2
settings migration deliberately does **not** infer injury limits from it — so injuries
have no read path *and* no write path.

The only injury signal reaching the engine is the boolean `painOrInjury` check-in flag,
which caps the plan tier at `Mobility` but cannot express *where* the injury is. An
athlete with an achilles problem is offered heavy lower-body strength the moment they
stop ticking the pain box.

This is the single most important finding in this document.

### F2. Garmin-measured training earns zero microcycle credit

Verified empirically (throwaway probe, since removed): three Garmin activities in the
rolling window — a 120-min hard ride, a 60-min strength session, a 90-min moderate ride —
produce `zone2_aerobic 0/2`, `threshold_quality 0/1`, `strength_maintenance 0/1`. The
weekly ledger stays completely unresolved.

The chain:

1. `completedTraining.ts:candidateEventFromGarmin` sets `estimatedStimulus: ZERO_STIMULUS`
   (Garmin gives no stimulus vector, which is honest).
2. `completedEventToExposure` attaches `stimulusProfile` to the exposure **whenever the
   modality was recognised** — including when that profile is all zeros.
3. `microcycle.ts:buildMicrocycleState` routes any exposure with `stimulusProfile && modality`
   to `creditObjectivesFromStimulus`, which requires `stimulusCoverage >= 0.6`. An
   all-zero vector scores 0. No credit, and the keyword fallback is never reached.

The inversion is the tell: an activity whose type string Garmin reports as something
`modalityFromActivityType` *doesn't* recognise gets `modality: undefined`, falls through
to `updateMicrocycleProgress`, and **does** get credit. Better-identified data is treated
worse than worse-identified data.

Practical effect for any athlete who does not answer the adherence prompt every single
day: objectives never resolve, so `calculateStimulusBenefit` keeps scoring the same
unresolved targets, `plannedDose` stays pinned near maximum urgency
(`trainingIntent.ts:77-80`, `urgency = unresolved/total`), and the "post-objective
aerobic filler" (optimizer Patch 3) never engages. The system behaves as if the athlete
has done nothing all week while sitting on a Garmin history that says otherwise.

### F3. Anti-stacking has no notion of calendar time — contradicting ADR-0008 §6

`optimizer.ts:24-28`:

```ts
export interface RecentHistoryEntry {
    modality?: string; type?: string; systemicCost?: number;
}
```

There is no `date`. `getConsecutiveModalityCount` scans the array backwards and treats
**array adjacency as calendar adjacency**. ADR-0008 §6 claims the opposite:

> *"The optimizer can therefore apply a narrowly scoped third-consecutive-Strength
> penalty without treating sessions separated by a calendar gap as consecutive."*

The date is present on `CompletedExposure` and is dropped at the `projectTrailingHistory`
/ `rules.ts:512` boundary. Two strength sessions eleven days apart with nothing logged
between them read as consecutive.

Worse is the rolling arm. `optimizer.ts:214`:

```ts
if (consecutiveCount >= 2 || rollingCount >= 2) prefMultiplier *= 0.15;
```

`getRollingModalityCount` has no window bound beyond whatever array it is handed
(7 real days in `rules.ts`; up to 14 entries in `planner.ts`, since projected picks are
appended). Probe: two rides five days apart already yield `rollingCount = 2`. So the
**third** ride in a week is suppressed to 0.15×. For a cyclist with an A-priority
cycling event, that stacks against the 1.40× event boost for a net **0.21×** — the
optimizer actively steers away from the event modality during Specificity. This is
precisely the failure mode ADR-0007 §5 says the ranking context was built to prevent.

In the projected loop this compounds: because `projectedHistory` includes the strip's
own picks, by day 3-4 most modalities are at 0.15× simultaneously, at which point the
multiplier stops discriminating and ranking degenerates toward whatever is left.

### F4. The two optimizer call sites run different policies

| | `rules.ts:497-514` (today) | `planner.ts:477-485` (days 2+) |
|---|---|---|
| `recentHistory.systemicCost` | **not supplied** | supplied |
| Patch 1c intensity-stacking | **structurally dead** | live |
| `recentHistory.modality` | set to `trainingRecordLike.type` (a *type* string) | omitted; falls back to `type` |
| preferences | fabricated literal (`preferredRecoveryStyle:'mixed'`, `defaultWeekdayTimeMin:45`, …) | `preferences ?? NEUTRAL_PREFERENCES` |
| anchor role / adjacency | never passed | passed |

So the hard/moderate-into-hard/moderate guard that `optimizer.ts:228-240` describes as
*"what actually stops the tempo trap"* protects the forecast but not today's actual
prescription. And `rules.ts:503-509` invents a `UserPreferences` object rather than
threading the real profile or reusing `planner.ts`'s `NEUTRAL_PREFERENCES` — two answers
to the same question, 200 lines apart. No test asserts parity between the call sites.

### F5. The week-ahead strip always assumes tomorrow is green

`Home.tsx:332`:

```ts
const tomorrowRec = nextDayPlan ? nextDayPlan.branches.green.recommendation : null;
```

ADR-0008 §1 specifies the provisional tier as *"tomorrow's already-computed
green/yellow/red preview branch (**whichever the user has selected**)"*. No selection
state exists anywhere in the app — `branches.yellow` and `branches.red` are computed
(three full `evaluateTrainingWithIntent` passes, `rules.ts:984-988`) and then discarded.

Consequences: the forecast is systematically optimistic, and because `applyPick` charges
the green branch's cost into the chained fatigue/objective ledger, **every** projected
day inherits a best-case tomorrow. The three-branch evaluation is pure waste until a
selector exists.

### F6. Firestore rules do not enforce the immutability they document

`app/firestore.rules`, `daily_recommendations`:

```
// Recommendations are audit evidence and intentionally immutable as documents;
// adherence remains a validated update on the same document.
allow update: if hasValidRecommendation(userId, date) && keepsOwnership(userId)
  && request.resource.data.createdAt == resource.data.createdAt;
```

Only `createdAt` is pinned. A client may rewrite `templateId`, `mode`, `rationale`,
`recommendationAudit`, or `candidateScores` on an existing document. Worse,
`schemaVersion in [1, 2, 3]` combined with

```
&& (request.resource.data.schemaVersion != 3 || (... hasValidRecommendationAudit ...))
```

means a v3 document can be **downgraded to v1 and stripped of its audit entirely** — the
audit requirement is conditional on the version the writer chooses. `replay.ts` verifies
decisions against exactly this record. The emulator suite has five tests and covers none
of it. (Ratchet rules — `resource.data.schemaVersion <= request.resource.data.schemaVersion`,
plus field-pinning for everything except `adherence` — close both holes.)

---

## 3. Tier 2 — Architectural weaknesses

### F7. Three objective-credit models, two live and mutually inconsistent

| Model | Location | Status |
|---|---|---|
| Keyword substring on free text | `microcycle.ts:110-141` | live (fallback) |
| Stimulus-vector coverage ≥ 0.6 | `microcycle.ts:198-213` | live (primary) |
| Fractional dose-sensitive credit | `stimulus.ts:26-99` | **dead** |

The keyword matcher is not merely approximate, it is wrong in a directional way
(`microcycle.ts:118-125`): `zone2_aerobic` matches any type string containing `running`
or `cycling` — so a threshold ride credits the Zone-2 objective; `threshold_quality`
matches `hard` or `tempo`. The two live models disagree about what a given session
resolved, and which one runs depends on an incidental property of the exposure (F2).

The V2 layer (`deriveObjectiveCredit`, `getUnresolvedObjectivesV2`, `PlannerState`,
`ObjectiveProgress`, `ExecutionRecord`, `SessionHistoryEntry`, `deriveSessionPlanRelationship`)
was merged at `HEAD` with the commit message stating it is *"not yet wired into the live
scheduling pipeline"*. It is tested, typed, exported, and reachable from nothing. There
is no ADR, no migration plan, and no stated trigger for the swap-over.

`deriveObjectiveCredit` also has an internal contradiction: it returns
`qualifies: earnedCredit > 0`, so an objective that **passes** every qualification gate
but scores 0 stimulus reports `qualifies: false` — conflating "not allowed" with
"contributed nothing". Its `default: 0.5` arm silently grants half credit for any
objective key it doesn't recognise.

### F8. `WorkoutStimulusProfile` is a half-finished rename encoded in the type system

Seven canonical axes plus five legacy aliases, **all optional** (`models.ts:170-186`).
`templates.ts:575-590` populates both sides on every template, inventing two derivations
with no cited basis:

```ts
vo2MaxPower:       s.vo2MaxPower       ?? (s.surgeRepeatability   ? s.surgeRepeatability   * 0.8 : 0),
fatigueResistance: s.fatigueResistance ?? (s.thresholdDevelopment ? s.thresholdDevelopment * 0.7 : 0),
```

Consumers disagree on which vocabulary is authoritative: `optimizer.ts:calculateStimulusBenefit`
reads **legacy only** (four axes), `stimulus.ts` reads **canonical-first**. Today this is
masked because `canonicalizeStimulus` fills both; the day a template author writes only
canonical names into `TEMPLATES` (which the type permits), that template scores benefit 0
in the live optimizer and nothing fails.

Compounding it: `WeeklyObjective.targetStimulus` is `Record<string, number>`, not
`Partial<Record<keyof WorkoutStimulusProfile, number>>`. A typo'd axis name is a
compile-clean 0-coverage objective that can never be resolved.

### F9. Two selection paths, differing policies, documented only in a stale plan file

Path A (`evaluateTraining`: mode → hardcoded category allowlist → date-hash pick) and
Path B (`evaluateTrainingWithIntent`: eligibility → cost ceiling → utility ranking) both
ship. Path B *runs Path A first* (`rules.ts:486`) purely to obtain `mode` and `envelopes`,
then discards its template pick. Path A is still directly reachable via
`evaluateNextDayPlan` and remains the only path some templates can appear on.

The only place this dual structure is written down is
`docs/workout-library-expansion-plan.md §1.2` — a file marked "Status: implemented",
whose line references (`rules.ts:200`, `rules.ts:387`, `rules.ts:461`, `planner.ts:190`,
`optimizer.ts:107-120`) are all now wrong. Architecture that only exists in a completed
implementation plan will be lost.

### F10. Significant policy surfaces have no ADR, and `POLICY_VERSION` never moves

Undocumented in `docs/adr/`:

* `resolveWeeklyAnchors` and optimizer Patches 4/5/6 (anchor role boost 1.35×,
  anchor-adjacency lower-body suppression 0.3×, variety rotation tie-break). This is a
  deliberate weekly *architecture* — arguably the largest planning change since ADR-0008,
  which it post-dates and is not mentioned by.
* The entire decision-provenance layer: `POLICY_VERSION`, `RecommendationAudit`,
  `TrainingHistorySnapshot`, `replay.ts`, and the `DataState`-blocks-planning rule.
  Four commits merged from `codex/decision-provenance-safety` with no ADR.
* The V2 stimulus scaffolding (F7).

`policy.ts` defines `POLICY_VERSION = '2026-08-decision-provenance-v1'` with the comment
*"Increment whenever a change can alter a persisted recommendation decision."* `HEAD`
added a new ranking tie-break, which alters decisions. It was not incremented. A frozen
version string makes `replay.ts`'s `policyMatchesCurrent` check meaningless.

### F11. ~35 tuned constants, no calibration record, no decision-quality regression gate

`rules.ts:151-155` states the strain thresholds were *"calibrated against ~2 months of
real HRV/RHR/sleep data"*. That dataset, the procedure, and the resulting
trigger-frequency numbers exist nowhere in the repository. The same applies to the six
fatigue half-lives, the six cost-penalty weights, `PROJECTED_FATIGUE_*_THRESHOLD`, and
every optimizer multiplier.

`npm run simulate:scenarios` exists and works (10 scenarios, ran clean) — but writes to
`app/artifacts/simulation-reports/`, which is **gitignored**. There is no committed
baseline, so no reviewer can see that a constant change flipped half a projected week.
This is the missing safety net that would have caught F3's 0.21× event-modality
suppression.

### F12. Fatigue model saturates, masks, and depends on an unasserted ordering invariant

* `fatigue.ts:104-111` clamps each axis at 1.0 on accumulation. Two consecutive hard
  lower-body days ≈ one hard day at the ceiling — the model cannot represent
  *"significantly deeper in the hole"*.
* `combinedFatigue = max(external, internal)` (`fatigue.ts:113-121`): a bad night fully
  *masks* accumulated external load rather than adding to it. An athlete deep in a load
  block whose HRV happens to read fine is scored identically to a rested one at the same
  external level, and vice versa.
* `buildFatigueStateFromHistory` seeds from `history[0].date` and `applyCompletedSessionLoad`
  floors `elapsedHours` at 0. Oldest-to-newest ordering is therefore load-bearing;
  out-of-order input silently mis-decays with no error. The invariant is asserted only in
  a comment (`planner.ts:129`).

---

## 4. Tier 3 — Documentation and process

### F13. Documentation drift

* `docs/README.md`'s ADR index stops at **0008**; ADR-0009 exists and is unlisted.
* `docs/architecture/recommendation-engine.md` **describes an engine that no longer
  exists**. It documents a `REST / RECOVERY / AEROBIC_BASE / QUALITY_STRENGTH` mode
  hierarchy and thresholds "HRV drop > 10%", "RHR > baseline + 3 bpm", "sleep score < 65".
  The real engine uses `train/modify/recover` with z-scored, stdev-normalised strain at
  1.0/2.2. The doc never mentions `optimizer`, `periodization`, `microcycle`, `fatigue`,
  `planner`, `eligibility`, `dose`, `stimulus`, `provenance`, or `replay` — i.e. it omits
  ADR-0006 through ADR-0009 entirely. **This is the most misleading file in the repo**:
  it is confidently wrong rather than merely incomplete.
* `AGENTS.md` says `models.py` is "Domain Schema Version 2" (it is v3, per ADR-0002); its
  package listing omits `archive.py`, `audit.py`, `canonical.py`, `provider.py`,
  `garmin_provider.py` and ~15 engine modules.
* `README.md`'s "Technical Features" list (11 items) never mentions decision provenance,
  audit, replay, or week-ahead planning.

### F14. The frontend test suite cannot run from a clean clone

`src/firebase.ts` calls `initializeApp`/`getAuth` **at module scope**.
`trainingSettingsService.test.ts` transitively imports it, so without `VITE_FIREBASE_*`
set the whole file fails:

```
FAIL src/services/trainingSettingsService.test.ts
FirebaseError: Firebase: Error (auth/invalid-api-key)
Test Files  1 failed | 21 passed | 1 skipped
```

CI hides this by injecting dummy values. Because `predev` runs `npm run check`, a fresh
clone cannot even start the dev server. This directly undercuts ADR-0009's stated goal of
keeping Firebase initialisation out of the test path — the engine achieved it, the
service layer did not.

`app/README.md` is still the **unmodified Vite starter template**. The `VITE_FIREBASE_*`
contract is documented nowhere except `.github/workflows/ci.yml`; there is no
`app/.env.example`.

### F15. CI and tooling gaps

* No Python lint or type check. `AGENTS.md` requires *"type hints across all Python
  modules"*; `pyproject.toml` has no `ruff` or `mypy`, and CI runs only `pytest`.
* No coverage measurement or threshold on either side (`test:coverage` exists, unused in CI).
* `firestore.rules` is tested against the emulator but never deployed or drift-checked —
  nothing detects that the deployed rules differ from the repository's.
* No dependency audit (`npm audit` / `pip-audit`), no simulation regression gate.
* `garmin_login.py` sits at repo root, duplicating `scripts/bootstrap_garmin_tokens.py`,
  and works around the config guard by injecting `APP_USER_ID="bootstrap_user"` — a
  deliberate bypass of the ADR-0002 validation, in an unreferenced file.

---

## 5. Way forward

Sequenced so each phase is independently shippable and the highest-consequence gaps close
first. Effort is rough calendar-days of focused work.

### Phase 0 — Stop the bleeding (~1 day)

Small, mechanical, unblocks everything else.

1. **Make the test suite runnable offline.** Convert `src/firebase.ts` to lazy accessors
   (`getDb()`/`getAuthInstance()`) so importing a service does not initialise Firebase;
   or add a vitest setup file providing dummy `VITE_FIREBASE_*`. Add `app/.env.example`
   and replace `app/README.md` with real setup instructions.
2. **Bump `POLICY_VERSION`** and add a check to `npm run check` that fails if
   `optimizer.ts`/`rules.ts`/`microcycle.ts` changed without it moving.
3. **Commit a simulation baseline.** Un-gitignore a single deterministic
   `docs/analysis/simulation-baseline.json`, add `npm run simulate:check` diffing against
   it, and wire it into CI. This is the regression net for every subsequent phase.
4. **Add `ruff` + `mypy` to `pyproject.toml` and CI.**

### Phase 1 — Close the safety gaps (~3-4 days) — *do not defer*

5. **F1 — Give injuries a real path.** Add a typed `injuries: BodyRegionConstraint[]`
   (region + severity + optional expiry) to `TrainingSettings` v3, a Preferences-screen
   editor, Firestore rules validation, and thread it through
   `mapContextFromGoalsAndTrainingSettings`. Replace the substring `RUNNING_INJURY_PATTERN`
   with region→modality/category mapping so a lower-body constraint also excludes
   `Lower-body Strength`, not only `Running`. Note `trainingSettings` rules already
   permit `schemaVersion: 3` while the client only reads `2` — the forward-compat
   allowance is already there and currently unusable.
   *Test to add:* a lower-body injury must exclude heavy squats on **both** paths and
   across all 7 forecast days.
6. **F6 — Ratchet the recommendation rules.** Pin every field except `adherence` on
   update, and require `request.resource.data.schemaVersion >= resource.data.schemaVersion`.
   Add emulator tests for: field tampering, v3→v1 downgrade, audit removal.
7. **F2 — Fix objective crediting for measured work.** Only attach `stimulusProfile` when
   it is non-zero (`completedEventToExposure`), so Garmin-only events fall through to the
   fallback path; and derive a coarse but non-zero stimulus estimate from
   `modality × intensity` in `candidateEventFromGarmin`, mirroring the existing
   `DEFAULT_COST_BY_MODALITY` table. Add `DEFAULT_STIMULUS_BY_MODALITY`.
   *Test to add:* the probe from F2 — three Garmin sessions must resolve
   `zone2_aerobic` and `strength_maintenance`.

### Phase 2 — Make the two paths agree (~3 days)

8. **F3 — Put dates back in the ranking context.** Add `date: string` to
   `RecentHistoryEntry`; make `getConsecutiveModalityCount` require actual consecutive
   calendar days, and give `getRollingModalityCount` an explicit window parameter.
   Re-tune the rolling threshold against event modality: for an A-event athlete, three
   sport-specific sessions per week is the target, not the thing to suppress. Consider
   exempting the focus-event modality from the rolling arm entirely, or applying the
   suppression to `category` rather than `modality`.
9. **F4 — One optimizer invocation builder.** Extract a single
   `buildOptimizationContext(intent, context, preferences, date)` used by both
   `rules.ts` and `planner.ts`. Delete the fabricated `UserPreferences` literal.
   *Test to add:* given identical inputs, both call sites must produce identical
   `RankedCandidate[]`.
10. **F5 — Either wire the branch selector or stop computing three branches.**
    Preferred: add tier selection to the next-day card, thread it into
    `generateWeekAheadPlanWithIntent`, and update ADR-0008 §1 if the resolution differs.
    Cheaper interim: default to `yellow` (the honest median) and say so in the ADR.

### Phase 3 — Retire the scaffolding (~4-5 days)

11. **F7/F8 — Pick one credit model and one vocabulary.** Write **ADR-0010: Dose-sensitive
    objective credit** stating the target model, then either complete the V2 migration or
    delete `stimulus.ts` and the unused V2 types. Do not leave it at `HEAD`'s state.
    Simultaneously: make canonical axes **required** on `WorkoutStimulusProfile`, drop the
    legacy aliases behind a one-shot codemod, and type `targetStimulus` as
    `Partial<Record<keyof WorkoutStimulusProfile, number>>`.
12. **F12 — Revisit fatigue accumulation.** Replace hard clamping with a saturating
    function that stays monotonic past 1.0 (e.g. `1 - exp(-x)` on the raw sum), and
    reconsider `max(external, internal)` in favour of a weighted combination. Add an
    ordering assertion (throw, not comment) in `buildFatigueStateFromHistory`.
    Gate this behind the Phase-0 simulation baseline — it will move every projected day.
13. **F9 — Decide Path A's future.** Either document it as a deliberate readiness-only
    fallback in an ADR, or collapse it: extract `evaluateReadinessMode()` returning
    `{mode, envelopes, telemetry}`, keep that as the only shared entry point, and let
    template selection live solely in the optimizer.

### Phase 4 — Documentation truth-up (~2 days)

14. **Rewrite `docs/architecture/recommendation-engine.md` from scratch** against the
    current engine. It is worse than having no document.
15. **Backfill missing ADRs**: 0010 decision provenance & audit replay (retroactive),
    0011 weekly architecture & anchors, 0012 objective credit V2. Add a
    "Superseded/Amended by" line to ADR-0007 §6 and ADR-0008 §1/§6 once F1/F3/F5 land.
16. **Fix `docs/README.md`'s index**, `AGENTS.md`'s schema version and module lists, and
    the stale line references in `workout-library-expansion-plan.md` (or mark the file
    archived and move the two-path explanation into an ADR).
17. **Delete `garmin_login.py`** in favour of `scripts/bootstrap_garmin_tokens.py`.

### Phase 5 — Calibration as a first-class artifact (~ongoing)

18. Commit the calibration dataset (anonymised or synthetic-but-representative) and a
    `scripts/calibrate.ts` that reports trigger frequencies per mode. Every tuned constant
    should cite a line in its output. Without this, §3 F11 recurs with each new heuristic.

---

## 6. Suggested priority if time is limited

If only three things get done: **F1** (injury gate has no data), **F2** (measured
training earns no credit), **F6** (audit records are rewritable). The first two are why
the engine's actual behaviour differs from its documented behaviour for a real user
today; the third is why you could not prove it after the fact.

---

*Findings were verified against the working tree at `2ea45cd`. Probe code used to confirm
F2 and F3 was temporary and is not committed.*
