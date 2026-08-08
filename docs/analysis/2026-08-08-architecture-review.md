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
models (two live, one dead), two stimulus vocabularies, two phase vocabularies, and two
selection paths — all shipped simultaneously, with the newest layer merged at `HEAD`
explicitly labelled "not yet wired". Each was individually a reasonable step; together
they are the main source of the divergences below.

The third theme, added on reconciliation with an independent review (§7), is that
**the richest training knowledge in the repository is not connected to the planner at
all**: `workouts/event-plan.ts` encodes the real macrocycle — sustained quality,
gap-closing, outdoor specificity, travel maintenance, taper sharpening, race-week
strength — and its only consumer is a build-time catalog linter (F16). The live engine
re-derives a lossy approximation of that plan from generic days-to-event arithmetic,
half of whose output is itself unread (F17). This is the strongest argument that the
long-term fix is architectural, not a further optimizer increment.

None of the three requires a rewrite. All three require finishing things that were
started.

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
athlete with an achilles problem **can be** offered heavy lower-body strength the moment
they stop ticking the pain box — other gates (readiness mode, fatigue, equipment, time)
may still suppress it in a given instance, but the persistent local-injury gate that
should prevent it is not participating in the decision at all.

This is the single most important finding in this document.

### F2. Garmin-measured training earns zero microcycle credit

**Precise claim:** a *recognised* Garmin-only completion that has no matched structured or
adherence-confirmed stimulus earns **zero** objective credit, because its all-zero profile
selects the vector-coverage path and simultaneously blocks the keyword fallback.

Verified empirically (throwaway probe, since removed): three Garmin activities in the
rolling window — a 120-min hard ride, a 60-min strength session, a 90-min moderate ride —
produce `zone2_aerobic 0/2`, `threshold_quality 0/1`, `strength_maintenance 0/1`.

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

**Practical effect, stated no more strongly than the evidence supports:** objectives can
still resolve from other sources — an adherence-confirmed session carries the exact
template's stimulus profile, and genuinely unrecognised activity types still reach the
fallback. Missing one adherence response does not mean the ledger can never resolve.

But where recognised Garmin-only sessions are the athlete's *primary* completion source —
the common case for someone training outdoors and answering the prompt intermittently —
the ledger can stay unresolved despite real training. When it does,
`calculateStimulusBenefit` keeps scoring the same unresolved targets, `plannedDose` stays
near maximum urgency (`trainingIntent.ts:77-80`, `urgency = unresolved/total`), and the
post-objective aerobic filler (optimizer Patch 3) never engages.

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

```text
// Recommendations are audit evidence and intentionally immutable as documents;
// adherence remains a validated update on the same document.
allow update: if hasValidRecommendation(userId, date) && keepsOwnership(userId)
  && request.resource.data.createdAt == resource.data.createdAt;
```

Only `createdAt` is pinned. A client may rewrite `templateId`, `mode`, `rationale`,
`recommendationAudit`, or `candidateScores` on an existing document. Worse,
`schemaVersion in [1, 2, 3]` combined with

