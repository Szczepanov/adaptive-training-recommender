# Phase 7B — Training intent, capacity, and first-class planning modes

* **Status:** `Draft`
* **Blocked by:** ADR-0017 acceptance; any semantic-baseline review follows Phase 7A's
  allocation acceptance criteria.
* **Unlocks:** evergreen (non-event) athletes as a supported population; a reachable
  coverage ledger outside cycling events; capacity-sized weekly targets
* **Decisions:** [ADR-0017](../adr/0017-training-intent-profile-and-planning-modes.md)
  (D-MODE, D-DOSE, D-CAP, D-COVSET, D-OWNERSHIP, D-ORG, D-TAPERSCOPE, D-INTENTNAME)
* **Source analysis:** [2026-08-10 training-intent and periodization architecture analysis](../analysis/2026-08-10-training-intent-periodization-architecture.md)

> **Scope separation (2026-08-10):** the PR #17 semantic-baseline follow-up identified
> an immediate weekly-allocation defect in the existing event-directed cycling path. That
> work is [Phase 7A](./phase-7-weekly-allocation-and-role-reservations.md), governed by
> ADR-0018. This proposal remains the separate, future evergreen/capacity initiative; it
> must not be used to change or bless the PR #17 semantic baseline.

## Goal

Make continuous (evergreen) training a first-class planning mode that derives an
evidence-backed adaptation dose, then packs it into the athlete's real capacity and stated
preferences, instead of a fabricated demand vector — without changing any behaviour for
the event-directed athlete that Phases 2–6 calibrated.

---

## Preconditions

1. ADR-0017 accepted. Work items 7.1–7.4 encode its decisions and should not start while
   D-MODE or D-COVSET are still open.
2. `cd app && npm run check` green against merged `main` commit `34ddc30` (the immutable
   Phase 7 baseline); later policy-drift checks use that same base sha.
3. A `simulate:diff` baseline exists. **7.8 must not bless a new baseline before
   Phase 7A's allocation criteria pass** — it owns the existing event-directed semantic
   blocker, and folding it into an evergreen diff would make both unreadable.

---

## Current behaviour (verified 2026-08-10 against merged `main` at `34ddc30`)

Each of these is the concrete reason for a work item below. Symbols, not line numbers.

| # | Finding | Evidence |
|---|---|---|
| **G1** | An eventless athlete is planned as if a generic event existed. `evaluatePeriodizationPhase` returns `basePhase` + `DEFAULT_BASE_DEMAND`; `generateWeeklyObjectives` passes that vector straight to `objectivesFromDemand`, yielding `zone2_aerobic` (2 exposures, since `aerobicEndurance 0.8 ≥ 0.7`), `threshold_quality` (`thresholdPower 0.5 ≥ 0.5`), `strength_maintenance` — **4 required exposures/week for everyone** | `periodization.ts`, `microcycle.ts` |
| **G2** | No weekly session capacity exists anywhere in the persisted model. `TrainingSettings.defaults.weekdayMaxMinutes` and `UserPreferences.defaultWeekdayTimeMin` bound one session, not a week | `models.ts` |
| **G3** | The coverage ledger is unreachable for every non-cycling athlete. `resolvePlanDefinitionForEvent` returns `null` unless `category === 'cycling_event'`; `buildCoverageState(null, …)` returns `{ phase: null, requirements: [] }`; `coverageKeysForExposure` returns `[]` when `phase` is null, so `coverageNeedTierForTemplate` is a constant `3` and the Level-4 planning signal is inert | `planSchedule.ts`, `coverage.ts` |
| **G4** | A goal without both `targetDate` and `eventCategory` is inert. `goalToUserEvent` returns `null`, so `domain: 'strength'` or `'general_fitness'` influences no decision | `periodization.ts`, `goalService.ts` |
| **G5** | There is no athlete-declared **hard** modality exclusion. `avoidedModalities` / `deprioritizedModalities` are ranking penalties in `rankCandidates`; only injury/constraint-derived `restrictedModalities` exclude outright | `models.ts`, `optimizer.ts`, `rules.ts` |
| **G6** | `ObjectiveKey` has `strength_maintenance` but no strength **development** key, while `WorkoutStimulusProfile` already carries `maxStrength` and `hypertrophy`. An evergreen strength priority has no objective to express | `models.ts` |
| **G7** | Taper is reachable from a star rating. `deriveEventPriority(5) → 'A'`; `resolveEventTaper`'s legacy fallback then gives any `A` event a 14-day taper, including `general_target` | `periodization.ts`, `taperPolicy.ts` |
| **G8** | `TrainingIntent` (engine, per-day resolved state) will collide by name with the new persisted profile | `trainingIntent.ts` |
| **G9** | `validateEventPlanCoverage` requires every one of `build/travel/peak/taper/race/recovery` to declare coverage, and hardcodes `requiredCoverageKeys` including `race_day`. An evergreen set cannot pass it | `event-plan.ts` |
| **G10** | Coverage workout mappings are cycling-only. `aerobic_volume` maps solely to `cycling_zone2_standard_01`; the running easy templates `end_easy_02` / `end_easy_03` fall back to `running_walk_run_01` (a walk–run), so a runner has no true easy-run coverage workout | `event-plan.ts`, `prescription.ts` `FALLBACK_TEMPLATE_TO_WORKOUT` |

