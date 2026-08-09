# Phase 6.2c — Recommendation quality and weekly coverage correctness

* **Status:** Draft — proposed for review before implementation
* **Blocked by:** acceptance of the coverage-vs-adaptation decision described below; the current `rules.ts` check-in time-budget regression can be fixed independently and should land first.
* **Unlocks:** trustworthy Specificity/build-week recommendations, meaningful Phase 6.3 scenario contracts, interpretable Phase 6.4 calibration evidence, and a fair greedy-vs-beam re-evaluation.
* **Addresses:** the recommendation-quality findings raised in PR #17 after the Phase 6.2 carryover fixes, including the escaped case where a hard race-specific cycling exposure is followed by a week dominated by one additional race-specific session plus technical/recovery filler instead of the expected mix of easy aerobic, sustained quality, and event-specific work.
* **Behavior change:** yes. The implementation must bump `POLICY_VERSION`, produce a reviewed semantic diff, and document the intended changes before merge.

---

## 1. Goal

Fix the recommendation engine so that **physiological cross-adaptation** and **weekly programming-role fulfillment** are represented as two different things.

A hard race-specific cycling session may legitimately earn aerobic, threshold, fatigue-resistance, and surge *adaptation credit*. It must not automatically erase the requirement for a true easy-aerobic session or a distinct sustained-quality session when the active training plan requires those roles.

The change must also close the adjacent correctness gaps that make the same recommendation problem harder to reason about:

1. the richer cycling `PlanDefinition` is currently tied to one literal event date;
2. fixed activities do not carry enough identity to participate reliably in modality/category/coverage logic;
3. tomorrow's provisional recommendation does not project today's selected recommendation (or today's still-uncompleted fixed load) into tomorrow's fatigue, objective, coverage, and spacing state;
4. weekly anchor dates are nominated before projected fatigue is known and are not repaired when the nominated role becomes infeasible;
5. today's check-in time budget is currently resolved once and then discarded before `rankCandidates` uses its hard time gate.

This plan is deliberately **not** a fatigue-threshold retune and **not** an automatic beam-search adoption plan. The semantics must be correct before sequence-search quality can be judged.

---

## 2. Escaped-case coaching contract

The review-supplied cycling plan defines a normal build/specificity week around distinct training functions:

- **one sustained cycling-quality session** — controlled threshold, over-under, or longer aerobic-power work;
- **one event-specific outdoor ride** — repeated surges, continued pedalling after surges, positioning/group skill where possible, and a fatigued finish;
- **one or two true easy Zone-2 cycling sessions** — deliberately low-intensity aerobic volume/recovery;
- **one primary strength-maintenance session**;
- support/recovery work around those sessions;
- the two cycling quality sessions normally separated by at least **48 hours**.

The escaped recommendation is useful because it separates a *daily* decision from a *weekly* one:

- Immediately after a hard race-specific ride, recovery, mobility, or very easy work can be the correct recommendation.
- Across the next rolling seven-day horizon, those support sessions must not crowd out every required developmental role merely because the prior hard ride scored highly on several physiological stimulus axes.

The implementation must therefore preserve both facts simultaneously:

1. yesterday's hard race-specific ride **did** produce useful aerobic/threshold/surge stimulus;
2. yesterday's hard race-specific ride **did not become a Zone-2 session or a controlled threshold/over-under session after the fact**.

No personal athlete identifiers, raw health data, or private training exports are required for the regression fixture. The committed test should be synthetic and relative-date based.

---

## 3. Current implementation analysis

### 3.1 One ledger currently carries two incompatible meanings

`WeeklyObjective` in `engine/models.ts` currently represents a target stimulus, fractional completed/projected credit, and an optional `ObjectiveQualification`.

That works for adaptation accounting. It does **not** fully represent a weekly programming contract.

`periodization.ts:objectivesFromDemand` demonstrates the problem:

- `zone2_aerobic` has target stimulus `{ aerobicEndurance: 0.8 }` and no category/intensity qualification;
- `threshold_quality` requires threshold stimulus plus an allowed modality, but not the distinct `sustained_quality` programming role;
- `race_specific_endurance` is stricter because it requires Cycling + `Race-Specific Endurance`.

Because Hard Endurance and Race-Specific Endurance templates carry meaningful `aerobicEndurance` and often `thresholdPower`, the same hard session can earn credit for several objective keys. That is physiologically useful, but the engine later treats those objective keys as if they were also the weekly session-role checklist.

### 3.2 The repository already contains the missing role vocabulary

`workouts/event-plan.ts` already declares separate coverage keys such as:

- `easy_aerobic`;
- `sustained_quality`;
- `short_surges`;
- `gap_closing`;
- `outdoor_event_specific`;
- `primary_strength`;
- recovery/travel/taper roles.

Those keys are mapped to explicit detailed workout IDs and phase eligibility.

`engine/planSchedule.ts:PlanObjectiveDefinition` even carries a `coverageKey` for each authored objective.

However, `microcycle.ts:generateWeeklyObjectives` switches primarily on `ObjectiveKey` and creates a `WeeklyObjective`; the `coverageKey` does not survive as an independently tracked weekly contract. The semantic distinction is therefore present at authoring time and lost before ranking.

### 3.3 The new Phase 6.2a backfill makes the role collapse more visible

`planner.ts:backfillCreditFromPriorExposures` correctly replays earlier projected exposures against a newly admitted objective using the canonical stimulus-credit primitive.

That fixes the fresh-day-N equivalence bug found in the prior review. It also means the existing semantic conflation is now propagated more faithfully:

- an earlier hard race-specific ride can backfill `zone2_aerobic` because that objective has no role qualification;
- the same exposure can backfill `threshold_quality` if its threshold stimulus clears the current qualification;
- once those objectives are considered resolved, `optimizer.ts:calculateStimulusBenefit` has less developmental demand to rank against, so technical/recovery filler becomes relatively more attractive.

The backfill code is not the root cause. It is correctly exposing the fact that the underlying objective definition is too broad for a weekly role contract.

### 3.4 Golden-week coverage is too weak to catch the escaped case

`goldenWeek.test.ts` currently verifies important safety/structure invariants, but its core cycling-frequency assertion accepts any two dates that look like Hard/Moderate/Race-Specific Cycling.

That cannot distinguish these two weeks:

```text
A) controlled threshold + true Zone 2 + event-specific ride
B) race-specific + race-specific + technical/recovery filler
```

if cross-credit causes both to resolve the same objective keys.

The test must assert **realized coverage roles**, not only objective resolution and broad category counts.

### 3.5 The richer plan is reachable only for one literal date

`planSchedule.ts:resolvePlanDefinitionForEvent` currently returns the authored cycling plan only when:

```text
category === cycling_event AND date === 2026-09-20
```

`buildSeptemberCyclingEventPlan` also contains absolute Aug/Sep 2026 block dates.

Every cycling event on another target date falls back to generic days-to-event objectives, so the more expressive `coverageKey` metadata is unavailable exactly where it is most needed.

This is a structural correctness issue, not just fixture cleanup.

### 3.6 Travel is currently embedded in the dated plan even though availability now has a better owner

The current hard-coded cycling plan has a `travel` block. Phase 6.2b already introduced explicit `FixedActivity.availabilityContextOverride` semantics for true day-wide travel/equipment constraints.

A reusable default cycling plan should therefore describe **training phase**, while travel/location is an **availability overlay**. A generic event-relative plan must not fabricate a travel week from the event date.

The `travel` phase can remain in the vocabulary for explicitly authored plans; it should not be automatically inserted into every cycling event plan.

### 3.7 Fixed activities have dose but insufficient semantic identity

`FixedActivity` can now carry `expectedStimulus` and `expectedCost`, but it does not carry a canonical template/workout identity and its projection helper deliberately has no modality/category identity.

`planner.ts:applyFixedActivityStimulusCredit` therefore calls the credit primitive without modality/category. Modality-scoped objectives fail closed, which is safer than guessing, but a real booked Cycling workout also cannot reliably satisfy Cycling-scoped objectives or coverage roles.

The engine needs to distinguish:

- **unknown structured dose** — can affect fatigue and broad adaptation only;
- **known modality/category exposure** — can satisfy qualification rules that depend on those fields;
- **known catalog template/workout exposure** — can satisfy explicit weekly coverage mappings.

### 3.8 Tomorrow's provisional plan is not actually conditional on today's selected training dose

`rules.ts:evaluateNextDayPlanWithIntent` builds green/yellow/red readiness branches and calls `evaluateTrainingWithIntent` for tomorrow.

It passes today's recommendation into `buildNextDayScenarios`, but that function mainly uses the broad hard-session count. Tomorrow's `resolveTrainingIntent` still reconstructs real completed history only.

The actual selected `todayRec` is not replayed into tomorrow as a projected exposure for:

- external-load fatigue;
- objective credit;
- coverage-role credit;
- recovery/spacing history;
- same-template/session-role recency.

The same problem exists for today's still-uncompleted fixed activities: tomorrow's single-day evaluation filters fixed activities to tomorrow's own date, so today's booked load does not propagate into the provisional tomorrow branch.

A provisional plan is specifically a forecast **assuming today's selected/booked work happens**. Without that assumption it is internally inconsistent.

### 3.9 Static anchor nomination can lose a required role

`planner.ts:resolveWeeklyAnchors` nominates event-specific and quality dates using static availability, phase eligibility, and maximum time.

It does not yet know the projected fatigue state that will exist on the nominated date.

Later, `generateWeekAheadPlan` may fatigue-gate the nominated day's quality candidates to modify/recover. If no candidate fulfilling that anchor role survives, the planner does not automatically re-nominate the role to a later feasible day.

That turns a soft calendar preference into a silent missed weekly role.

### 3.10 The live time budget currently has two sources of truth

The latest Phase 6.2b fix correctly resolves:

```text
resolveAvailability(date, readiness.subjective, fixedActivities, context)
```

for today's eligibility filtering.

It then calls `buildOptimizationContext`, which resolves availability again with a null check-in. `rankCandidates` consumes the second object.

A short time budget can therefore be respected by the initial candidate filter but ignored by `TIME_BUDGET_EXCEEDED` inside ranking.

This is a separate correctness bug already identified in review. The implementation below treats a resolved `ResolvedAvailability` as a single decision input and removes this split-brain pattern.

---

## 4. Decision required before implementation

The following is a genuine architecture decision and should be recorded in a new ADR before this plan can become `Approved`/`Ready`.

Suggested ADR: **ADR-0016 — Adaptation credit and weekly coverage are orthogonal planning ledgers**.

### Proposed decision D6-F — dual ledgers

Keep the current stimulus/adaptation ledger and add a separate weekly coverage ledger.

**Adaptation ledger answers:**

> What physiological stimulus has the athlete accumulated, with what confidence and fractional dose?

**Coverage ledger answers:**

> Which explicitly required programming roles have been performed/projected inside the active rolling window?

A session can earn credit in both ledgers, but one ledger never implicitly substitutes for the other.

### Proposed decision D6-G — role fulfillment is explicit, not inferred from overlapping stimulus

Coverage fulfillment must come from an explicit mapping:

1. exact workout ID -> declared coverage keys;
2. exact engine template -> resolved detailed workout -> declared coverage keys;
3. otherwise no role fulfillment unless a future, separately approved classifier explicitly provides it.

Modality/category/stimulus alone may still earn adaptation credit but do not invent a coverage role.

One exposure **may** fulfill multiple coverage roles when the authored event-plan mapping explicitly says that it does. For example, an event-specific workout can legitimately also cover a short-surge role if both coverage entries list that workout. The system must not derive that multiplicity merely because stimulus vectors overlap.

### Proposed decision D6-H — coverage uses a rolling window, not a calendar-week reset

Default weekly coverage is evaluated over a rolling seven-day window, clipped to the active plan block.

This avoids a false calendar-boundary rule. If a race-specific exposure happened yesterday, it can initially satisfy the event-specific rolling requirement. As that exposure approaches expiry from the seven-day window, the planner must schedule the next one before the role becomes uncovered, subject to safety/readiness/availability.

For roles described as "1–2 per week", represent two levels:

- `minimumSessions` — contract floor;
- `targetSessions` — desired amount when recovery/capacity permits.

The floor participates in must-have coverage ranking. The target is a softer progression goal.

### Proposed decision D6-I — safety remains above coverage

Coverage is never a hard gate that can override:

- pain/injury restrictions;
- readiness recovery mode;
- time/equipment/environment feasibility;
- minimum recovery spacing;
- rolling hard-session caps;
- taper intensity/volume constraints.

When required coverage is infeasible, the plan must expose it as **missed/deferred coverage with a reason**, not force an unsafe session.

### Proposed decision D6-J — travel is an availability overlay, not a default event-relative phase

The default cycling event plan is generated relative to the event planning date. It contains build/specificity/taper/race/recovery structure.

Travel is inserted only by an explicitly authored plan override or by fixed-activity/day-context availability. A generic cycling event must not receive a fabricated travel block simply because the old September fixture had one.

### Proposed decision D6-K — beam search is re-evaluated only after coverage semantics land

ADR-0015 remains in force: greedy stays production until re-evaluated.

The post-6.2c comparison must score coverage fulfillment in addition to objective resolution, safety, rest share, and latency. Only then is beam search being asked to optimize the correct target.

---

## 5. Target data model

The exact names can change during implementation, but the responsibilities should not.

### 5.1 Neutral event-plan coverage types

`EventPlanCoverageKey` currently lives in `workouts/event-plan.ts`. Engine state will need the type without creating an awkward runtime dependency.

Create a zero-dependency type module, for example:

```text
app/src/workouts/event-plan-types.ts
```

Move/re-export:

- `EventPlanCoverageKey`;
- `EventPlanPhase`;
- `EventPlanRequirement`.

Both `event-plan.ts` and engine planning types import from that neutral module.

### 5.2 Coverage requirement state

Add a first-class model along these lines:

```ts
interface WeeklyCoverageRequirement {
  id: string;
  key: EventPlanCoverageKey;
  requirement: 'required' | 'optional' | 'conditional';
  minimumSessions: number;
  targetSessions: number;
  completedSessions: number;
  projectedSessions: number;
  priority: ObjectivePriority;
  rollingWindowDays: number;
  windowStart?: string;
  windowEnd?: string;
}
```

Add trace-friendly credit records:

```ts
interface CoverageCredit {
  date: string;
  coverageKey: EventPlanCoverageKey;
  source: 'completed' | 'projected' | 'fixed_activity';
  templateId?: string;
  workoutId?: string;
}
```

Extend `MicrocycleState` (or a sibling `WeeklyPlanState`) with coverage requirements. Do not overload `WeeklyObjective.completedCredit` with session-count semantics.

### 5.3 Plan-authoring targets

Extend `PlanObjectiveDefinition` so the adaptation dose and the programming-role count are explicit:

```ts
coverageMinimumSessions?: number;
coverageTargetSessions?: number;
```

Examples for a cycling build/specificity block:

```text
easy_aerobic          minimum 1, target 2
sustained_quality     minimum 1, target 1
outdoor_event_specific minimum 1, target 1
primary_strength      minimum 1, target 1
```

Surge/gap-closing roles can remain conditional/should-have when the demand profile warrants them. A single explicitly mapped event-specific workout may satisfy `outdoor_event_specific` plus another role if the coverage table says so.

### 5.4 Exposure identity

Define a shared identity shape for completed/projected/fixed exposures:

```ts
interface ExposureIdentity {
  templateId?: string;
  workoutId?: string;
  modality?: SessionTemplate['modality'];
  category?: SessionTemplate['category'];
}
```

Extend:

- `CompletedExposure`;
- `ProjectionExposure`;
- `FixedActivity` (optional identity fields);

with enough identity to apply qualifications and exact coverage mapping.

Rules:

- exact followed recommendation -> persist/reconstruct `templateId` and derive `workoutId` when available;
- planner projection -> always carries selected `templateId`, derived workout ID, modality, category;
- fixed activity -> may carry `templateId`/`workoutId` when it represents a catalog session, plus optional modality/category for non-catalog structured activities;
- unknown external activity -> adaptation/fatigue may still be represented, but coverage fails closed.

No title-keyword inference for coverage.

---

## 6. Implementation work items

Status legend: `[ ]` not started · `[-]` in progress · `[x]` finished.

### `[ ]` 6.2c.0 — Remove availability split-brain before adding more policy

**Current behavior**

`rules.ts:evaluateTrainingWithIntent` resolves today's availability with the subjective check-in, then `optimizer.ts:buildOptimizationContext` resolves it again without the check-in.

**Change**

Make `ResolvedAvailability` an explicit, authoritative input to the optimization context when the caller has already resolved it.

Preferred shape:

```ts
buildOptimizationContext(..., {
  ...options,
  resolvedAvailability?: ResolvedAvailability,
  fixedActivities?: FixedActivity[],
})
```

or an equivalent options object that prevents another hidden resolution.

For every decision path:

1. resolve availability once with the correct date/check-in/fixed activities;
2. use the same object for eligibility filtering;
3. use the same object for `rankCandidates` hard gates;
4. use the same object for trace output.

Update the week-ahead loop to avoid its identical redundant resolution while touching this seam.

**Primary files**

- `engine/rules.ts` — `evaluateTrainingWithIntent`;
- `engine/optimizer.ts` — `buildOptimizationContext`;
- `engine/planner.ts` — per-day loop;
- `engine/trainingIntentAcceptance.test.ts`;
- `engine/planner.test.ts`.

**Tests**

- subjective `timeAvailable` below the profile default excludes an overlong candidate both before and inside ranking;
- fixed activity + short check-in time produce one identical `ResolvedAvailability` contract through the decision;
- existing equipment/environment gates still behave identically.

**Done when**

There is no production ranking call where eligibility and hard gates consume two independently resolved availability objects for the same date.

---

### `[ ]` 6.2c.1 — Record ADR-0016 and add the coverage-state primitives

**Change**

1. Write ADR-0016 with D6-F through D6-K above.
2. Move the event-plan coverage type vocabulary to a neutral type-only module.
3. Add `WeeklyCoverageRequirement`, `CoverageCredit`, and `ExposureIdentity` models.
4. Extend `MicrocycleState` with a coverage collection.
5. Add pure helpers:
   - `getUnfulfilledRequiredCoverage`;
   - `getUnfulfilledTargetCoverage`;
   - `applyProjectedCoverageCredits`;
   - `projectCoverageCompatibility` only if UI backward compatibility requires it.

Coverage credits are count-based, not fractional physiological dose. One identified exposure can contribute at most one session count to a given coverage key.

**Primary files**

- `docs/adr/0016-adaptation-credit-and-weekly-coverage.md`;
- `workouts/event-plan-types.ts` (new);
- `workouts/event-plan.ts`;
- `engine/models.ts`;
- `engine/microcycle.ts` or new `engine/coverage.ts`;
- unit tests for the new pure primitives.

**Done when**

The code can represent "aerobic adaptation complete, easy-aerobic coverage still missing" without contradiction.

---

### `[ ]` 6.2c.2 — Build exact coverage identity from the workout catalog

**Change**

Create one canonical mapping helper, for example:

```ts
coverageKeysForExposure(identity, phase): EventPlanCoverageKey[]
```

Resolution order:

1. exact `workoutId` -> look up `SEPTEMBER_CYCLING_EVENT_SESSION_COVERAGE`/renamed generic coverage table;
2. exact `templateId` -> `PLANNING_CANDIDATE_INDEX` -> resolved workout ID -> coverage table;
3. otherwise return `[]`.

Filter mappings by the active `EventPlanPhase` so a workout cannot satisfy a role outside the phase in which that role is declared.

Do not infer coverage from stimulus magnitude.

Do not infer coverage from title text.

Do not let a broad category such as `Race-Specific Endurance` automatically count as `easy_aerobic` merely because the session also has a high aerobic stimulus score.

**Primary files**

- new `engine/coverage.ts` or equivalent;
- `engine/planningCandidate.ts`;
- `workouts/event-plan.ts`;
- `workouts/catalog.ts`/validation tests if mapping validation needs strengthening.

**Tests**

- Zone-2 detailed workout -> `easy_aerobic`;
- controlled threshold/over-under -> `sustained_quality`;
- race-specific workout -> `outdoor_event_specific`;
- event-specific workout may additionally map to `short_surges` only when the table explicitly lists it;
- race-specific workout never maps to `easy_aerobic` unless the authored table is explicitly changed;
- unknown template/workout -> no coverage.

**Done when**

Coverage-role identity is deterministic, testable, and independent from stimulus-credit math.

---

### `[ ]` 6.2c.3 — Replay completed history into both ledgers

**Current behavior**

`buildMicrocycleState` replays historical `CompletedExposure` into adaptation objectives.

**Change**

Keep that behavior. Add a second replay path that applies exact coverage identity to active rolling coverage requirements.

Extend `CompletedExposure` with `templateId?`/`workoutId?` and populate exact identity in `trainingHistory.ts:exposureFromRecommendation` when adherence confirms the prescribed session was followed.

Rules:

- exact/inferred stimulus can continue to earn adaptation credit according to existing confidence policy;
- coverage requires exact role identity for this increment;
- modified/unstructured sessions without exact identity do not silently fulfill a role;
- a coverage credit expires when it leaves the rolling window, causing the role to become unresolved again.

**Primary files**

- `engine/trainingHistory.ts`;
- `engine/microcycle.ts`;
- `engine/trainingIntent.ts`;
- `engine/coverage.ts`;
- `engine/trainingHistory.test.ts` / microcycle tests.

**Tests**

Escaped-case core assertion:

```text
prior-day hard Race-Specific Cycling
=> earns aerobic adaptation credit
=> does NOT increment easy_aerobic coverage
=> does NOT increment sustained_quality coverage
=> DOES increment outdoor_event_specific when exact mapping says so
```

Also test rolling expiry: an event-specific exposure on day -6 counts today and no longer counts once it becomes day -7/-8 according to the chosen seven-day inclusive convention.

**Done when**

The historical ledger can express cross-adaptation without cross-role substitution.

---

### `[ ]` 6.2c.4 — Make coverage first-class in ranking without introducing new tuning constants

**Goal**

Prevent unresolved required roles from losing to technical/recovery filler when a safe, feasible role-fulfilling candidate exists, while preserving safety/readiness authority.

**Change**

Extend `OptimizationContext` and `rankCandidates` with unresolved coverage state.

Do not immediately invent another scalar multiplier. Reuse the Phase-3 lexicographic philosophy.

For each accepted candidate compute a discrete `coverageNeedTier`:

```text
0 = must fulfil now
1 = advances a required minimum
2 = advances an optional/target amount
3 = advances no active coverage
```

A requirement becomes **must fulfil now** when at least one of these is true:

- this date is its nominated anchor;
- remaining feasible dates in the horizon are less than or equal to the remaining minimum session count;
- the oldest currently satisfying exposure will expire from the rolling window before another feasible slot, making the role uncovered unless filled now.

Ranking order after hard-gate rejection:

1. lower `coverageNeedTier`;
2. existing benefit tier (`calculateStimulusBenefit` / `BENEFIT_TIE_BAND`);
3. existing utility score (fatigue, preferences, variety, event priority);
4. existing near-equivalent variety tie-break.

This keeps the new policy ordinal and reviewable rather than hiding it inside a coefficient.

**Important safety rule**

`coverageNeedTier` is calculated **only among candidates that survive** all existing hard constraints and the current train/modify/recover envelope. It never makes an inadmissible session eligible.

**Primary files**

- `engine/optimizer.ts`;
- `engine/models.ts` (`RankedCandidate`/trace shape if needed);
- `engine/rules.ts`;
- `engine/planner.ts`;
- `engine/optimizer.test.ts`.

**Tests**

- with unresolved `easy_aerobic`, true Zone 2 ranks ahead of Pedalling Economy when both are otherwise safe/feasible;
- a hard race-specific candidate with high aerobic stimulus does not rank as if it fulfills `easy_aerobic`;
- with unresolved `sustained_quality`, controlled threshold/over-under outranks non-role filler when safe;
- a recovery-mode day still selects only recovery candidates even when required coverage is outstanding;
- if no role-fulfilling candidate survives hard gates, the engine records coverage risk and chooses the best safe alternative.

**Done when**

Support sessions can coexist with developmental roles but cannot replace all required roles through stimulus overlap alone.

---

### `[ ]` 6.2c.5 — Replace the literal September plan with an event-relative cycling plan

**Current behavior**

`resolvePlanDefinitionForEvent` recognizes one literal `2026-09-20` cycling event and `buildSeptemberCyclingEventPlan` contains absolute dates.

**Change**

Replace it with a reusable `buildCyclingEventPlan(event)` whose dates are derived from:

```text
event.timing?.planningDate ?? event.date
```

Align the default authored blocks with the existing generic periodization boundaries rather than inventing a second hidden calendar:

- **Build:** 84 to 36 days before event;
- **Peak / Specificity:** 35 days before event through the day before taper starts;
- **Taper:** A = 14 days, B = 5 days, C = no automatic taper;
- **Race:** event day;
- **Recovery:** post-event window where applicable.

`EventPlanPhase.peak` is the authored-plan counterpart of the engine's user-facing `Specificity` label.

Do **not** automatically create a travel block. Travel remains available for explicitly authored plans but generic user travel is represented through fixed activity/day-context availability.

Author coverage counts for cycling roles in the active blocks. At minimum for Build/Specificity where demand supports them:

- `easy_aerobic`: minimum 1, target 2;
- `sustained_quality`: minimum 1;
- `outdoor_event_specific`: minimum 1;
- `primary_strength`: minimum 1;
- surge/gap-closing support according to the event demand profile.

Taper keeps its existing separate sharpening/primer semantics rather than demanding full-volume quality roles.

**Primary files**

- `engine/planSchedule.ts`;
- `engine/periodization.ts` only if a shared phase-window helper is required;
- `workouts/event-plan.ts`;
- plan-schedule and periodization tests.

**Tests**

- two cycling events with different dates generate structurally identical relative blocks shifted in calendar time;
- an A event enters taper at -14, a B event at -5, matching existing periodization authority;
- no literal 2026 date is required for plan resolution;
- travel is absent unless explicitly authored/overlaid;
- a Specificity date for any supported cycling event exposes separate easy/sustained/event-specific coverage requirements.

**Done when**

The richer planning contract follows the athlete's event date instead of a repository fixture date.

---

### `[ ]` 6.2c.6 — Give fixed activities enough identity to earn correct adaptation and coverage

**Change**

Extend `FixedActivity` with optional structured identity, preferably:

```ts
templateId?: string;
workoutId?: string;
modality?: SessionTemplate['modality'];
category?: SessionTemplate['category'];
```

Validation rules:

- optional strings/enums only;
- no requirement that non-catalog activities provide template/workout IDs;
- unknown IDs fail closed at engine lookup rather than crashing;
- `expectedStimulus`/`expectedCost` remain optional and retain D6-C zero-default semantics.

Update Firestore `hasOnly(...)`, validation, service round-trip tests, and emulator tests.

Update `applyFixedActivityStimulusCredit` to pass known modality/category into `deriveObjectiveCreditFromProfile`.

Update fixed-activity projection to apply coverage only when `coverageKeysForExposure` resolves exact identity.

Examples:

- booked catalog Cycling threshold workout -> can satisfy Cycling threshold qualification and `sustained_quality` coverage;
- external football match with expected lower-body cost -> affects fatigue, may earn only broad adaptation that its known modality/category legitimately qualifies for, and does not satisfy cycling coverage;
- generic activity with stimulus but no identity -> adaptation-only; no role coverage.

**Primary files**

- `engine/models.ts`;
- `engine/validation.ts`;
- `firestore.rules`;
- fixed-activity service/form if it exposes these fields;
- `engine/planner.ts`;
- validation/emulator/planner tests.

**Done when**

A booked structured training session can participate in the same qualification/coverage semantics as a projected catalog session, and unknown activities remain conservative.

---

### `[ ]` 6.2c.7 — Project today's selected/booked work into tomorrow's provisional branches

**Current behavior**

Tomorrow's green/yellow/red branches rebuild intent from real completed history and tomorrow's own fixed activities. They do not treat today's selected recommendation as a projected prior exposure.

**Change**

Create one pure projected-exposure adapter from a recommendation:

```ts
projectRecommendationExposure(date, recommendation)
```

It must include:

- date;
- template/workout identity;
- modality/category;
- stimulus profile;
- cost profile;
- realized role/coverage identity where applicable.

When evaluating tomorrow:

1. resolve real completed history as today;
2. append today's selected recommendation as **projected**, not completed, evidence;
3. append today's uncompleted fixed-activity projected exposures;
4. rebuild/project external fatigue to tomorrow with correct overnight decay;
5. apply adaptation credit as `projectedCredit`;
6. apply coverage credit as projected session count;
7. include the projected exposure in spacing/recency history;
8. evaluate each green/yellow/red readiness branch against that same projected external history but its own internal readiness strain.

Do not mark the projection as durable completion. When tomorrow becomes today, real adherence/Garmin history replaces the forecast.

Implementation note: avoid adding today's cost onto a fatigue state already decayed to tomorrow at full strength. Reuse chronological replay semantics (or a pure projected-load helper) so the one-day decay is correct.

**Primary files**

- `engine/rules.ts` — `evaluateNextDayPlanWithIntent`;
- `engine/trainingIntent.ts` or a new pure projection helper;
- `engine/fatigue.ts` if a generic load-exposure replay type is extracted;
- `engine/planner.ts` shared projection types;
- `engine/trainingIntentAcceptance.test.ts`.

**Tests**

- hard Cycling today -> tomorrow green branch still sees decayed lower-body/systemic load and spacing history;
- easy/recovery today -> tomorrow is not over-penalized;
- today's selected race-specific session earns projected event-specific coverage for tomorrow's rolling state but does not erase easy/sustained coverage;
- today's booked fixed activity affects tomorrow exactly once;
- changing only tomorrow readiness changes internal strain but not the projected external history shared by all three branches.

**Done when**

The provisional tomorrow plan is genuinely conditional on today's planned work being performed.

---

### `[ ]` 6.2c.8 — Make anchor nomination repairable and coverage-driven

**Current behavior**

`resolveWeeklyAnchors` chooses nominal quality/event-specific dates before projected fatigue is known.

**Change**

Treat anchors as **preferred slots for required coverage**, not as one-shot dates.

1. Derive which anchor roles are needed from unresolved coverage (`sustained_quality`, `outdoor_event_specific`) rather than broad category demand alone.
2. Keep the initial nominal-date pre-pass for deterministic spacing and long-session availability.
3. On each projected date, after fatigue/recovery hard gates are known:
   - if the nominated anchor has at least one surviving role-fulfilling candidate, give that candidate `must fulfil now` coverage tier;
   - if no role-fulfilling candidate survives, mark the anchor unavailable and re-nominate the requirement to the next feasible date in the remaining horizon;
   - preserve the >=48h quality/event-specific spacing rule where feasible;
   - if no feasible date remains, record an explicit missed-coverage reason.
4. If tomorrow's externally selected provisional recommendation does not fulfill the role previously nominated for tomorrow, re-open/re-nominate that role in the projected strip.

Do not silently treat the nominated date as fulfilled simply because some other session happened there.

**Primary files**

- `engine/planner.ts` — `resolveWeeklyAnchors`, `realizedSessionRole`, per-day loop;
- `engine/optimizer.ts` — `candidateMatchesAnchorRole` only if generalized to coverage keys;
- planner/golden-week tests.

**Tests**

- quality anchor nominated for day 3, but projected fatigue makes all quality candidates inadmissible -> role moves to day 5/6 when feasible;
- event-specific and sustained-quality roles remain >=48h apart when both can be scheduled;
- impossible week records missed coverage instead of violating a hard recovery rule;
- a support session on the original anchor date does not count as anchor fulfillment.

**Done when**

A transient recovery day can move a weekly role without deleting it from the rest of the plan.

---

### `[ ]` 6.2c.9 — Add the escaped Specificity case as a blocking coaching contract

Extend the Phase 6.3 scenario input contract as needed (`initialHistory`, date-level readiness, exact identity).

Add a deterministic scenario named approximately:

```text
cycling_specificity_after_hard_race_specific
```

Use relative dates and synthetic data only.

**Initial state**

- A-priority cycling event;
- evaluation in `Specificity` (15–35 days out, not taper);
- exact hard Race-Specific Cycling exposure on day -1;
- otherwise healthy athlete with normal equipment/time;
- no pain/injury constraint;
- readiness initially compatible with recovery/easy work after the hard exposure, then normalizes.

**Blocking contracts**

1. No quality session violates recovery/hard-lower-body spacing.
2. The prior race-specific exposure may earn aerobic/threshold adaptation credit but does **not** fulfill `easy_aerobic` or `sustained_quality` coverage.
3. Within the rolling horizon, the plan contains at least one **true `easy_aerobic`** Cycling exposure.
4. Once recovered, the plan contains a distinct **`sustained_quality`** exposure.
5. `outdoor_event_specific` remains covered over the rolling window; if the day -1 exposure ages out inside the horizon, another appropriately spaced event-specific exposure is scheduled before/when coverage would otherwise lapse.
6. Support sessions such as Pedalling Economy or Mobility/Recovery may appear, but cannot be the reason a required coverage minimum is missed when a safe feasible slot exists.
7. At least one recovery/easy day after the initial hard exposure is allowed and should not itself be considered a failure.
8. No hard constraint violation.

Do **not** assert an exact seven-day category sequence. The contract is role fulfillment + safety, not a frozen coach-written calendar.

**Primary files**

- `engine/simulation/scenarios.ts`;
- `engine/simulation/analyze.ts`;
- `engine/scenarios.test.ts`;
- `engine/goldenWeek.test.ts`.

**Done when**

The escaped recommendation can no longer recur without a CI failure.

---

### `[ ]` 6.2c.10 — Strengthen the golden-week contract around realized coverage

Keep the existing spacing, strength-protection, and recovery assertions.

Replace/augment the broad "at least two key Cycling sessions" check with explicit realized coverage assertions for the supported cycling plan:

- `easy_aerobic` minimum met;
- `sustained_quality` minimum met;
- `outdoor_event_specific` minimum met when active;
- `primary_strength` minimum met unless a safety/readiness constraint makes it infeasible;
- required roles are not counted from stimulus-only cross-credit.

Add a Specificity variant seeded with prior-day hard race-specific work.

Run the same contract against both production greedy and the beam prototype, but do not use the result to switch production yet.

**Done when**

The golden-week suite distinguishes a structurally good week from a week that only looks good because two hard sessions cross-credit several objectives.

---

### `[ ]` 6.2c.11 — Re-run greedy vs beam against the corrected contract

After 6.2c.0–6.2c.10 are green:

1. update `compare:sequence-search` to report:
   - required coverage fulfilled/missed;
   - target coverage fulfilled;
   - objective/adaptation resolution;
   - recovery/rest share;
   - hard-constraint violations;
   - fragile selections;
   - runtime.
2. run greedy and beam over the existing corpus plus the escaped Specificity case;
3. document whether beam improves coverage fulfillment or only changes distribution;
4. keep ADR-0015's production decision unless a new ADR explicitly changes it.

A good outcome can still be "greedy is adequate once the semantics are fixed".

**Done when**

Sequence-search adoption is judged against the correct planning target rather than the old conflated objective ledger.

---

## 7. Implementation order

Recommended PR slicing after this documentation PR:

### PR A — decision + availability authority

- 6.2c.0 availability single-source fix;
- ADR-0016;
- neutral coverage types and empty coverage state;
- no recommendation-policy change beyond the already-known time-budget bug.

### PR B — dual-ledger semantics

- coverage mapping from catalog identity;
- plan-definition coverage counts;
- history replay into coverage;
- optimizer coverage tiers;
- `POLICY_VERSION` bump;
- semantic baseline update after review.

### PR C — event-relative cycling plan

- replace literal event date/absolute block calendar;
- remove automatic travel block from default plan;
- relative-plan tests;
- policy version bump if recommendation behavior changes beyond PR B's already-reviewed scope.

### PR D — projected identity and tomorrow correctness

- exposure identity on fixed/completed/projected records;
- persistence/rules changes for `FixedActivity`;
- today's selected/booked work into tomorrow branches;
- integration tests.

### PR E — anchor repair + escaped-case contract

- coverage-driven anchor repair;
- Specificity regression scenario;
- strengthened golden-week tests;
- reviewed semantic diff.

### PR F — greedy vs beam re-evaluation

- measurement only unless a separate adoption decision is made.

If review prefers fewer PRs, B+C may be combined because plan-derived coverage and event-relative plan resolution are tightly coupled. Do not combine the beam adoption decision into the same behavior-changing PR.

---

## 8. Test matrix

| Layer | Required evidence |
|---|---|
| Pure unit | coverage mapping, rolling expiry, dual-ledger credit, coverage tier ordering |
| Plan schedule | any cycling target date resolves relative blocks; A/B taper windows; no fabricated travel |
| History reconstruction | exact followed recommendation retains identity; unknown/modified evidence fails closed for coverage |
| Fixed activity validation | optional identity fields round-trip; malformed enums rejected; unknown catalog IDs fail safely at engine lookup |
| Live recommendation | short check-in time survives into ranking hard gate; coverage influences ranking only after hard gates |
| Tomorrow preview | today's recommendation/fixed load affects tomorrow fatigue, spacing, adaptation, and coverage exactly once |
| Week-ahead planner | anchor repair, rolling role expiry, missed-coverage reason when infeasible |
| Golden week | explicit easy/sustained/event-specific coverage, not broad key-session count only |
| Scenario harness | escaped Specificity case is blocking; exact sequence remains observational |
| Replay | old policy versions remain replayable; new policy version records new semantics |
| Greedy vs beam | same safety contracts; compare coverage fulfillment and runtime |

---

## 9. Decision trace / observability additions

Phase 6.4 should expose the new semantics so recommendation changes are explainable.

Add to decision/week traces:

- active coverage requirements;
- minimum/target/completed/projected counts;
- coverage keys each candidate would fulfill;
- candidate `coverageNeedTier`;
- coverage credits applied that date and their identity source;
- coverage credits that expired from the rolling window;
- anchor nomination/re-nomination reason;
- missed/deferred coverage with hard-gate reason;
- adaptation credit separately from coverage credit.

This is essential for avoiding the next version of the same debugging problem: a reviewer must be able to tell whether a ride was selected because it provided broad aerobic stimulus or because the plan specifically needed an easy-aerobic role.

---

## 10. Policy-version and replay requirements

The dual-ledger/ranking change will alter recommendations and must not reuse `2026-08-phase6-correctness-carryovers-v1`.

Use a new version, for example:

```text
2026-08-phase6-weekly-coverage-v1
```

Exact string can follow the repository's naming convention at implementation time.

Required in the behavior-changing commit:

- bump `POLICY_VERSION`;
- retain replay support for the previous Phase-6 policy;
- run `check-policy-drift.mjs`;
- run `simulate:scenarios`;
- inspect semantic differences;
- update the baseline only through `simulate:update-baseline -- --reviewed` after the change is accepted;
- add a dated analysis note explaining the recommendation distribution changes.

Do not normalize away large category-distribution changes as "expected" without linking them to the new coverage mechanism.

---

## 11. Acceptance criteria

### Semantics

- [ ] Adaptation credit and coverage fulfillment are represented separately.
- [ ] A hard race-specific Cycling session can earn aerobic/threshold adaptation without automatically fulfilling `easy_aerobic` or `sustained_quality`.
- [ ] Coverage fulfillment comes from explicit catalog/plan mapping, not overlapping stimulus vectors or title keywords.
- [ ] One session may fulfill multiple coverage roles only when the authored mapping explicitly permits it.
- [ ] Coverage is evaluated over a rolling window and can become unresolved again as an old role-specific exposure ages out.
- [ ] Unknown activity identity fails closed for coverage while still allowing explicit dose to affect fatigue/adaptation.

### Event plan

- [ ] A cycling plan resolves for supported cycling events regardless of literal calendar date.
- [ ] Build/Specificity/taper blocks are derived from the event planning date and match existing periodization boundaries.
- [ ] Generic cycling plan generation does not fabricate a travel week.
- [ ] Specificity exposes distinct easy-aerobic, sustained-quality, event-specific, and strength coverage requirements when applicable.

### Live/tomorrow/week-ahead correctness

- [ ] Today's check-in time budget is the same budget used by eligibility and ranking hard gates.
- [ ] Tomorrow's provisional branches project today's selected recommendation and today's uncompleted fixed activities exactly once.
- [ ] Projected prior work influences tomorrow fatigue with correct decay, objective credit, coverage credit, and spacing history.
- [ ] A nominated quality/event-specific role is re-nominated when its original slot becomes infeasible.
- [ ] Coverage never overrides a safety/readiness/recovery hard gate.
- [ ] Infeasible required coverage is reported explicitly rather than hidden or forced.

### Escaped-case contract

- [ ] `cycling_specificity_after_hard_race_specific` is committed as a blocking synthetic scenario.
- [ ] It permits immediate recovery after the hard prior-day exposure.
- [ ] It still delivers true easy-aerobic coverage in the rolling horizon.
- [ ] It delivers distinct sustained-quality coverage after recovery.
- [ ] Event-specific coverage remains continuous as the prior exposure ages out.
- [ ] Technical/mobility sessions cannot replace required developmental roles when safe feasible slots exist.
- [ ] No hard constraint violation occurs.

### Evidence

- [ ] Golden-week tests assert realized coverage roles, not only broad key-session counts/objective resolution.
- [ ] Existing Phase 6.2 fixed-activity and mid-horizon tests remain green.
- [ ] Policy version is bumped and prior policy replay remains supported.
- [ ] Semantic diff is reviewed and documented.
- [ ] Greedy vs beam is re-measured only after the new contract is in place.

---

## 12. Risks and mitigations

### Risk: coverage makes the engine too rigid

Mitigation: coverage never outranks hard safety/readiness gates; use minimum vs target sessions; record missed coverage instead of forcing sessions.

### Risk: double counting one session across adaptation and coverage

This is intentional when the meanings differ. The error to prevent is double counting **within the same ledger**. A session can earn physiological adaptation and satisfy a declared role at the same time.

### Risk: one session satisfies too many coverage roles

Mitigation: only explicit event-plan mappings can assign multiple roles. Stimulus overlap is never enough.

### Risk: conservative identity rules under-credit unscheduled real-world training

Accepted for this increment. Unknown external activity can still influence fatigue and adaptation. Future evidence/classification work can add a reviewed coverage classifier; silent keyword inference is worse.

### Risk: event-relative plan changes existing September fixture behavior

Mitigation: write shift-invariant tests against relative days-to-event, retain a fixture confirming the previous intended role structure, and inspect semantic diff before baseline update.

### Risk: rolling coverage plus greedy planning still misses future slots

Mitigation: coverage urgency + anchor repair closes the simplest failure. If the escaped scenario still fails despite correct semantics, use the same contract to determine whether the limitation is truly greedy horizon search; only then revisit beam adoption.

### Risk: today->tomorrow projection double counts when real activity sync arrives

Mitigation: projected exposures exist only inside the provisional evaluation call and are never persisted as completed. The next real-day evaluation reconstructs durable history from adherence/Garmin evidence instead.

---

## 13. Rollback

Behavior-changing work must remain reversible by policy version.

Rollback plan:

1. revert live policy version to the previous Phase-6 policy;
2. keep new coverage fields optional in persisted/read models so older policy replay ignores them safely;
3. retain ADR/analysis evidence explaining why the candidate was rolled back;
4. do not delete the escaped-case scenario — if the old policy fails it, mark that failure as expected only in historical replay tests, not production CI.

A rollback should not require deleting fixed activities or rewriting user history.

---

## 14. Out of scope

This plan does **not**:

- prescribe new physiological fatigue thresholds;
- automatically tune stimulus coefficients;
- claim synthetic fixtures validate physiology;
- make beam search production by default;
- build a generic end-user plan-authoring UI;
- infer exact coverage roles from free-text/Garmin titles;
- make travel a permanent phase in every cycling plan;
- force exact weekly calendar sequences;
- change injury/tissue guardrail authority.

---

## 15. Docs to update as implementation lands

- `docs/adr/0016-adaptation-credit-and-weekly-coverage.md` — architecture decision.
- `docs/architecture/recommendation-engine.md` — dual ledger, coverage ranking tier, tomorrow projected exposure, anchor repair.
- `docs/plans/phase-6-evidence-and-operational-assurance.md` — add 6.2c to the task board/execution order and make the escaped-case scenario a required 6.3 contract.
- `docs/plans/README.md` — make 6.2c the next recommendation-correctness priority before calibration.
- `docs/analysis/` — dated semantic-diff note for the behavior-changing policy version.
- `docs/adr/0015-sequence-planning-and-session-role-model.md` — do not edit the accepted ADR; write a new ADR only if the post-6.2c evidence changes the greedy-vs-beam production decision.

---

## 16. Completion definition

Phase 6.2c is complete only when the engine can explain and enforce the following statement:

> A hard race-specific ride can count as hard race-specific work and can contribute to several physiological adaptations, but it does not retroactively become the week's easy Zone-2 ride or its controlled threshold/over-under session. After appropriate recovery, the planner still protects the distinct roles the active cycling plan requires, and if a role cannot be delivered safely it reports that fact instead of silently replacing it with filler.

Until that statement is true in the live path, tomorrow preview, week-ahead planner, golden-week contract, and escaped-case scenario, the recommendation-quality issue should be considered open.