```text
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
`docs/plans/0000-workout-library-expansion.md §1.2` — a file marked "Status: implemented",
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

### F16. The event-plan contract is invisible to the engine

*Added during the second-review reconciliation (§7); credit to the independent review.*

`app/src/workouts/event-plan.ts` encodes 17 `EventPlanSessionCoverage` entries — each with
a phase list (`build | travel | peak | taper | race`), a requirement tier
(`required | optional | conditional`), concrete workout IDs, and genuine coaching notes:

> *"Remove first when it compromises cycling quality or taper freshness."*
> *"Remove in the final 7–10 days before the event."*
> *"Use only when calf, Achilles and knee response remain normal."*
> *"Short, low-volume and early enough to avoid soreness."*

This is the richest training-domain knowledge in the repository. **Its only consumer is
`app/scripts/validate-workouts.ts`** — a build-time catalog-completeness linter. No engine
module imports it. Verified: the sole non-self references are `workouts/index.ts`
(re-export) and the validation script.

So the live planner cannot distinguish `sustained_quality` from `gap_closing` from
`outdoor_event_specific`; it collapses all of them into `threshold_quality` /
`surge_repeatability` and re-derives an approximation of the plan from generic
days-to-event arithmetic. ADR-0004 §3 frames this file as *"a declarative phase coverage
contract [that] guarantees every required workout family exists and is active"* — accurate
as far as it goes, and that framing is probably why the file has stayed a linter input.

### F17. Periodization's intensity dimension is entirely inert

*Also added during the second-review reconciliation. F16/F17 are numbered after the
Tier-3 findings below because they were appended after first publication; they belong to
Tier 2 by consequence.*

`PhaseWeights.intensityScale` is **assigned in six places in `periodization.ts` and read
in zero**. Post-Event Recovery's `0.4` and Specificity's `1.1` affect nothing.
`volumeScale` has exactly one consumer — `trainingIntent.ts:80`'s `plannedDose`. So of
periodization's two output scalars, one is dead and the other is a single multiplier on a
single number.

Related: there are **two disjoint phase vocabularies with no mapping between them** —
`EventPlanPhase` (`build | travel | peak | taper | race`, workouts layer) and
`PhaseWeights.phaseName` (`Base | Build | Specificity | Peak/Taper | Post-Event Recovery`,
engine layer). Any work on F16 has to reconcile these first.

Also unused-but-declared, reinforcing F7: `WeeklyObjective.requiredCredit`, `.windowStart`,
`.windowEnd`, `.priority`. `requiredCredit` is referenced only inside the dead
`getUnresolvedObjectivesV2`.

---

## 4. Tier 3 — Documentation and process

### F13. Documentation drift

* ~~`docs/README.md`'s ADR index stops at **0008**; ADR-0009 exists and is unlisted.~~
  **Resolved by the same change that introduced this document** — recorded here as the
  baseline state at `2ea45cd`, not as outstanding work.
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

```text
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
3. **Make coaching invariants the CI gate; keep the snapshot diagnostic.** Encode the
   current cycling macrocycle as an asserted golden week (see §7.4): ≥48 h between key
   cycling quality exposures; no heavy lower-body strength compromising them; no penalty
   merely for a third cycling exposure; outdoor work satisfies plan objectives. Those
   assertions — plus a few deliberately loose aggregate bounds — are what blocks CI.
   A committed `simulation-baseline.json` with a **semantic** diff
   (`npm run simulate:diff`) is retained as a non-blocking review aid.
   A byte-exact snapshot gate is explicitly rejected: Phases 3–5 intentionally change
   planner behaviour, so an equality gate would both freeze today's known-bad output as
   the reference and reduce every improvement to baseline churn.
   **This is the instrument every later phase is measured with — it must land before any
   constant or heuristic is changed.** See
   [`docs/plans/phase-0-instrumentation.md`](../plans/phase-0-instrumentation.md).
4. **Add `ruff` + `mypy` to `pyproject.toml` and CI.**

### Phase 1 — Close the safety gaps (~3-4 days) — *do not defer*

5. **F1 — Give injuries a real path.** Add a typed `injuries: InjuryConstraint[]`
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

8. **F3 — Replace modality anti-stacking; do not merely date it.** Adding `date: string`
   to `RecentHistoryEntry` is necessary but not sufficient — it makes the rule *correct*
   while leaving it the *wrong shape*. Modality repetition is not the hazard; insufficient
   recovery between hard lower-body quality exposures is. Replace the two multipliers with
   explicit structured constraints over a dated, role-annotated history: minimum hours
   between quality sessions, no back-to-back hard lower-body work, a rolling hard-session
   cap, and strength protection around key cycling days.
   Express these **lexicographically**, not as further multipliers (see §7.3): the current
   code demonstrates why a multiplicative scalar cannot hold the line — the 0.15× anti-stack
   term buys out the 1.40× A-event boost, producing a net 0.21× against exactly the
   modality the athlete's A-event requires.
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

