# Recommendation Engine Architecture

How `app/src/engine/` turns a morning's data into a prescribed session.

> **Accuracy note.** Rewritten 2026-08-08 against the engine as it actually is. The
> previous version described a `REST / RECOVERY / AEROBIC_BASE / QUALITY_STRENGTH` mode
> hierarchy with fixed thresholds ("HRV drop > 10%", "sleep score < 65") that the code has
> not used for some time, and omitted every module added by ADR-0006 onward.
> Keep this file updated with the code — a confidently wrong architecture doc is worse
> than none (finding F13).

---

## Two selection paths

A template can reach the athlete through **two distinct selection paths with different
filtering rules** (distinct, not independent — Path B runs Path A internally for mode and
envelopes, so the readiness computation is shared; only the *selection* differs). Any change here must be evaluated against both.

### Path A — readiness only (`evaluateTraining`)

```text
readiness → mode (train | modify | recover) → category allow-list → date-hash pick
```

Pure and synchronous. No history, no events, no periodization. Still reachable directly
via `evaluateNextDayPlan`, and it computes the mode and safety envelopes that Path B
depends on.

Phase-gated templates (`phaseEligibility`) are excluded from Path A entirely — it holds no
`PeriodizationResult`, so it cannot evaluate them at all.

### Path B — intent-aware (`evaluateTrainingWithIntent`, `generateWeekAheadPlan`)

```text
ENRICHED_TEMPLATES → eligibility → envelope + mode ceilings → phase eligibility
                   → rankCandidates → top pick
```

Asynchronous; resolves training intent from completed/adherence history first. Path B consumes `evaluateReadinessAndSafetyEnvelope` to obtain `mode`, `envelopes`, and `telemetry` directly, sharing the exact readiness calculation with Path A without running a discarded template selection (F9 resolved under ADR-0012).

### Not a third selection path — adjudication (`externalSession.ts`, ADR-0019)

`externally_planned` mode adds a second *entry point*, not a third selection path. The
plan's author has already selected; the engine only adjudicates:

```text
placed imported session → GateableSession → same clinical/feasibility/ceiling/dose ladder
                        → proceed | scale | defer | skip | advisory
```

Nothing is ranked, and `Recommendation.decisionTrace.candidateScores` is empty by
construction. The authority ordering below is unchanged and gains no step — an imported
session clears exactly the gates a catalog template clears, through the same
`evaluateTemplateEligibility` and `resolveExecutionDose` calls, because
`eligibility.ts` was widened to `GateableSession` rather than given a parallel path
(D-CANDIDATE).

Two short-circuits sit above the ladder: an `isEvent` session is always `advisory`
(D-EVENT), and a `reducible: false` session defers instead of scaling (D-IRREDUCIBLE).

`externalCritique.ts` reviews the placed week using the *selection* modules
(`microcycle.ts`, `planner.ts`, `optimizer.ts`) and emits advisory findings only. It
cannot import `externalSession.ts`, and `externalArchitecture.test.ts` enforces both that
boundary and the absence of any runtime import from `optimizer.ts`/`planner.ts` into
adjudication.

---

## Planning authority and coverage sets (`planningMode.ts`, `evergreenPlanning.ts`)

`resolvePlanningContext` is the single authority for planning mode. A persisted
`TrainingIntentProfile` supplies the athlete-owned mode, ordered priorities, and weekly
minimum/typical/maximum session commitment; `UserPreferences` remains the owner of
weekday/weekend duration and hard unavailable modalities.

`externally_planned` is effective only when the athlete selected it **and** a session is
actually placed on the date. Choosing the mode does not by itself suspend the engine: an
unplanned day resolves to `evergreen` with `externalFallback: true`, which the caller must
label rather than present as an ordinary pick (ADR-0019 D-EXT).

An eligible event remains event-directed for profile-less athletes, preserving the legacy
path. An explicit `event_directed` profile uses an eligible event when present. Otherwise
the effective mode is `evergreen`: it has no focus event and no event strategy, even if an
event record exists. Event-directed cycling uses `structured_plan`; running, triathlon,
strength, and general events retain `demand_derived` planning.

For evergreen mode, `resolveEvergreenPlan` combines bounded completed history with the
profile and real schedule availability. `resolveEvidenceBackedStrategy` establishes dose
requirements before `resolveTrainingCapacity` and `packWeeklyDose` map them to exact
workout identities. The legacy 2-to-6-session table is only an equal-dose placement
tie-breaker; it does not set a physiological requirement or hide a capacity shortfall.

