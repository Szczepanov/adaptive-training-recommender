# Event taxonomy recon — fitness-race / HYROX support

| | |
|---|---|
| **Type** | Point-in-time architecture analysis (`docs/analysis`: what is true today) |
| **Date** | 2026-10-05 |
| **Scope** | Event taxonomy, HYROX Open Singles, event timing, multi-event authority, periodization, exact coverage, executable sessions, taper, knowledge lineage, UI/persistence |
| **Decision record** | Proposed ADR-0048: `docs/adr/0048-event-taxonomy-and-format-semantics.md` |
| **Implementation plan** | `docs/plans/2026-10-05-event-taxonomy-fitness-race-hyrox.md` |

## Executive summary

The repository can represent endurance races, triathlon, strength meets and generic targets, but it cannot represent a fitness race honestly. Adding only a `fitness_race` enum member would be incomplete because event semantics are currently scattered across `eventPresets.ts`, `periodization.ts`, `optimizer.ts`, `taperPolicy.ts`, `planSchedule.ts`, exact coverage descriptors, `Goals.tsx` and the Sports Knowledge Registry.

The HYROX motivating case exposes four architecture boundaries that P0 must respect:

1. **Uncertain event dates already have a domain model.** `EventTiming` carries `earliestDate`, `latestDate`, `planningDate` and optional `confirmedDate`; ADR-0012 already treats it as production authority. The missing piece is Goal UI support. Warsaw 2027 is provisional, so `2027-04-10` must not be encoded as a confirmed date.
2. **Event-specific session morphology belongs to the coverage ledger, not the adaptation ledger.** ADR-0016 separates physiological stimulus credit from exact programming-role fulfilment. Compromised running and station-specific work are programming roles and must be satisfied by exact canonical identities.
3. **HYROX sessions are multidomain.** ADR-0023 makes `SessionDefinition` plus frozen `ExecutionPrescription` the source-neutral executable boundary for composite sessions. A run-station workout cannot be represented fully by a single-modality summary plus prose.
4. **A secondary event may need exact event-specific programming without becoming the season focus.** The active athlete plan deliberately keeps the August cycling A-race as the primary season target while giving April HYROX a bounded February/March specific build. Current multi-event periodization can blend secondary-event adaptation objectives, but exact `PlanDefinition`/coverage authority is not yet a bounded secondary-event overlay. P0 must add that capability without creating a second optimizer or blindly stacking sessions.

Recommended P0:

- add root categories `fitness_race` and `other_event`;
- add first-class format `hyrox_open_singles` plus an honest `custom` fallback;
- retain the selected format identity on `UserEvent`;
- centralize event semantics in one resolver rather than adding more category switches;
- add a HYROX event-relative `PlanDefinition` and exact coverage set;
- allow a specifically supported **secondary** event to contribute bounded coverage requirements during its active plan window while the global focus event remains unchanged;
- make those requirements compete inside the existing weekly capacity/allocator path so event-specific work replaces optional/generic work instead of being stacked on top;
- add canonical HYROX workouts that adapt into ADR-0023 `SessionDefinition` and executable prescriptions;
- expose provisional `EventTiming` in the Goal UI;
- add named plan/taper calibration with knowledge lineage;
- update the Sports Knowledge Registry and `POLICY_VERSION` atomically with decision-affecting implementation.

## 1. External facts for the motivating case

### 1.1 HYROX Warsaw 2027

The official HYROX Warsaw event page currently states:

- event window: **7–11 April 2027**;
- venue: **PGE Narodowy, Warsaw**;
- the published schedule is **provisional**;
- `HYROX MEN` is currently listed on **7, 8, 9 and 10 April**;
- individual start times are linked only shortly before the event.

Source: <https://hyrox.com/event/hyrox-warsaw-26-27/>

Therefore `2027-04-10` is a possible Men/Open date, not a confirmed event date. The product should preserve uncertainty rather than turn a temporary schedule detail into persisted truth.

### 1.2 Race morphology

HYROX describes the individual race as eight 1 km runs interleaved with eight functional stations. Open and Pro are separate divisions and differ in selected loads. The station sequence includes SkiErg, sled push, sled pull, burpee broad jumps, rowing, farmer carry, sandbag lunges and wall balls.

Source: <https://hyrox.com/the-fitness-race/>

This is materially different from a running race, strength meet, cycling event or triathlon. It combines locomotion, repeated transitions, loaded locomotion, grip, local muscular endurance and whole-body conditioning.

## 2. Current repository state

### 2.1 Event category, preset and timing model

`app/src/engine/models.ts` currently defines root categories for running, cycling, triathlon, strength meets and general targets. `UserEvent` already carries optional `EventTiming`, but it does **not** retain the event preset/format selected by the goal.