11. **F7/F8 — Pick one credit model and one vocabulary.** Write **ADR-0014: Dose-sensitive
    objective credit** stating the target model, then either complete the V2 migration or
    delete `stimulus.ts` and the unused V2 types. Do not leave it at `HEAD`'s state.
    Simultaneously: make canonical axes **required** on `WorkoutStimulusProfile`, drop the
    legacy aliases behind a one-shot codemod, and type `targetStimulus` as
    `Partial<Record<keyof WorkoutStimulusProfile, number>>`.
12. **F12 — Revisit fatigue accumulation, in that order.** Two separable pieces:
    *(a) a correctness fix, do now* — assert chronological ordering in
    `buildFatigueStateFromHistory` (throw, not comment).
    *(b) a modelling question, do not pre-decide* — retain an unsaturated latent
    external-load state so depth past the current 1.0 clamp is not discarded, then use the
    Phase-0 harness to **compare** candidate fusion functions before committing to one in
    an ADR.
    An earlier draft of this document prescribed `1 - exp(-x)` plus a weighted
    external/internal combination. That is withdrawn: it is not justified by anything here,
    and it would repeat exactly the uncited-constant practice F11 criticises. It is also
    probably wrong as stated — internal response (HRV/RHR/soreness) is partly a *reaction to*
    the same external work, so a weighted sum double-counts load unless calibrated, and
    `1 - exp(-x)` changes the state's scale and meaning rather than merely its monotonicity.
13. **F9 — Decide Path A's future.** Either document it as a deliberate readiness-only
    fallback in an ADR, or collapse it: extract `evaluateReadinessMode()` returning
    `{mode, envelopes, telemetry}`, keep that as the only shared entry point, and let
    template selection live solely in the optimizer.

### Phase 4 — Documentation truth-up (~2 days)

14. **Rewrite `docs/architecture/recommendation-engine.md` from scratch** against the
    current engine. It is worse than having no document.
15. **Backfill missing ADRs.** Retroactive ones are written: **ADR-0010** (decision
    provenance & audit replay) and **ADR-0011** (weekly architecture & anchors). Forward
    numbers are reserved and written with their phase: **0012** plan intent,
    **0013** structured injury constraints, **0014** objective credit V2,
    **0015** sequence planning. Add a "Superseded/Amended by" line to ADR-0007 §6 and
    ADR-0008 §1/§6 once F1/F3/F5 land.