The coverage registry has two descriptors. `september_cycling_event` is the frozen,
event-directed cycling contract. `evergreen_general` is a rolling seven-day `general`
descriptor with modality-specific exact identities, including a continuous easy run that
is distinct from walk-run. `buildCoverageState` receives the descriptor from the active
plan, so the coverage tier is meaningful for eventless athletes too.

Authored travel blocks scale planned dose through `applyPlanningOverlays` across
structured, demand-derived, and evergreen paths. Fixed activities retain schedule
ownership and constrain availability before candidates are selected.

---

## Module map

```text
                    DailyRecoverySnapshot + DailySubjectiveCheckin
                                      │
                    adapters.ts  ─────┴─────  validation.ts
                                      │
                                 DailyReadiness
                                      │
        ┌─────────────────────────────┼─────────────────────────────┐
        ▼                             ▼                             ▼
   rules.ts                    trainingIntent.ts              eligibility.ts
   mode + envelopes            resolves plan-side intent      hard gates
   + strain telemetry                 │                       (time, equipment,
        │                    ┌────────┼────────┐               environment,
        │                    ▼        ▼        ▼               guardrails)
        │            periodization  microcycle  fatigue
        │            phase/focus    objectives  6D decay
        │                    └────────┼────────┘
        │                             ▼
        │                       optimizer.ts
        │                    benefit / (1 + cost) × modifiers
        └─────────────────────────────┼─────────────────────────────┐
                                      ▼                             ▼
                                   dose.ts                     planner.ts
                             execution dose ceiling        7-day projection
                                      │                             │
                                      ▼                             │
                            workouts/prescription.ts ◄──────────────┘
                                      │
                              provenance.ts → RecommendationAudit
```

| Module | Responsibility |
|---|---|
| `adapters.ts` | Firestore canonical models → engine inputs |
| `validation.ts` | Schema validation and sanitisation at the persistence boundary |
| `eligibility.ts` | The single hard-gate resolver: time, equipment, environment, guardrails |
| `rules.ts` | Strain scoring, `train`/`modify`/`recover` mode, safety & plan envelopes, adjustment tiers |
| `periodization.ts` | Event lifecycle, focus-event resolution, continuous phase weights |
| `microcycle.ts` | Weekly objectives and the authoritative fractional objective-credit ledger |
| `stimulus.ts` | Stimulus-boundary validation and objective-specific credit derivation |
| `fatigue.ts` | Six-dimensional fatigue with exponential decay and unsaturated external-load depth |
| `optimizer.ts` | Candidate ranking: objective benefit vs cost, plus named timing/preference modifiers |
| `trainingIntent.ts` | Composes periodization + objectives + fatigue + planned dose |
| `dose.ts` | Validates and intersects planned dose with the clinical ceiling and athlete adjustment |
| `planner.ts` / `weeklyAllocation.ts` | Rolling 7-day projection, projected-credit ledger, exact-role reservation evidence and weekly anchor preferences |
| `provenance.ts` / `replay.ts` | Audit construction and current-policy verification; historical policies are audit-only |

---

## Mode selection (`rules.ts`)

Three modes, not four: **`train`**, **`modify`**, **`recover`**.

Objective strain is a continuous, **self-normalised** score — not fixed absolute
thresholds. Each of HRV, RHR and sleep score contributes two z-scored terms:

* **acute** — today vs this person's own trailing 7-day baseline
* **chronic** — the 7-day baseline's drift from the 28-day baseline, weighted ×1.5,
  because a multi-day trend predicts overreaching better than one noisy night

Normalisation uses the athlete's own trailing 28-day stdev, floored (HRV 3 ms, RHR
1.5 bpm, sleep 4 pts) so a flat metric cannot produce an explosive z-score. Each metric's
contribution is capped at ±2.0 so one outlier cannot dominate.

```text
strain = Σ metric(acute + 1.5 × chronic) × weight     HRV 0.5, RHR 0.3, sleep 0.2
       + sleepFloorPenalty          sleep score < 50           → +0.5
       + bodyBatteryDeficit         ramps 50 → 25              → up to +0.3
       + recentHardSessions         ≥2 hard in 3 days          → +1.0
       + conservativeBias           athlete preference         → +0.4
```

| Mode | Trigger | Candidate ceiling |
|---|---|---|
| `recover` | strain ≥ 2.2, fatigue score > 7, pain, body battery ≤ 20, or already trained today | `Rest` / `Mobility/Recovery` |
| `modify` | strain ≥ 1.0, fatigue score > 5, or soreness > 6 | `systemicCost <= 0.5` |
| `train` | otherwise | category allow-list (Path A) or plan-tier ceiling (Path B) |