`goalToUserEvent` resolves `UserGoal.eventPreset` into a demand vector and then discards the preset identity. That becomes lossy once one root category can contain formats with materially different plan, taper, coverage or station semantics.

### 2.2 Presets are demand-only

`app/src/engine/eventPresets.ts` currently contains 19 authored presets. A preset contains only:

- `id`;
- `label`;
- `demandProfile`.

`resolveDemandProfile(category, preset)` therefore cannot be the single authority for:

- event-specific modalities;
- support level (`specific` vs `generic`);
- taper policy;
- coverage set;
- event-relative plan policy;
- executable session family.

### 2.3 Event semantics are duplicated

Event meaning is reimplemented across several consumers:

- `eventPresets.ts` — preset/demand selection;
- `periodization.ts` — category-specific modalities/objectives and multi-event objective blending;
- `optimizer.ts` — separate category-to-modality event-focus bonus;
- `taperPolicy.ts` — category/priority taper rules;
- `planSchedule.ts` — structured event-relative plan support;
- `workouts/event-plan.ts` — exact programming-role coverage sets;
- `Goals.tsx` — category labels, preset selection and single-date UI.

Adding `fitness_race` independently to each switch would compile but deepen semantic drift.

### 2.4 Structured plan authority is richer than generic objective fallback

ADR-0012 establishes:

> explicit `PlanDefinition` authority > generic days-to-event fallback.

The current generated event-relative plan path is substantially richer for cycling than for other events. Generic demand-derived objectives cannot express exact HYROX roles such as compromised running or station-specific partial simulation.

### 2.5 Multi-event adaptation exists, exact secondary-event coverage does not yet have equivalent authority

The periodization layer already reasons about more than one upcoming event and can blend secondary-event **adaptation objectives** into a weekly objective set. That solves only the stimulus side of the problem.

HYROX specificity needs exact programming-role coverage. If the August cycling A-race remains the global focus because of priority while April HYROX is a secondary event, a focus-event-only structured-plan path would fail in the opposite direction: HYROX physiology might influence objectives, but exact compromised-run/station roles could remain absent.

The correct extension is not to promote HYROX artificially to global focus. It is to allow a specifically supported event whose registered plan window is active to contribute a **bounded coverage overlay**. Those requirements must enter the same capacity/coverage allocator as existing roles, not append extra workouts after planning.

### 2.6 Adaptation and coverage are intentionally different

ADR-0016 is the critical boundary:

- adaptation credit answers **what physiological stimulus was accumulated**;
- coverage answers **which explicitly required programming role was performed**;
- coverage is exact-identity based;
- modality/category/stimulus must not invent role fulfilment.

Therefore these are coverage concepts first:

- compromised running;
- station work;
- fitness-race partial simulation;
- fitness-race race day.

They should not be introduced primarily as new `ObjectiveKey` values merely to stop generic Running + generic Strength from substituting for a combined session.

### 2.7 Executable session architecture

ADR-0004 requires selectable engine templates to resolve to canonical workout prescriptions.

ADR-0023 makes `SessionDefinition` the source-neutral executable boundary for structured strength, power, speed, field, conditioning, recovery, skill and composite sessions. Execution freezes an `ExecutionPrescription`.

A HYROX compromised-running workout is inherently composite. P0 therefore needs both:

1. an engine/catalog identity that can be ranked, costed and credited; and
2. a normalized multidomain executable definition preserving ordered run/station work, dose, transitions and equipment requirements.

Adding rows only to `engine/templates.ts` would be architecturally incomplete.

### 2.8 Taper

`resolveEventTaper` currently respects an explicitly authored taper, then applies existing product defaults. The endurance taper literature supports a broad strategy of reducing volume while retaining intensity/frequency, but it does not validate an exact HYROX-specific number of days.

Any initial HYROX taper duration is therefore product calibration, must have a policy identity and must not outrank explicit authored intent.

### 2.9 Goal UI cannot express provisional windows

ADR-0012 already documents the gap: `EventTiming` exists and is wired through the domain, while `Goals.tsx` still collects one `targetDate`.

For HYROX Warsaw the UI needs a minimum choice between:

- confirmed single date; or
- provisional date window.

`planningDate` remains the operative planning anchor and moves to the confirmed date once confirmation is known.

## 3. Architecture findings

### F1 — fixed 10 April acceptance is factually and architecturally wrong — P0

Use `EventTiming` for the 7–11 April window. Do not call 10 April confirmed until the user actually confirms it.

### F2 — downstream format identity is lost — P0