G1–G3 are the structural ones. G4–G10 are each small and independently landable.

---

## Work items

### 7.1 `[ ]` Persist `TrainingIntentProfile`

**Current:** no persisted record of planning mode, priorities, or weekly capacity (G2).

**Change:** add to `engine/models.ts`, mirroring `AuthoredPlanBlock`'s shape conventions:

```ts
export type PlanningMode = 'evergreen' | 'event_directed';
export type TrainingPriority =
  | 'health' | 'balanced_performance' | 'endurance'
  | 'strength_muscle' | 'speed_power' | 'sport_readiness';

export interface TrainingIntentProfile {
  userId: string;
  planningMode: PlanningMode;
  /** Ordered, highest first. Empty is valid and resolves to 'balanced_performance'. */
  priorities: TrainingPriority[];
  weeklyCommitment: {
    minSessions: number;      // 1..14
    targetSessions: number;   // >= minSessions, <= maxSessions
    maxSessions: number;      // <= 14
  };
  /** D-ORG: only executable organisation is valid in this phase. */
  organizationPreference: 'auto';
  schemaVersion: number;
  createdAt: string;
  updatedAt: string;
}
```

Add the doc comment required by **D-INTENTNAME** on both this type and
`trainingIntent.ts`'s `TrainingIntent`, each naming the other.

Then, following the `plan_blocks` precedent end to end:

* `engine/validation.ts` — `validateTrainingIntentProfile`, alongside
  `validateAuthoredPlanBlock`. Enforce `minSessions <= targetSessions <= maxSessions`,
  finite integer bounds `1..14` for all three session counts, `organizationPreference ===
  'auto'`, the two-value `planningMode` enum, priorities free of duplicates, and the exact
  declared profile field set. Session-duration, modality, recovery, and conservative-bias
  validation remain exclusively in `validateUserPreferences`; its newly written duration
  values must be finite positive integers, never zero.
* `services/trainingIntentProfileService.ts` — copy `planBlockService.ts`'s
  `DataState` read / validate-before-write structure at
  `users/{userId}/training_intent/profile` (a fixed doc id, like
  `preferences/profile`, not a collection). The write contract repeats the finite-integer
  session-count check before persistence.
* `app/firestore.rules` — a `hasValidTrainingIntentProfile(userId)` helper plus the
  `match /users/{userId}/training_intent/profile` block, modelled on
  `plan_blocks`: `keepsOwnership`, immutable `createdAt`, integer session-count and
  scalar bounds the rules language can actually express, `planningMode in
  ['evergreen', 'event_directed']`, `organizationPreference == 'auto'`, and an exact
  allowlist of profile keys. The existing preferences rule is extended separately for
  positive duration and hard-unavailable modalities. Direct Firestore writes must not be
  able to bypass the service validator.
* `engine/composer.ts` — add the profile to the `Promise.allSettled` batch and to
  `DailyDecisionInput` + `sourceStates`. `preferredRecoveryStyle` stays exclusively on
  `UserPreferences`: the composer continues to load it from `preferences/profile` and
  never reads, merges, serializes, or persists it through `TrainingIntentProfile`.
  **Absent profile is not an error**: it follows 7.2's legacy-compatible mode resolution.
  On read, ignore any legacy execution-preference fields embedded in a profile and emit the
  ADR-0017 diagnostic; recover an otherwise valid legacy unsupported organisation to
  `'auto'` with a diagnostic; quarantine any other invalid profile as `DataState.INVALID`
  and use the no-profile compatibility path. Neither read path writes data back.