`modify` caps by **systemic cost**, not by category — so upper-body strength (cost 0.3)
remains available on a day when legs and intervals are not.

Two overrides sit on top: a **post-recover buffer** softens a fresh `train` to `modify` the
day after a mandated recovery day, and an **already-trained-today** override forces
`recover` regardless of how green the numbers look.

---

## Objective credit and stimulus authority (`stimulus.ts`, `microcycle.ts`)

Phase 4 uses one fractional objective-credit model. `deriveObjectiveCredit` validates an
untrusted/persisted stimulus profile once at the boundary, while internal fan-out uses
`deriveObjectiveCreditFromProfile` on already canonical profiles. The canonical profile has
eight `0..1` axes; legacy `aerobicCapacity`, `thresholdDevelopment`, and
`surgeRepeatability` are accepted only as persistence-boundary renames. A supplied
non-finite or out-of-range known axis makes the record `DataState.INVALID`.

`WeeklyObjective.completedCredit` is completed-evidence authority. For endurance/power
objectives, credit is scaled by measured completed/planned duration when both are available,
and an independently supplied completion ratio scales separately. Strength maintenance does
not treat elapsed duration as a proxy for useful sets/load.

`completedExposures` is compatibility display state only. Both completed and projected
paths derive it through the same `0.5 credit/exposure` compatibility projection; it does
not resolve objectives when fractional credit says they are still outstanding.

Keyword matching remains a last-resort compatibility path for old/external records without
structured stimulus. A match contributes `0.5` credit to the **same** ledger rather than a
parallel counter, making mixed structured/legacy replay order-independent.

### Evidence hierarchy for completed training (Phase 5.5, `completedTraining.ts`)

Generalises the coarse modality x intensity inference above into a named, ordered
`EvidenceTier` (strongest to weakest): `exactPrescribedMatch` (adherence confirms a
catalog template with an authored `stimulusProfile`) → `completedStructuredWorkout` /
`measuredEffort` (Garmin `activityTrainingLoad` alongside Training Effect -- the closest
currently-ingested proxy for "completedStructuredWorkout" and per-interval
power/HR/cadence structure, which nothing ingests yet) → `garminTrainingEffect` →
`durationIntensity` (an intensity tag alone) → `athleteClassification` (modality guessed
from free text) → `genericModalityFallback` (nothing known at all).
`classifyGarminTier`/`stimulusConfidenceForTier` produce `CompletedExposure`'s existing
`stimulusConfidence` ('exact' | 'inferred' | 'unknown') from this ladder, replacing what
used to be an ad hoc `exactTemplateMatch`/`hasStimulus`/`modality` check.

`stimulus.ts`'s `CONFIDENCE_CREDIT_WEIGHT` (exact 1.0, inferred 0.75, unknown 0.4) then
discounts `deriveObjectiveCreditFromProfile`'s earned credit by that confidence -- every
caller that doesn't pass a confidence defaults to `'exact'` (unchanged full-credit
behavior, e.g. `planner.ts` scoring an authored candidate template). This closes the
asymmetry the plan named: `DEFAULT_STIMULUS_BY_MODALITY.Unknown` used to be all-zero even
though `DEFAULT_COST_BY_MODALITY.Unknown` was not, so an unplanned, unclassifiable session
was charged fatigue but credited no adaptation at all. It now carries a real, deliberately
conservative generic profile, discounted rather than zeroed.

A stimulus profile no longer requires a *known* modality to be creditable --
`genericModalityFallback` still credits a modality-agnostic objective. This is safe only
because `deriveObjectiveCreditFromProfile` now **fails closed**: a modality- or
category-scoped objective is rejected (not silently skipped) when the evidence's
modality/category is unknown, rather than the previous behavior where an absent
`context.modality`/`context.category` bypassed the restriction entirely.

---

## Planned and execution dose authority (`trainingIntent.ts`, `dose.ts`)

`PlannedDose` has independent `{ volume, intensity }` components. The persisted audit
contract is finite `volume ∈ [0,1]`, `intensity ∈ [0,1.2]`.

* **Explicit-plan mode:** the active authored `PlanBlock` owns both dimensions, bounded only
  by that persisted contract. Generic days-to-event phase scaling cannot overwrite an
  authored travel/taper dose.
* **Generic mode:** objective urgency shapes volume while periodization supplies intensity.
* **Optimizer:** a hard candidate is inadmissible below planned intensity `0.8`; intensity
  is not a disguised duration multiplier.
* **Execution:** `resolveExecutionDose` fails closed on invalid/out-of-contract planned
  dose, applies an athlete easier/harder adjustment to volume, and intersects volume with
  the independent clinical/readiness ceiling.