Retain a stable `UserEvent.presetId` (or equivalent). Taper, coverage and optimizer semantics must not reverse-engineer format identity from the demand vector.

### F3 — another category-only switch would violate single-authority design — P0

Introduce one canonical resolver for category + format metadata. Existing consumers should call it or receive its result rather than adding independent `fitness_race` branches.

### F4 — compromised running is a coverage role, not a new adaptation axis — P0

Keep existing physiological objective axes unless a genuinely new adaptation construct is separately justified. Represent session morphology with exact coverage keys/requirements.

### F5 — fitness-race needs a generated `PlanDefinition` — P0

Add a `fitness_race / hyrox_open_singles` event-relative plan with build/specificity/taper/race/recovery blocks and exact coverage requirements. Initial block boundaries are product calibration, not biological constants.

### F6 — supported secondary events need bounded exact-plan overlays — P0

A specifically supported secondary event must be able to contribute exact coverage during its active plan window without becoming the global focus event.

Required behavior:

- global focus-event selection remains the existing season-priority/adaptation authority;
- each specifically supported scheduled event may expose an active structured-plan overlay when `asOf` falls inside its plan window;
- overlay requirements merge into the same weekly coverage/capacity allocation path;
- overlay work **replaces** lower-priority optional/generic work instead of being appended after schedule construction;
- safety, explicit authored plans/tapers/recovery and feasibility remain higher authority;
- conflicts resolve deterministically using urgency, event priority and role criticality inside the existing allocator, not by introducing another optimizer;
- the overlay expires after its event/recovery window.

This is necessary to model a secondary April HYROX build while retaining an August cycling A-race as season focus.

### F7 — HYROX composite sessions must cross the ADR-0023 boundary — P0

Catalog templates alone are insufficient. Canonical run-station workouts must resolve to reviewed `SessionDefinition`s and immutable execution prescriptions.

### F8 — exact workout coverage is required — P0

Add a dedicated coverage set rather than allowing generic Running + generic Strength to satisfy fitness-race specificity. Minimum useful roles:

- `fitness_race_station_work`;
- `fitness_race_compromised_run`;
- `fitness_race_specific_simulation`;
- `fitness_race_race_day`.

Reuse existing `aerobic_volume`, `primary_strength` and `recovery_or_rest` only where semantics truly match.

### F9 — equipment capability is first-class — P0

Canonical workout/session definitions must declare required equipment. Planning must reject or substitute a station session when required sled/SkiErg/rower/wall-ball/carry/lunge capabilities are unavailable.

P0 does not need to fake every official station. It does need genuinely executable station-focused and compromised-running options plus honest alternatives.

### F10 — custom event must stay generic — P0

`other_event/custom` is an escape hatch, not an inference engine. It receives no HYROX-specific modality bonus, coverage set, event plan or taper by title/prose inference.

### F11 — knowledge and policy counts must not drift — P0

The current knowledge claim explicitly refers to 19 preset vectors. Adding `hyrox_open_singles` and `custom` yields 21 entries if all authored presets are counted. Prefer structural registry validation over a brittle literal count.

Decision-affecting demand/taper/coverage/ranking changes require a `POLICY_VERSION` bump under ADR-0010. Behavior and provenance ship together.

### F12 — this needs an ADR — P0

The feature changes canonical event identity, semantic resolution, event-specific plan authority and multi-event coverage composition. ADR-0001 therefore requires a durable architecture record. Proposed ADR-0048 is part of this PR.

## 4. Recommended event model

### 4.1 Root taxonomy

```ts
type EventCategory =
  | 'running_race'
  | 'cycling_event'
  | 'triathlon'
  | 'strength_meet'
  | 'fitness_race'
  | 'other_event'
  | 'general_target';
```

`general_target` remains a dated non-competition target. `other_event` is the generic competition escape hatch.

### 4.2 Format identity

Add a stable downstream field to `UserEvent`, for example:

```ts
presetId?: string;
```

`goalToUserEvent` copies the validated `UserGoal.eventPreset` into `presetId`.

### 4.3 Canonical preset semantics

Extend the descriptor beyond a demand vector:

```ts
interface EventPresetDefinition {
  id: string;
  label: string;
  demandProfile: EventDemandProfile;
  specificModalities: SessionTemplate['modality'][];
  supportLevel: 'specific' | 'generic';
  taperPolicyId: EventTaperPolicyId;
  coverageSetId?: CoverageSetId;
  planPolicyId?: EventPlanPolicyId;
}
```

Exact type names may differ; the invariant is one source of truth.

Initial entries:

- `fitness_race / hyrox_open_singles` — specifically supported, with fitness-race plan/coverage/taper metadata;
- `other_event / custom` — generic support, empty specific-modality set, no format-specific plan/coverage policy.