16. **Fix `AGENTS.md`'s schema version and module lists**, and
    the stale line references in `docs/plans/0000-workout-library-expansion.md` (or mark the file
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

## 7. Reconciliation with the independent review

A second review of the same commit was produced independently and is reconciled here.
Its claims were re-verified against the working tree before being adopted. The two
reviews answer different questions and are complementary rather than competing:

* **This document** asks *"what does the system do right now, and where does that differ
  from what it claims?"* — a defect-and-drift audit, verified by execution.
* **The independent review** asks *"what shape should the planning core be?"* — an
  architectural critique, and on that question it is the stronger document.

### 7.1 Adopted from the independent review

| Claim | Verification | Outcome |
|---|---|---|
| The event-plan contract is disconnected from the live planner | Confirmed — sole consumer is `validate-workouts.ts` | Added as **F16** |
| `intensityScale` is not authoritative | Confirmed, and stronger than stated: read in **zero** places | Added as **F17** |
| Modality anti-stacking is the wrong abstraction | Confirmed against this document's own F3 evidence | Reframed Phase-2 step 8 |
| Greedy per-day ranking is solving a sequence problem | Structural; accepted | See §7.3 |
| Objective credit should be dose- and objective-specific | Consistent with F7; more specific than this document was | Folded into Phase 3 |
| Fixed activities are not persisted planning inputs | Confirmed — `WeekAheadOptions.fixedActivities` has no Firestore source | Accepted |
| Local tissue state is too coarse (one soreness scalar) | Confirmed; complements F1 | Accepted, sequenced after F1 |

**F16 is the most significant thing this document originally missed.** ADR-0004 frames
`event-plan.ts` as a coverage contract validated by a script; that framing was accepted
here rather than interrogated. The independent review asked what *else* the file knows,
and the answer is: most of the actual training plan.

### 7.2 Findings absent from the independent review

Three findings here do not appear there, and each undercuts a rating that review assigns:

* **F1** — it endorses *"safety before preference — keep this"* and *"safety remains
  independently authoritative"*, then proposes richer tissue tracking, while the existing
  injury channel is hardcoded empty. Adding a tissue layer above a disconnected gate
  reproduces the same failure one level up. **F1 must precede that work.**
* **F6** — it rates security 8/10 and audit/replay 8.5/10 without the v3→v1 audit-strip
  path. Those ratings do not survive the finding.
* **F5** — it praises the `confirmed/provisional/projected` tiers without noting that the
  provisional tier is hardcoded to the green branch, which biases every projected day it
  seeds.

On **F2**, that review reaches the right conclusion (*"the system sees cost but not
benefit"*) without the mechanism, and so misses the inversion: attaching the all-zero
vector actively *blocks* the keyword fallback, making recognised activities worse off than
unrecognised ones. That distinction matters for sequencing — the fix is a guard plus a
lookup table, deliverable now, rather than the evidence-hierarchy subsystem that review
implies. Both are worth building; the small one should not wait for the large one.

### 7.3 Where this document's plan is revised

**Lexicographic priority ordering replaces multiplier tuning.** The independent review's
proposed hierarchy is adopted:

```text
1. Safety and feasibility
2. Must-have plan obligations
3. Sequence and recovery constraints
4. Objective coverage and timing
5. Expected fatigue cost
6. Preferences / variety / convenience
```

Scalar utility ranking remains, but *within an equivalent candidate class* — choosing
between indoor Zone 2, an outdoor easy ride, and cross-training once the role is fixed.
That is what it is good at. The present architecture instead asks one multiplicative score
to arbitrate safety, periodization, interference, recovery, preference and variety
simultaneously, and F3 is the proof that it cannot.

**Bounded sequence search over the 7-day horizon** (beam width 10–20) is *evaluated against*
the greedy day-by-day walk in a later phase, and whichever measures better is retained — see
D-BEAM. A 7-day horizon does not warrant heavier machinery than beam search if it is adopted.

### 7.4 Where this document dissents

* **Drop the numeric scorecard.** A per-area /10 table is unfalsifiable, and is
  miscalibrated by that review's own gaps (see §7.2).
* **Reorder the implementation steps.** That review removes modality anti-stacking at
  Step 2 and promotes simulations to coaching-contract tests at Step 10. That replaces one
  uncalibrated heuristic with an uncalibrated constraint system and no instrument to
  observe the change. Its own golden-scenario specification is excellent and belongs
  **first** — note the simulation harness currently writes to a gitignored directory, so
  no committed baseline exists at all (F11).
* **Do not front-load the cutover past the live defects.** The V2 Plan-Intent cutover is
  the right destination and should be the main line of development — but a cutover
  performed over F1 and F6 inherits an unwired safety gate and rewritable audit evidence.
  Roughly four days of Phase-1 work buys a correct foundation to migrate onto.

### 7.5 Merged priority

```text
0. Simulation baseline + golden coaching scenario        (the instrument)
1. F1, F2, F6                                            (live defects, ~4 days)
2. ADR-0012: Plan Intent is the planning authority       (+ F16 engine-visible
                                                            event plan, + F17
                                                            intensityScale disposition)
3. F3 via lexicographic constraints, F4, F5              (one coherent ranking path)
4. Wire V2 objective progress; retire the dead layer     (F7, F8)
5. Beam search, PlanDefinition, fixed activities,
   local tissue state, dose-sensitive cost               (the cutover proper)
```

The independent review's closing principle is the right one to build toward, and is
adopted here verbatim:

> *The plan decides what adaptation is needed. Readiness decides how safely it can be
> executed. The optimizer chooses among equivalent feasible implementations. Actual
> training updates both achieved stimulus and incurred cost.*

The addition this document makes is that steps 0 and 1 are prerequisites for it, not
detours around it.

---

*Findings were verified against the working tree at `2ea45cd`. Probe code used to confirm
F2 and F3 was temporary and is not committed. §7 reconciles an independent review of the
same commit; its claims were re-verified before adoption.*