Recommendation provenance persists both planned and execution dose when available.

### Authored travel overlays

Travel is an explicit, user-owned `AuthoredPlanBlock`, persisted at
`users/{userId}/plan_blocks/{blockId}`. `planBlockService.ts` validates the date range and
the independent `0..1` volume/intensity scales on both reads and writes; `firestore.rules`
enforces the same owner-scoped shape. `Home.tsx` supplies available blocks to today's,
tomorrow's, and week-ahead Path B calls. An active travel block takes precedence over its
overlapping derived event block, so it owns both its planned dose and its exactly declared
weekly objectives (aerobic volume plus maintenance strength); it is never inferred from an
event title, venue, or fixed activity.

### Taper as an explicit contract (Phase 5.7, `microcycle.ts`, `periodization.ts`, `planSchedule.ts`)

Before this, `taperActive`/`volumeScale` reduced volume, but nothing represented "preserve
useful, event-specific intensity" as its own thing -- `generateWeeklyObjectives` simply
stopped generating a `race_specific_endurance` objective for the whole taper window
(`!phaseWeights.taperActive`), so whatever survived `phaseEligibility.requiresTaper`
gating and utility ranking was accidental, not requested. `event-plan.ts`'s
`taper_sharpening`/`race_week_strength` coverage roles already named the real intent;
nothing consumed them as objective targets.

Both `generateWeeklyObjectives` branches (generic days-to-event and plan-derived) now
generate a taper-calibrated `race_specific_endurance` objective during `taperActive`
instead of omitting it, and lower the `strength_maintenance` target to a race-week-primer
level -- calibrated against `end_taper_sharpen_01`'s own (deliberately lower) stimulus
profile in `templates.ts`, not the full peak-block `end_race_sim_01` bar, which a taper
session structurally cannot clear. `PlanObjectiveDefinition` (`planSchedule.ts`) gained an
optional `role: PlanSessionRole` field -- previously declared but never assigned to
anything -- and the authored September event plan's taper block now actually requests its
own `taper_sharpening`/`race_week_strength` coverage keys instead of only the generic
`easy_aerobic` one.

### Multi-event: one taper authority, multiple demand contributors (Phase 5.6, `periodization.ts`)

`evaluatePeriodizationPhase` still picks exactly one governing event (the **taper
authority**) -- but now by a full, commented total order: priority, then proximity, then
planning date, then event id as a determinism backstop (never a real ranking signal). Two
events genuinely tied through every real criterion surface via the new
`governingEventTie` field rather than being silently resolved by the id backstop as if it
meant something.