**Done when:** a profile round-trips through the service; `npm run test:rules` covers
owner-read, cross-user-denied, fractional/invalid-range-denied, and
`createdAt`-mutation-denied, plus unsupported planning mode/organisation and extraneous
profile field denied writes; the composer returns a `DailyDecisionInput` with the profile
present and with it absent, while all execution preferences always come from
`UserPreferences`.

---

### 7.2 `[ ]` Resolve the effective planning mode

**Current:** mode is not a concept; eventlessness is expressed as `focusEvent === null`
scattered across `trainingIntent.ts`, `optimizer.ts`, `planner.ts` and `rules.ts` (G1).

**Change:** add `engine/planningMode.ts`:

```ts
export interface PlanningContext {
  mode: PlanningMode;              // effective, per date
  profile: TrainingIntentProfile;  // resolved, defaults applied
  focusEvent: UserEvent | null;    // null whenever mode === 'evergreen'
  eventStrategy: 'structured_plan' | 'demand_derived' | null;
}
export function resolvePlanningContext(
  profile: TrainingIntentProfile | null,
  periodization: PeriodizationResult,
  date: string,
): PlanningContext;
```

Per **D-MODE**: `event_directed` applies when an event-directed profile and an eligible
`periodization.focusEvent` are both present, irrespective of category. `eventStrategy` is
`'structured_plan'` only when the existing plan resolver returns a `PlanDefinition`
(currently cycling); every other focus event is `'demand_derived'`, retaining the current
running/triathlon/strength/general event path. An event-directed profile whose event is
passed, cancelled, or absent resolves to `evergreen` — no fake event, no residual taper.
A missing profile is the compatibility case: any eligible focus event resolves to
event-directed; only profile-less no-event cases receive the evergreen default.

`resolveTrainingIntent` gains the profile as a parameter and carries the resolved
`PlanningContext` on its returned `TrainingIntent`, so `rules.ts`, `planner.ts` and
`sequenceSearch.ts` read one resolved value instead of re-deriving from `focusEvent`.

**Done when:** `planningMode.test.ts` covers explicit evergreen/event-directed × eligible
event/no-event combinations; `structured_plan` for cycling and `demand_derived` for
running, triathlon, strength, and general events; passed/cancelled fallbacks; and
profile-less compatibility for every existing event-directed scenario. No call site
outside `planningMode.ts` newly branches on `focusEvent === null` for mode purposes.

---

### 7.3 `[ ]` Resolve dose first, then capacity and weekly packing

**Current:** `DEFAULT_BASE_DEMAND` is the eventless strategy input, sized by nothing
(G1, G2). `UserPreferences` has per-day duration defaults, but no proposed strategy API
consumes them; the old proposed `targetSessions + first priority -> allocation table`
pipeline would therefore make a cited packing heuristic the source of prescription.

**Change:** add pure `engine/evergreenStrategy.ts` and `engine/trainingCapacity.ts` modules
with no I/O. They are versioned policy resolution, not a second rules engine.

#### 7.3a Resolve evidence-backed adaptation/dose requirements

```ts
export interface EvidenceProvenance {
  sourceId: string; population: string; outcome: string;
  confidence: 'high' | 'medium' | 'low';
  applicability: string[];
  authority: 'guideline_floor' | 'outcome_supported_default'
    | 'conditional_prior' | 'product_heuristic';
  policyVersion: string; reviewedOn: string;
}
export interface AdaptationDoseRequirement {
  adaptation: AdaptationKey; minimum: DoseTarget | null; target: DoseRange;
  priority: 'required' | 'target' | 'optional';
  substitutionPolicy: SubstitutionPolicy; evidence: EvidenceProvenance;
}
export interface EvidenceBackedStrategy {
  requirements: AdaptationDoseRequirement[];
  hardSessionCap?: number; warnings: PolicyWarning[];
}
export function resolveEvidenceBackedStrategy(
  goalOrEvent: GoalOrEventContext,
  athleteState: AthleteTrainingState,
): EvidenceBackedStrategy;
```

`AthleteTrainingState` is inferred from bounded completed-history/Garmin data: recent
weekly duration and frequency, strength/aerobic/quality exposure, consistency and
training-age proxy, tolerated load/progression trend, and sport-specific history. An
explicit conservative `unknown` fallback is required. Readiness modifies daily execution
only after this strategy exists. Every rule carries the per-requirement provenance contract
from ADR-0017 D-DOSE; coverage descriptors themselves are not blanket “evidence-backed”.