## 5. HYROX Open Singles demand interpretation

The existing seven demand axes can describe high-level physiology without adding new axes in P0:

- high aerobic endurance;
- high threshold / sustainable high-aerobic demand;
- moderate-high VO2max demand;
- high repeated-surges / transition demand;
- modest pure sprint importance;
- high fatigue resistance;
- high neuromuscular demand.

Exact normalized values are product calibration. The missing semantics are not another scalar axis; they are **session morphology, exact role coverage and event-relative timing**.

## 6. Cross-check against the active athlete plan

The supplied 2026–2027 cycling-primary hybrid plan treats HYROX Warsaw as a secondary event while preserving the August cycling A-race as the primary season target. It deliberately requires:

- October–January: running robustness/station familiarity only;
- protected cycling VO2 work through early February;
- February: transition toward roughly two running exposures plus skills;
- March: main HYROX-specific block, with three runs only if mechanically tolerated;
- HYROX work **replaces** cycling/generic assistance rather than stacking on top;
- one real strength exposure remains;
- partial simulations are preferred to repeated full simulations;
- after HYROX, cycling regains full priority quickly;
- exact Warsaw race day remains provisional.

A product architecture in which only the global focus event can own exact coverage cannot reproduce that plan: the later cycling A-race may remain focus while March still needs exact HYROX roles. The bounded secondary-event overlay is therefore an architecture requirement, not athlete-specific hardcoding.

The athlete-specific choices above must remain authored plan intent. Product defaults should provide the capability, not force this exact cycling/HYROX priority pattern on every user.

## 7. Scope boundary

P0 should make one fitness-race format correct end-to-end. It should not model every HYROX division or every branded fitness race.

Deferred:

- HYROX Pro;
- HYROX Doubles;
- HYROX Relay;
- adaptive divisions;
- other fitness-race brands;
- automatic schedule/wave import.

Each future format can reuse the root category while supplying distinct preset metadata, coverage and executable prescriptions.

## 8. Acceptance bar for the implementation PR

P0 is complete only when all are true:

1. HYROX Open Singles is selectable and round-trips through persistence.
2. `UserEvent` retains format identity.
3. A provisional HYROX Warsaw fixture uses `EventTiming`; no test calls 10 April confirmed by default.
4. Canonical event semantics are resolved in one place and consumed by periodization and optimizer event-focus logic.
5. Fitness-race specificity is exact coverage, not invented from stimulus/category.
6. A HYROX-specific `PlanDefinition` exists for the supported format.
7. A supported secondary HYROX event can activate exact coverage during its plan window while a later cycling A-event remains global focus.
8. Secondary-event coverage enters the normal feasibility/capacity allocator and replaces lower-priority work rather than blindly adding sessions.
9. At least one compromised-running and one station-focused catalog workout are executable through canonical workout -> `SessionDefinition` -> `ExecutionPrescription`.
10. Equipment/time/readiness gates can reject or scale those sessions without counterfeit role fulfilment.
11. Generic `other_event/custom` receives no HYROX-specific semantics.
12. Explicit authored taper still overrides product defaults.
13. SKR lineage is updated and `POLICY_VERSION` changes atomically with behavior.
14. Existing event categories remain behaviorally unchanged in regression tests.
15. `npm run check` and repository CI are green.

## References

Repository architecture:

- `docs/adr/0001-record-architecture-decisions.md`
- `docs/adr/0004-workout-library-architecture.md`
- `docs/adr/0007-adaptive-multisport-engine-architecture.md`
- `docs/adr/0010-decision-provenance-and-audit-replay.md`
- `docs/adr/0012-plan-intent-authority.md`
- `docs/adr/0016-adaptation-credit-and-weekly-coverage.md`
- `docs/adr/0023-multidomain-session-authoring-execution-and-evidence.md`
- `docs/adr/0033-sports-knowledge-registry.md`
- `app/src/engine/models.ts`
- `app/src/engine/eventPresets.ts`
- `app/src/engine/periodization.ts`
- `app/src/engine/optimizer.ts`
- `app/src/engine/planSchedule.ts`
- `app/src/engine/taperPolicy.ts`
- `app/src/workouts/event-plan.ts`
- `app/src/components/Goals.tsx`

External:

- HYROX Warsaw 2026/27 event page: <https://hyrox.com/event/hyrox-warsaw-26-27/>
- HYROX race-format page: <https://hyrox.com/the-fitness-race/>
- Wang et al. endurance taper systematic review/meta-analysis: <https://pubmed.ncbi.nlm.nih.gov/37163550/>