Every other eligible, scheduled event within a 35-day window (matching the existing
Specificity-phase threshold) is a **demand contributor**: `objectivesFromDemand` (shared
with Phase 5.7's own objective generation) derives objectives from *that event's own*
demand vector, category, and own taper state -- never a blended vector, which is the
reason this sits after Phase 2's explicit objectives at all. `resolveMultiEventObjectives`
unions a contributor's objectives into the authority's own by `ObjectiveKey`: on a
collision the authority's title/qualification/targetStimulus/id win, and only the
required amount grows, via `max()` -- two similar B-events never demand double one
B-event's work by summing. A contributor's `threshold_quality` objective landing inside
the authority's taper window is dropped, not silently reweighted, with an athlete-facing
reason recorded (`DroppedContributorObjective.message`).

Only the taper authority ever sets `volumeScale`/`intensityScale` -- contributors supply
objectives only. Wired into `planner.ts`'s `prepareWeekAheadPlanSeed`, reaching the live
week-ahead pipeline for any athlete with more than one active dated event; a no-op
otherwise (`simulate:diff` confirms zero semantic change against the committed baseline).
The plan-derived path (`PlanDefinition`) is not wired to contributors in this increment.

---

## Candidate ranking (`optimizer.ts`)

Phase 3 introduced a single, unified ranking path (`rankCandidates`) driven by shared context (`buildOptimizationContext`). Candidates are evaluated via strict **Lexicographic Ordering**:

1. **Hard Eligibility Gates** (Level 1–3): Time budget, required equipment, injury constraints, safety envelopes, phase eligibility, planned-intensity admissibility, and dated role-aware recovery constraints (`QUALITY_SPACING_VIOLATION`, `HARD_LOWER_BODY_SPACING_VIOLATION`, `ROLLING_HARD_CAP_EXCEEDED`, `ANCHOR_PROTECTION_VIOLATION`). Filtered candidates carry explicit `excludedReasons`.
2. **Objective Benefit** (Level 4): Scores a template's stimulus profile against currently unresolved weekly objectives (`calculateStimulusBenefit`). Higher objective satisfaction strictly outranks non-objective candidates regardless of preference multipliers. Weekly-anchor timing and missing supported triathlon-modality coverage are also Level-4 architecture signals.
3. **Utility Score** (Level 5 & 6): `utility = (benefit / (1 + fatigueCost)) × preferenceMultiplier`. Used to sort candidates of comparable objective benefit (within `0.05` benefit score).

Strength-maintenance benefit takes the stronger of `maxStrength` and `hypertrophy` target/evidence rather than allowing field order to choose which axis counts.

### The planner/workout-library boundary (Phase 5.2, `planningCandidate.ts`)

Detailed `WorkoutDefinition`s (the prescription catalog) already carry recovery hours,
mechanical/eccentric load, technical environment, contraindications, and per-workout
minimum spacing after hard lower-body work -- but the planner selects a coarse
`SessionTemplate` first, so that richer data used to arrive only *after* the decision it
should have informed. Concretely: `evaluateRecoveryConstraints`'s hard-lower-body spacing
gate was a flat 2-day rule with no per-workout data behind it at all.

`PlanningCandidate` (`derivePlanningCandidate`, `PLANNING_CANDIDATE_INDEX`) resolves each
catalog workout against its linked engine template -- enough semantics to sequence a
week, without dragging blocks/variants/parameters into the planner; prescription
generation (`resolveWorkoutPrescription`) stays downstream and unchanged. Wired into
`OptimizationOptions.resolveMinimumDaysAfterHardLowerBody` (optional, defaults to the
identical flat rule so every caller that doesn't pass it is unaffected): a workout's own
`eligibility.minimumDaysAfterHardLowerBody` can now tighten *or* correctly loosen that
gate per workout instead of one generic number for every lower-body session.

Lives in `engine/`, not `workouts/models.ts` as a first read of the type might suggest --
`engine/models.ts` already imports from `workouts/models.ts`, so a type referencing
`SessionRole`/`Modality`/`WorkoutStimulusProfile`/`TrainingEnvironment` inside
`workouts/models.ts` would make that dependency circular.

---

## Authority ordering

The engine's real hierarchy. This is *authority precedence* (what wins when two rules
conflict), which happens to also match the actual filter/sort sequence
`evaluateTrainingWithIntent` runs today: the candidate list is narrowed by every step down
through phase eligibility *before* `rankCandidates` ever runs, and dated recovery
constraints are themselves evaluated as `rankCandidates`' own first (hard-filter) pass,
ahead of objective benefit and utility:

```text
clinical / safety gates     hard exclusion — never overridable
        ↓
feasibility                 time, equipment, environment, guardrails
        ↓
readiness mode ceiling      train / modify / recover cost caps
        ↓
phase eligibility           event-relative template gating (Path B only)
        ↓
planned intensity gate      hard-class candidates require adequate plan intensity
        ↓
dated recovery constraints  quality spacing, rolling hard caps, anchor protection
        ↓
lexicographic priority      objective/timing benefit outranks preference
        ↓
utility score & cost        dimensional interference & preference multipliers
```

Preferences rank; they never unlock. An avoided modality is a hard exclude on Path A and a
0.2× soft penalty on Path B — a deliberate distinction, since taste must never behave like
a safety constraint ([ADR-0007](../adr/0007-adaptive-multisport-engine-architecture.md) §6).

### Injury gate sub-ordering (Phase 5.4)

Within the "clinical / safety gates" step above, `injuryPolicy.ts` itself has a total
order that a single `soreness: 1-10` scalar can't express, because it can't distinguish a
knee from an Achilles from general DOMS:

```text
InjuryConstraint (hard, persisted)   TrainingSettings.injuries -- exclude/limit never weakened
        ↓
observed tissue response (may tighten)   today's per-region check-in (DailyCheckin.tsx)
        ↓
wearable-derived readiness (may tighten) HRV/RHR/body battery -- acts through the separate
                                          fatigue/mode pipeline, not this gate at all
```

`resolveEffectiveInjuryConstraints` (called from `adapters.ts`
`mapContextFromGoalsAndTrainingSettings`) implements the first two steps: it merges a
day's `RegionTissueResponse[]` into the standing `InjuryConstraint[]`, but only ever
raises a region's severity for that one read, never lowers it, and never persists the
result back to `TrainingSettings`. Wearable-derived readiness has no parameter into that
function at all — a structural guarantee, not just tested behavior, that a good HRV
reading can't loosen what tissue response or the injury constraint decided.

---

## Completed load and fatigue (`completedTraining.ts`, `fatigue.ts`)

Completed-session cost starts from the existing six-dimensional cost vector. When a
comparable planned/catalog duration exists, abbreviated work scales the vector down; a
recorded session longer than the intended reference is capped at a fully delivered `1.0`
duration scale rather than manufacturing unbounded fatigue. An independently measured
completion ratio can scale it further.

External replay retains an unsaturated `rawExternalLoadFatigue` state so accumulated load
is not lost at the ranking clamp. Ranking sees the clamped projection. External and internal
fatigue are currently fused with `max()`. ADR-0014's harness comparison found the tested
capped-addition candidate worse; that is why `max()` is retained. It is **not** declared
safe or calibrated, and the aggregate scenario recovery-share gate remains release authority.

`computeInternalResponseStrain` in `fatigue.ts` also evaluates unlogged ambulatory load: when
an acute ambient step surge occurs on $D-1$ ($\ge 1.8\times$ 7d baseline and $\ge +6,000$ excess steps
after deducting estimated steps from logged running/field/walking sessions via `estimateActivitySteps`),
it introduces a proportional tissue-strain contribution into the `impactTissue` and `lowerBody`
fatigue dimensions to prevent high-impact lower-body prescriptions following unlogged heavy hiking/walking
days without double-counting structured activities or requiring athlete subjective soreness input.

---

## Multi-day projection

`planner.ts` chains the same pipeline forward with three confidence tiers — `confirmed`
(today), `provisional` (tomorrow's readiness-branch preview), `projected` (day 2+) — and
a hard fatigue-tier ceiling, because `benefit / (1 + cost)` is asymptotic and would
otherwise never actually select rest. Nothing beyond today is persisted. See
[ADR-0008](../adr/0008-week-ahead-planning.md).

Forecast recommendations never mutate completed credit. They accumulate in
`WeeklyObjective.projectedCredit`; forecast unresolved state uses
`completedCredit + projectedCredit`, while live unresolved state ignores projected credit.
The planner's `objectiveCredits` display is derived from the same V2 objective-credit
function used by the live ledger, not the old `stimulusCoverage >= 0.6` model.

### Required weekly-role reservations (ADR-0018)

Weekly anchors remain preferences. `weeklyAllocation.ts` adds a separate, exact-identity
ledger for still-unfulfilled authored *minimum* roles, and allocates them before the greedy
loop can spend their only safe date on supporting work.

**One hard-gate path.** `planner.ts` exports `evaluateProjectedDate`, the single seam that
resolves availability, phase eligibility, environment, the projected fatigue tier, planned
dose, injury and spacing for one forecast date. The greedy day loop and the allocator both
call it, so the allocator is not a second rules engine: it never re-implements
`PROJECTED_FATIGUE_*` filtering or `rankCandidates` acceptance.

**Bounded stateful search.** `resolveWeeklyRoleReservations` is a deterministic
backtracking search over required role occurrences only. It enumerates exact eligible
date/template candidates from the least-loaded (root) state, then re-proves every tentative
assignment against the *actual* projected fatigue/history transition of the assignments
accumulated so far -- so two dates that are individually feasible but conflict after the
first pick cannot both be reserved. Its one `WeeklyAllocationSearchBudget` is seven dates,
14 occurrences, four canonically ordered candidates per occurrence and 1,024
state-transition nodes. Reaching a cap returns the best-known jointly feasible partial
allocation and marks the remainder `unresolved_search_budget` -- never a safety miss.
Wall-clock time is not a semantic cut-off; p95 ≤50 ms / p99 ≤100 ms on the live-sized
fixture is an operational gate only.

**Protection during greedy selection.** Reservations are recomputed after every selected
forecast day. On a reserved date the planner ranks only candidates that fulfil that
occurrence; if the dynamic state has made them unsafe, safety wins and the role relocates
or is reported. On an unreserved date a discretionary supporting candidate -- and a
discretionary Rest, which consumes the date just as surely -- is admitted only while the
incumbent allocation still survives its projected cost. A true recover-tier selection is
exempt: Rest-first outranks role fulfilment and the loss is attributed to recovery.

Outcomes are typed (`reserved`, `fulfilled`, `missed`, `unresolved_search_budget`) with
`wasMoved` as an annotation rather than a status, and are surfaced unchanged through
`WeekAheadPlan.allocationReport` to the simulator report and the week-ahead UI. They are
forecast evidence: never completed training, and never a substitute for the persisted
recommendation audit. `recovery_or_rest` stays on the coverage ledger but does not reserve
a training date. The production planner remains greedy; the Phase 5.1 beam-search prototype
is not part of this path.

### Fixed activities (Phase 5.3, projected exposures since Phase 6.2b)

`FixedActivity` (external commitments -- a booked class, a match, travel) is persisted at
`users/{userId}/fixed_activities/{activityId}` via `fixedActivityService.ts`, the same
user-owned/validated-at-the-rule pattern as `goals` (ADR-0002). `Home.tsx` reads the
current week's activities for the week-ahead strip (`WeekAheadOptions.fixedActivities`)
and, separately, today's/tomorrow's activities for the live/next-day decision
(`evaluateTrainingWithIntent`/`evaluateNextDayPlanWithIntent`) -- a booked or travel
commitment on today or tomorrow affects the actual pick, not only the forecast strip. An
`availabilityOverride` on an activity caps that day's whole training budget (e.g. a travel
day) before the activity's own `durationMin` is deducted; several overrides on the same
day take the most restrictive. `fixed` (movable vs immovable) is captured but not yet
consumed -- it becomes load-bearing once sequence search (5.1/5.2) can reason about
shifting a movable placeholder.

**An activity's own `environment`/`equipment` describe only that activity, never the whole
day (D6-B).** A football match at an outdoor field does not imply a separate same-day
session must also be outdoor or football-equipped. A true day-wide restriction (a travel
day where every session that day really is stuck at a hotel gym) is a separate, explicit
`availabilityContextOverride: { environment?, equipment? }` field, validated independently
in `validation.ts`/`firestore.rules` and consumed by `resolveAvailability` (intersecting
owned equipment, restricting environment) and, in the planner loop and the live path
alike, by filtering candidates whose own `environment` conflicts with it.

**Booked activities are projected exposures, not just calendar blockers (Phase 6.2b).**
`resolveAvailability` returns a dimensional `reservedCapacityCostProfile`, summed only from
activities' explicitly authored `expectedCost` -- a missing value contributes zero, never
an invented default (D6-C). Same-day ranking sees this reservation (additively fused onto
projected fatigue via `applyCompletedSessionLoad`, not `max()`, so it cannot be masked by
already-elevated fatigue) without marking the load as already completed. An activity's
`expectedStimulus`, if present, is credited against unresolved objectives through the same
canonical credit primitive as a structured exposure (`deriveObjectiveCreditFromProfile`)
*before* that day's own candidate is ranked -- crediting it afterward would let the
optimizer separately prescribe redundant work for an objective the booked activity already
covers. At the end of the day, the activity's cost becomes real (not merely reserved) load
for the following day's fatigue projection. Completed activities are excluded from all of
this so their load is never projected a second time. See
[docs/plans/phase-6-evidence-and-operational-assurance.md](../plans/phase-6-evidence-and-operational-assurance.md)
6.2b for the full change description, decisions D6-B/D6-C/D6-D, and test list; see
[docs/plans/phase-5-sequence-planning.md](../plans/phase-5-sequence-planning.md) 5.3 for
the original storage/validation contract.

### Bounded sequence search prototype (Phase 5.1, `sequenceSearch.ts`) -- not live

The "projected" tier above is a greedy walk: each day takes `rankCandidates`' rank-0 pick
with no visibility into how that choice constrains later days. `sequenceSearch.ts`'s
`beamSearchWeekAheadPlan` is a bounded beam-search prototype (width 15, 5 candidates/day
by default) that scores whole partial sequences instead, reusing `rankCandidates`'
existing hard-gate-before-scoring separation rather than reimplementing it. Benchmarked
against greedy on the Phase 0 invariants and semantic scenario harness
(`npm run compare:sequence-search`): zero new hard-constraint or golden-week violations,
and strictly better weekly-objective resolution in several scenarios, at a real ~5.7x
compute cost and a materially lower rest-day frequency the harness can't judge as better
or worse on its own. **Adoption is deferred, not rejected** -- see
[ADR-0015](../adr/0015-sequence-planning-and-session-role-model.md) for the full
comparison data and reasoning. Greedy (`generateWeekAheadPlan`) remains the live default;
`sequenceSearch.ts` is not imported by any production code path.

---

## Verification & audit tooling

### Coverage visibility (`test:coverage` / `pytest --cov`)

`cd app && npm run test:coverage` emits terminal, JSON, and HTML V8 coverage reports to
`app/artifacts/coverage/frontend/`. `uv run pytest --cov=garmin_sync --cov-report=term-missing
--cov-report=xml:artifacts/coverage/python/coverage.xml` emits backend terminal and XML
coverage reports. CI uploads both directories as review artifacts without a global coverage
threshold; engine behavior contracts remain the decision-quality gate.

### Multi-week scenario simulation (`simulate:scenarios`)
Executed via `cd app && npm run simulate:scenarios`. Runs synthetic athlete scenarios across multi-week spans to audit engine periodization, fractional objective fulfillment, fatigue decay curves, anchor placements, modality coverage, and constraint safety. Outputs `report.json` and `report.md` to `app/artifacts/simulation-reports/latest/`.

### Calibration evidence (`simulate:calibrate`)

Executed via `cd app && npm run simulate:calibrate`. It reruns the same bounded synthetic
corpus and writes compact per-day decision traces plus per-scenario and aggregate trigger
frequencies to `app/artifacts/calibration-reports/latest/`. Traces retain canonical template
and objective identifiers, derived fatigue/cost/stimulus vectors, gate codes, and optimizer
scores; they intentionally exclude raw Garmin payloads, free-text check-ins, and Firebase
exports. This is policy-regression evidence, not clinical calibration, and the report makes
no automatic threshold recommendation.

### Fatigue-fusion comparison (`simulate:fatigue-fusion`)

Executed via `cd app && npm run simulate:fatigue-fusion`. It runs the real planner and
hard gates under production `max` and simulation-only bounded-additive fusion, then compares
fatigue trajectories, selections, recovery, objective misses, constraint violations, and
runtime. The selector is unavailable to live callers; the current evidence retains `max`
because additive increases recovery and objective misses without a safety benefit.

### Recommendation decision replay (`replay:recommendation`)
Executed via `cd app && npm run replay:recommendation -- <audit.json>`. Accepts a JSON snapshot of a historical recommendation and passes it into `replayRecommendationAudit()` ([`app/src/engine/replay.ts`](../../app/src/engine/replay.ts)). The current policy version can be verified for reproducibility. Known historical policy versions remain auditable but are explicitly rejected as executable replay unless that historical decision function is bundled in a future build.

An external decision (ADR-0019) ranked nothing, so the highest-utility check does not apply
to it. Instead it is verified against the plan revision its audit names: pass the stored
revision as a second argument (`-- <audit.json> <revision.json>`) and the script recomputes
its SHA-256 through `externalPlanHash.ts`. Without the revision the decision is reported as
**not reproducible** rather than quietly passing, and a revision whose content has changed
under the same revision number fails with an explicit hash-mismatch reason (D-IMMUT).

### Sequence-search comparison (`compare:sequence-search`)
Executed via `cd app && npm run compare:sequence-search`. Runs every scenario through both the production greedy planner and the Phase 5.1 beam-search prototype ([`app/src/engine/sequenceSearch.ts`](../../app/src/engine/sequenceSearch.ts)) using the identical `runScenario` harness, and reports the comparison (rest-day share, constraint violations, golden-week invariants, per-scenario deltas, timing). Outputs `comparison.json` to `app/artifacts/sequence-search-comparison/` (gitignored, regenerable). See [ADR-0015](../adr/0015-sequence-planning-and-session-role-model.md).

---

## Related decisions

| ADR | Covers |
|---|---|
| [0006](../adr/0006-reconciled-strain-telemetry.md) | Acute vs multi-day-drift strain decomposition; completed-load replay amendment |
| [0007](../adr/0007-adaptive-multisport-engine-architecture.md) | Six-tier engine, dual profiles, safety vs preference authority |
| [0008](../adr/0008-week-ahead-planning.md) | Rolling 7-day projection and confidence tiers |
| [0009](../adr/0009-training-intent-history.md) | History-seeded intent; the `TrainingHistoryProvider` boundary |
| [0010](../adr/0010-decision-provenance-and-audit-replay.md) | `DataState`, audit records, replay, `POLICY_VERSION` |
| [0011](../adr/0011-weekly-architecture-anchors.md) | Weekly anchors and ranking modifiers |
| [0012](../adr/0012-plan-intent-authority.md) | Explicit plan authority and plan-side intent ownership |
| [0014](../adr/0014-objective-credit-v2-and-honest-load.md) | Fractional credit V2, honest load, projected credit and fusion evidence |
| [0017](../adr/0017-training-intent-profile-and-planning-modes.md) | `planningMode.ts` as the sole planning-mode authority |
| [0019](../adr/0019-externally-authored-plans-and-session-adjudication.md) | Externally-authored plans, session adjudication, placement, critique and replay |

Known divergences between these decisions and the code are tracked in
[the 2026-08-08 review](../analysis/2026-08-08-architecture-review.md); remediation is
sequenced in [`docs/plans/`](../plans/).