#### 7.3b Resolve capacity from the two existing owners

```ts
export interface ResolvedTrainingCapacity {
  minSessions: number; targetSessions: number; maxSessions: number;
  weekdayMinutes: number | null; weekendMinutes: number | null;
  usableWindows: ResolvedAvailabilityWindow[];
  estimatedTargetWeeklyMinutes: number;
}
export function resolveTrainingCapacity(
  commitment: TrainingIntentProfile['weeklyCommitment'],
  preferences: UserPreferences,
  availability: readonly AvailabilityWindow[],
): ResolvedTrainingCapacity;
```

This is consumption, not duplicated ownership: profile supplies session cardinality;
`UserPreferences` supplies duration; schedule/fixed activities supply usable windows. New
preference writes reject zero or non-finite duration. At read time, only a known,
versioned legacy default may fill a missing duration; otherwise the affected day type is
`time_capacity_unavailable`, has no usable window, and cannot receive a required session.
`estimatedTargetWeeklyMinutes` sums only usable date windows. No zero-minute session is
created or persisted.

#### 7.3c Pack strategy into exact session roles

```ts
export interface WeeklyBudget {
  capacity: ResolvedTrainingCapacity;
  requirements: AdaptationDoseRequirement[];
  requiredRoles: PackedRoleOccurrence[];
  targetRoles: PackedRoleOccurrence[];
  optionalRoles: PackedRoleOccurrence[];
  shortfalls: PolicyWarning[];
}
export function packWeeklyDose(
  strategy: EvidenceBackedStrategy,
  capacity: ResolvedTrainingCapacity,
  coverage: CoverageSetDescriptor,
): WeeklyBudget;
```

Packing maps independently-derived dose to exact eligible workout/template identities and
only then to roles. Required roles must fit within `minSessions` and usable minutes/windows;
required plus target roles within `targetSessions`; optional work alone may use capacity to
`maxSessions`. A session can fan out to adaptation credit, but may bundle programming roles
only where one authored `PlanSessionCoverage` identity grants every key. Otherwise distinct
strength/endurance requirements stay distinct. If an evidence/goal minimum cannot fit,
emit `minimum_dose_shortfall` and retain the safest, highest-value feasible subset.

The old 2-to-6 session table remains in one exported, commented table, but only as a
low-confidence packing fallback/tie-breaker between otherwise valid packings. It cannot
derive a physiological minimum or conceal a dose/capacity shortfall. Preference chooses
among the requirement's permitted substitutions; a sport-specific unavailable modality
emits `goal_constraint_conflict` rather than fictitious equivalent credit.

`generateWeeklyObjectives` (`microcycle.ts`) gains an evergreen branch **before** the
`objectivesFromDemand` call, selected by `PlanningContext.mode`, and consumes the packed
budget rather than raw profile counts. The existing plan-derived and demand-derived
branches are untouched. `objectivesFromDemand` keeps `DEFAULT_BASE_DEMAND` only for a real
event more than 84 days out (`evaluatePeriodizationPhase`'s existing `blendDemand`); it is
never an eventless input.

**Done when:** a short/long duration athlete with identical session counts produces
different feasibility/shortfall results; `AthleteTrainingState.unknown` is conservative and
history-derived state can alter a conditional prior; every scientific rule has complete
provenance; the 2-to-6 table breaks only packing ties; required/target/optional roles obey
the cardinality and exact-identity invariants; and mutating `DEFAULT_BASE_DEMAND` changes
nothing for an eventless athlete.

---

### 7.4 `[ ]` Generalize the plan-coverage vocabulary, then build its registry

**Current:** `coverage.ts` imports `SEPTEMBER_CYCLING_EVENT_SESSION_COVERAGE` at module
scope and builds `COVERAGE_BY_KEY` from it; `planSchedule.ts` passes the same constant to
`buildPlanDefinition` (G3, G9). The public type names (`EventPlanPhase`,
`EventPlanCoverageKey`, `EventPlanSessionCoverage`) also incorrectly make a non-event plan
look like an event-shaped exception.

**Change:** in `workouts/event-plan.ts`:

```ts
export type PlanPhase = /* existing phases plus 'general' */;
export type PlanCoverageKey = /* generic coverage vocabulary */;
export interface PlanSessionCoverage { /* exact workout/template mapping */ }
export interface CoverageSetDescriptor {
  id: 'september_cycling_event' | 'evergreen_general';
  coverage: PlanSessionCoverage[];
  requiredKeys: PlanCoverageKey[];
  phases: PlanPhase[];                // which phases this set must cover
}
export const COVERAGE_SETS: Record<CoverageSetDescriptor['id'], CoverageSetDescriptor>;
```

Introduce the generic types as the authority, migrate imports, then retain deprecated
`EventPlan*` aliases only for a bounded compatibility transition. `validatePlanCoverage`
takes a descriptor instead of reading module-level
`requiredCoverageKeys` / the fixed six-phase loop, so an evergreen set with no `race` or
`taper` phase validates on its own terms. `phaseRestrictedCoverage` stays as-is for the
September set — it encodes real ADR-0016 semantics.

`coverage.ts` resolves its `COVERAGE_BY_KEY` map from the descriptor carried on
`CoverageState`, not from a module constant. `buildCoverageState` gains the descriptor as a
parameter.

**The September set's entries do not change.** Its calibration is frozen by ADR-0016 and
the [macrocycle v5 contract](../macrocycle-v5.md); a byte diff on
`SEPTEMBER_CYCLING_EVENT_SESSION_COVERAGE` is a review-stopper for this item.

**Done when:** `npm run check`'s workout-catalog step validates both sets; every existing
`coverage.test.ts` / `coverageOccurrence.test.ts` / `specificityCoverageContract.test.ts`
assertion passes unmodified except for the added descriptor argument.

---

### 7.5 `[ ]` An evergreen coverage set and a plan definition to carry it

**Current:** coverage only exists for a cycling event (G3, G10).

**Change:**

* Add `EVERGREEN_SESSION_COVERAGE` under a new `PlanPhase` member `'general'`
  (`evergreen` has no build/peak/taper arc — reusing `build` would make ADR-0016's
  phase vocabulary lie). Keys: `aerobic_volume`, `sustained_quality`, `primary_strength`,
  `compact_strength`, `recovery_or_rest`, `upper_body_trunk`, `walk_run`.
* Map each key to **modality-diverse** `workoutIds`. This is where G10 bites: today
  `aerobic_volume` accepts only `cycling_zone2_standard_01`, and a runner's easy work
  resolves to `running_walk_run_01`. Either extend the mapping to accept the running easy
  workouts, or add a true easy continuous-run workout to `workouts/catalog/`. **Prefer
  adding the workout** — crediting a walk–run as full aerobic volume would repeat exactly
  the substitution error ADR-0016 was written to stop.
* Add `buildEvergreenPlanDefinition(strategy, capacity, packedBudget, asOfDate)` to
  `planSchedule.ts`: one rolling 7-day `general` block, dose/objectives from the packed
  strategy, and coverage minimum/target sessions from its required/target roles. It must
  not derive a dose from raw session counts.
* `resolvePlanDefinitionForEvent` remains the structured-plan capability resolver.
  `resolvePlanDefinition(planningContext, authoredBlocks)` returns the cycling plan only
  for `eventStrategy: 'structured_plan'`, returns the evergreen plan only for effective
  evergreen mode, and returns `null` for `eventStrategy: 'demand_derived'` so the existing
  demand-derived event path remains authoritative. Move authored travel overlays and fixed
  activities into a shared `applyPlanningOverlays` step that runs **before** plan-specific
  construction/ranking for structured, demand-derived-null, and evergreen paths. It takes
  the resolved `PlanningContext`, date, authored blocks, and fixed activities, returns the
  same constrained availability/intent overlay for every path, and preserves current
  overlay-first ordering. No null plan-definition path may skip an authored constraint.

**Done when:** an eventless athlete produces a non-empty `CoverageState`;
`coverageNeedTierForTemplate` returns a value other than `3` for them; the four
`macrocycleContract.test.ts` / `goldenWeek.test.ts` event-directed expectations are
unchanged; fixtures prove that a travel overlay and a fixed activity constrain both a
demand-derived event and an evergreen week before candidate ranking.

---

### 7.6 `[ ]` Objective vocabulary for strength development

**Current:** only `strength_maintenance` exists (G6).

**Change:** add `'strength_development'` to `ObjectiveKey` with target stimulus
`{ maxStrength: 0.7, hypertrophy: 0.7 }`. `microcycle.ts`'s plan-derived `switch` is
exhaustive (`const _exhaustive: never = objDef.key`), so the compiler will name every site
that must handle it — that is the point of adding the key rather than overloading
`strength_maintenance`. Event-directed paths continue to emit `strength_maintenance`;
only the packed Evergreen strategy emits the new key, and only when its evidence-backed
strength requirement is applicable.

**Done when:** `npm run check` is green with no `as` casts added at the switch sites; an
`endurance`-priority evergreen athlete never receives `strength_development`.

---

### 7.7 `[ ]` Contain taper to real events, and honour hard modality exclusions

Two small independent fixes (G7, G5):

* `taperPolicy.ts` `resolveEventTaper`: the legacy `A → 14 / B → 5` fallback becomes
  category-aware. `general_target` gets **no** default taper; only an explicit
  `EventTaperSpec.startDate` produces one. The cycling A-event race-week rule and the
  authored-start precedence are unchanged (`macrocycleContract.test.ts` guards them).
* Add `unavailableModalities` to `UserPreferences`, validate and persist it through the
  existing preferences service/rules, and feed it into
  `UserContext.constraints.restrictedModalities` at the composition boundary. It therefore flows through the
  existing hard filter in `evaluateTrainingWithIntent` rather than becoming a competing
  profile-level preference model. Existing `avoidedModalities` remains the soft `'avoid'`
  signal; preferred/deprioritized modalities keep their current ownership and semantics.

**Done when:** a 5-star dated `general_target` goal **without an explicit
`EventTaperSpec.startDate`** produces `taperActive === false` at every offset; a companion
test proves an explicit start date still activates tapering; and an `unavailable` modality
appears in no candidate set, including the hard-constraint fallback path in
`rulesHardConstraintFallback.test.ts`.

This is the smallest independent live defect in Phase 7B. After D-TAPERSCOPE is accepted,
land its taper portion as a dedicated bugfix PR before the broader evergreen migration;
the preference-schema portion stays with 7.1 because it changes persisted ownership.

---

### 7.8 `[ ]` Seed defaults, policy version, scenarios, baseline

* **Default profile** (7.1's "absent is not an error"): the in-memory evergreen default is
  `planningMode: 'evergreen'`, `priorities: ['balanced_performance']`,
  `weeklyCommitment: { min 2, target 3, max 4 }`, and
  `organizationPreference: 'auto'`. UserPreferences remains the only source of duration
  and execution preference defaults. Defined once in `evergreenStrategy.ts` and exported
  for tests. `planningMode.ts` applies the separate compatibility override for a
  profile-less athlete with any eligible focus event; it must not persist a profile merely
  to preserve that existing path.
* **Seed from existing goals** (G4): when no profile exists, derive first-pass priorities
  from active non-dated `UserGoal.domain` values (`strength → strength_muscle`,
  `endurance → endurance`, `general_fitness / weight_loss → health`). Filter unsupported
  domains, deduplicate after mapping, then order by goal priority descending, `createdAt`
  ascending, and stable goal id ascending. If no supported mapping remains, use
  `['balanced_performance']`; otherwise the ordered suggestions replace that fallback.
  This is a **display and default-seeding** mapping only: it pre-fills a profile form and
  becomes input to `resolveEvidenceBackedStrategy` only after the athlete confirms it. It must not
  silently persist or alter the profile-less engine default.
* **`POLICY_VERSION`** → `2026-08-training-intent-modes-v1`; push
  `2026-08-authored-travel-blocks-v1` onto `HISTORICAL_POLICY_VERSIONS`. Verify with
  `node scripts/check-policy-drift.mjs <base-sha>`.
* **Scenarios**: add evergreen athletes to `engine/simulation/scenarios.ts` — at minimum a
  2-session health-priority athlete, a 4-session balanced athlete, and a 6-session
  strength-leaning athlete. Without these the diff cannot show whether evergreen behaviour
  is sane, only that event-directed behaviour is unchanged.
* **Baseline**: run `npm run simulate:diff`. **Event-directed scenarios must be
  byte-identical except for the reviewed Phase 7A allocation correction.** Any other
  movement is a Phase 7B regression, not a recalibration. Do not bless a new
  `docs/analysis/simulation-baseline.json` before Phase 7A's criteria pass.

**Done when:** the diff shows zero change on every pre-existing scenario, including
profile-less cycling, running, triathlon, strength, and general-event fixtures;
`planningMode.test.ts` covers structured-plan/demand-derived/evergreen capability states;
goal-priority suggestion tests cover deduplication/tie-breaking/fallback; strategy and
capacity tests cover provenance, training-state inputs, time-aware shortfall, and exact
multi-role identity; the new evergreen scenarios produce no `qualityWarnings` or
`constraintViolations`; and the policy-drift guard passes.

---

### 7.9 `[ ]` Surfaces and docs

* `components/Preferences.tsx` — an intent section: mode, priorities (ordered, plain
  language — **never** "aerobic/anaerobic session counts", per the source analysis's
  taxonomy finding), and min/typical/max sessions. Keep duration and modality controls in
  their existing `UserPreferences` surface; add only the hard-unavailable modality option
  there. Reuse `TrainingSettings.tsx`'s existing save/validate pattern.
* `components/Home.tsx` — the weekly strip should state what the week is *for* in evergreen
  mode ("2 of 3 typical sessions; strength role still open"), not a days-to-event count it
  does not have.
* `docs/architecture/recommendation-engine.md` — document the mode resolution and the two
  coverage sets.
* `docs/plans/README.md` — update the Phase 7B row and the ADR-0017 decision-register entries.

**Done when:** a profile can be created, edited and read back through the UI, and the
architecture doc's description matches `planningMode.ts` and `evergreenStrategy.ts`.

---

## Tests to add

| File | Behaviour asserted |
|---|---|
| `engine/planningMode.test.ts` | explicit/legacy mode resolution; cycling structured-plan and running/triathlon/strength/general demand-derived strategy; passed/cancelled fallback; no residual taper |
| `engine/evergreenStrategy.test.ts` | evidence-backed dose precedes packing; complete provenance; `unknown`/history-derived athlete state; 2–6 table only breaks valid-packing ties; `DEFAULT_BASE_DEMAND` is not an input |
| `engine/trainingCapacity.test.ts` | session counts plus weekday/weekend minutes/windows form real capacity; zero/missing duration is unavailable or versioned fallback; explicit time-aware minimum-dose shortfall |
| `engine/evergreenCoverage.test.ts` | evergreen athlete gets non-empty `CoverageState`; a recovery spin never satisfies `aerobic_volume` (ADR-0016 invariant, re-asserted for the new set) |
| `engine/coverageSets.test.ts` | generic plan-coverage descriptors validate; the September set's entries are unchanged (snapshot) |
| `engine/taperPolicy.test.ts` (extend) | 5-star `general_target` → no taper; cycling A race-week rule unchanged |
| `engine/validation.test.ts` (extend) | profile range/ordering/duplicate and enum/field-allowlist rejection; positive preference durations and hard-unavailable modality validation; invalid read recovery diagnostics |
| `emulator/firestoreRules.emulator.test.ts` (extend) | `training_intent/profile` owner-only, immutable `createdAt`, out-of-range, unsupported planning-mode/organisation, and extraneous-field writes rejected |
| `engine/planningOverlays.test.ts` | authored travel/fixed-activity overlays apply before ranking in structured, demand-derived, and evergreen paths |
| `services/trainingIntentProfileService.test.ts` | `DataState` mapping for AVAILABLE / MISSING / INVALID / UNAVAILABLE |
| `engine/scenarios.test.ts` (extend) | the three evergreen scenarios run clean |

---

## Acceptance criteria

- [ ] An athlete with no events and no profile receives a coherent week from documented
      defaults — no crash, no empty candidate set, no fabricated event.
- [ ] An eventless athlete's dose requirement is derived before packing; identical session
      counts with materially different usable minutes can produce different shortfalls.
- [ ] `coverageNeedTierForTemplate` is no longer a constant `3` for eventless athletes.
- [ ] `taperActive` is false on every eventless day and on every dated `general_target`
      goal without an explicit `EventTaperSpec.startDate`.
- [ ] `simulate:diff` shows **zero** change on all pre-existing event-directed scenarios.
- [ ] `SEPTEMBER_CYCLING_EVENT_SESSION_COVERAGE` is byte-identical.
- [ ] `TrainingIntentProfile` and `UserPreferences` each have one documented field
      ownership; no composer merge can create conflicting live preferences.
- [ ] Required occurrences fit real minutes/windows and declared minimum packing capacity,
      or yield an explicit `minimum_dose_shortfall`; no fictional cross-role credit is
      created.
- [ ] Every evidence-authoritative dose rule has source, population, outcome, confidence,
      applicability, authority class, policy version, and review date; product packing
      heuristics are distinguishable from those rules.
- [ ] `npm run check` and `npm run test:rules` green; policy-drift guard passes.
- [ ] No engine module outside `planningMode.ts` derives planning mode from
      `focusEvent === null`.

---

## Risks & rollback

| Risk | Mitigation | Rollback |
|---|---|---|
| Phase 7 silently recalibrates the event-directed athlete | The zero-diff criterion above; `macrocycleContract`, `goldenWeek`, `specificityCoverageContract` tests unchanged | Revert 7.4/7.5 — the registry is the only item that touches shared code paths |
| Evergreen coverage set is uncalibrated and looks authoritative | ADR-0017 says so explicitly; the set carries a header comment stating it is a starting policy | Set every evergreen requirement to `optional`, reducing coverage to a no-op tier |
| Default profile is wrong for most athletes | The default is conservative (2/3/4) and exported from one place | Change one constant |
| Confusion between `TrainingIntent` and `TrainingIntentProfile` | D-INTENTNAME's mutual doc comments | — |
| Generic plan-coverage migration breaks exhaustive switches | Introduce `Plan*` types as the authority and retain bounded deprecated aliases while callers migrate | Revert the generic vocabulary and evergreen descriptor together |

Every item is independently revertible. 7.1 and 7.7 land value without 7.3–7.5.

---

## Out of scope

* **Deload / unload scheduling.** A separate mechanism from taper and from day-to-day
  recovery; the 2024 randomised deload evidence does not support mandatory scheduled
  cessation. Needs its own ADR.
* **Linear / undulating / block organisations.** Not persisted until implemented; optional
  research collection uses a separate non-operative request field.
* **Mesocycle emphasis rotation** for evergreen. The rolling 7-day block in 7.5 is
  deliberately the smallest thing that makes coverage reachable; multi-week emphasis is the
  destination, not this increment.
* **Walking / non-training load** (the macrocycle v5 doc's explicit exclusion) — unchanged.
* **Beam search.** Phase 5.1's prototype stays a prototype; the live planner stays greedy.
* **Sport-specific structured plans for non-cycling categories.** Non-cycling events remain
  event-directed on the current `demand_derived` strategy; adding a structured plan is
  follow-on work.

---

## Docs to update

* [ADR-0017](../adr/0017-training-intent-profile-and-planning-modes.md) — accept before 7.1.
* `docs/architecture/recommendation-engine.md` — evidence-to-dose-to-capacity-to-packing
  flow, mode/strategy resolution, preference ownership, overlays, and generic coverage
  registry.
* `docs/plans/README.md` — Phase 7B row; D-MODE / D-DOSE / D-CAP / D-COVSET / D-OWNERSHIP / D-ORG / D-TAPERSCOPE
  in the decision register.
* `docs/macrocycle-v5.md` — no change. It is the event-directed contract and stays that.

---

## Task board

| Item | Status | Depends on | Done when |
|---|:--:|---|---|
| 7.1 Persist `TrainingIntentProfile` | `[ ]` | ADR-0017 | Round-trips; rules tests green |
| 7.2 Effective planning mode and event strategy | `[ ]` | 7.1 | Existing events keep event-directed structured/demand-derived paths |
| 7.3 Evidence dose → capacity → role packing | `[ ]` | 7.1, 7.2 | Dose provenance, time-aware capacity, and exact roles yield transparent shortfalls |
| 7.4 Generic plan-coverage registry | `[ ]` | ADR-0017 | Both descriptors validate; September set byte-identical |
| 7.5 Evergreen coverage + plan definition | `[ ]` | 7.3, 7.4 | Non-empty `CoverageState` eventless |
| 7.6 `strength_development` key | `[ ]` | 7.3 | Exhaustive switches handled, no casts |
| 7.7 Taper containment + hard exclusions | `[ ]` | — | 5-star `general_target` → no taper |
| 7.8 Defaults, policy version, scenarios | `[ ]` | 7.1–7.6 | Zero diff on existing scenarios |
| 7.9 Surfaces and docs | `[ ]` | 7.1–7.7 | Profile editable; arch doc matches code |
