# Event taxonomy recon — fitness-race / HYROX support

| | |
|---|---|
| **Type** | Point-in-time architecture analysis (`docs/analysis`: what is true today) |
| **Date** | 2026-10-05 |
| **Scope** | Event taxonomy, HYROX Open Singles, event timing, periodization, coverage, executable sessions, taper, knowledge lineage, UI/persistence |
| **Decision record** | Proposed ADR-0048: `docs/adr/0048-event-taxonomy-and-format-semantics.md` |
| **Implementation plan** | `docs/plans/2026-10-05-event-taxonomy-fitness-race-hyrox.md` |

## Executive summary

The repository can represent endurance races, triathlon, strength meets and generic targets, but it cannot represent a fitness race honestly. Adding only a `fitness_race` enum member is insufficient because event semantics are currently scattered across `eventPresets.ts`, `periodization.ts`, `optimizer.ts`, `taperPolicy.ts`, `Goals.tsx`, coverage descriptors and the sports-knowledge registry.

The HYROX motivating case also exposes two existing architecture boundaries that the first draft of this analysis did not respect strongly enough:

1. **Uncertain event dates already have a domain model.** `EventTiming` carries `earliestDate`, `latestDate`, `planningDate` and optional `confirmedDate`; ADR-0012 says that model is already validated, persisted and propagated to `UserEvent`. The missing piece is UI support. The Warsaw 2027 Men/Open date is currently provisional, so a literal `2027-04-10` must not be treated as confirmed.
2. **Event-specific session morphology belongs to the coverage ledger, not the adaptation ledger.** ADR-0016 deliberately separates physiological stimulus credit from exact programming-role fulfilment. A compromised run and a station-endurance session are programming roles. They must be satisfied by exact canonical workout/session identities, not inferred from generic Running/Strength stimulus.
3. **HYROX sessions are multidomain.** ADR-0023 makes `SessionDefinition` plus frozen `ExecutionPrescription` the source-neutral executable boundary for composite training. A run-station workout must not be flattened into a single-modality `SessionTemplate` and treated as fully represented.

The recommended P0 is therefore a small but end-to-end vertical slice:

- add root categories `fitness_race` and `other_event`;
- add a first-class preset/format `hyrox_open_singles` and an honest `custom` fallback;
- retain the selected preset identity on `UserEvent` so downstream consumers can distinguish formats within a root category;
- centralize event semantics in one resolver rather than adding more category switches;
- add an event-relative HYROX coverage set and `PlanDefinition` path for exact fitness-race roles;
- add canonical HYROX workout/session definitions that adapt into ADR-0023 `SessionDefinition` and resolve to executable prescriptions;
- expose `EventTiming` in the goal UI so provisional multi-day events can be entered accurately;
- add a named fitness-race taper policy only as explicit product calibration with knowledge lineage;
- update the Sports Knowledge Registry and `POLICY_VERSION` atomically with decision-affecting behavior.

## 1. External/source facts for the motivating case

### 1.1 HYROX Warsaw 2027

The official HYROX Warsaw event page currently states:

- event window: **7–11 April 2027**;
- venue: **PGE Narodowy, Warsaw**;
- the published schedule is **provisional**;
- `HYROX MEN` is currently listed on **7, 8, 9 and 10 April**;
- individual start times are linked only shortly before the event.

Source: <https://hyrox.com/event/hyrox-warsaw-26-27/>

Therefore `2027-04-10` is a possible Men/Open date, not a confirmed event date. The product should preserve the uncertainty rather than encode one provisional day as truth.

### 1.2 Race morphology

HYROX describes the individual race as eight 1 km runs interleaved with eight functional stations. Open and Pro are separate divisions; Open uses the standard loads, while Pro increases selected station loads. The station sequence includes SkiErg, sled push, sled pull, burpee broad jumps, rowing, farmer carry, sandbag lunges and wall balls.

Source: <https://hyrox.com/the-fitness-race/>

This is materially different from a running race, strength meet, cycling event or triathlon. It combines locomotion, repeated transitions, loaded locomotion, grip, local muscular endurance and whole-body conditioning.

## 2. Current repository state

### 2.1 Event category and timing model

`app/src/engine/models.ts` currently defines:

```ts
category:
  | 'running_race'
  | 'cycling_event'
  | 'triathlon'
  | 'strength_meet'
  | 'general_target';
```

`UserEvent` has `EventTiming`, but it does **not** retain the event preset/format selected by the goal. `goalToUserEvent` resolves the preset into a demand vector and then loses the preset identity.

That loss is acceptable while every root category has effectively one downstream semantic family. It becomes wrong once `fitness_race` may contain HYROX Open, HYROX Pro, doubles, DEKA-like formats or future fitness races with different station/load morphology.

### 2.2 Presets

`app/src/engine/eventPresets.ts` currently contains 19 authored presets across the five root categories. A preset contains only:

- `id`;
- `label`;
- `demandProfile`.

`resolveDemandProfile(category, preset)` is therefore only a demand-vector resolver. It cannot be the single authority for:

- event-specific modalities;
- taper policy;
- coverage set / plan builder;
- support level (`specific` vs `generic`);
- executable session family.

### 2.3 Duplicated event semantics

Category semantics are reimplemented in several places:

- `eventPresets.ts` — preset/demand selection;
- `periodization.ts` — `modalitiesForEventCategory` and category-specific objectives;
- `optimizer.ts` — category-to-modality event-focus bonus;
- `taperPolicy.ts` — category/priority taper branches;
- `Goals.tsx` — category labels and category/preset inputs;
- `planSchedule.ts` — only cycling events get a generated event-relative `PlanDefinition`;
- `workouts/event-plan.ts` — exact programming-role coverage sets.

Adding `fitness_race` independently to each switch would compile, but it would deepen semantic drift.

### 2.4 Structured plan authority

ADR-0012 establishes:

> explicit `PlanDefinition` authority > generic days-to-event fallback.

Today `resolvePlanDefinitionForEvent` returns a generated event-relative plan only for `cycling_event`. Every other event remains on generic demand-derived fallback.

That is inadequate for HYROX-specific programming roles because exact role fulfilment cannot be expressed honestly through demand vectors alone.

### 2.5 Adaptation and coverage are intentionally different

ADR-0016 is the critical boundary for this feature:

- `WeeklyObjective` / stimulus credit answers **what adaptation was accumulated**;
- coverage answers **which explicitly required programming role was performed**;
- coverage is exact-identity based;
- modality/category/stimulus must not invent coverage.

Therefore these are **coverage concepts** first:

- compromised running;
- station strength-endurance / station-specific work;
- fitness-race simulation / run-station combination;
- fitness-race race day.

They should not be introduced primarily as new `ObjectiveKey` values merely to stop a generic run plus generic strength session from substituting for a combined session. Doing so would recreate the coupling ADR-0016 removed.

### 2.6 Executable session architecture

ADR-0004 requires every selectable engine template to resolve to a detailed canonical workout prescription.

ADR-0023 goes further: `SessionDefinition` is the source-neutral executable boundary for structured strength, power, speed, field, conditioning, recovery, skill and composite sessions. Catalog workouts adapt into this boundary and execution uses a frozen `ExecutionPrescription`.

A HYROX compromised-running workout is inherently composite. P0 therefore needs both:

1. an engine/catalog identity that can be ranked, costed and credited; and
2. a normalized multidomain executable definition/prescription that represents the ordered run/station work without parsing prose at execution time.

Adding rows only to `engine/templates.ts` would be architecturally incomplete.

### 2.7 Taper

`resolveEventTaper` currently uses:

- explicit authored taper first;
- a cycling-A special case;
- otherwise a generic priority fallback for non-`general_target` events (`A=14 d`, `B=5 d`, `C=0`).

A `fitness_race` branch may need different calibration, but the important architecture rule is that the value must be a named, reviewable policy rather than an implicit category side effect. The user's explicit taper must remain highest authority.

The endurance taper literature supports reduced volume while maintaining intensity/frequency, but it does not validate a HYROX-specific exact day count. Any initial HYROX number is therefore product calibration and belongs in the Sports Knowledge Registry as such.

### 2.8 Goal UI cannot express provisional windows

ADR-0012 already documents this gap: `EventTiming` is generic and production-wired, while `Goals.tsx` still collects one `targetDate`.

For HYROX Warsaw this matters immediately. The UI needs a minimal choice between:

- confirmed single date; or
- provisional date window.

The persisted `targetDate` remains the compatible planning date, while `timing` carries the explicit window and confirmation state. `planningDate` must follow the existing `EventTiming` invariant and become the confirmed date once confirmation exists.

## 3. Architecture findings

### F1 — fixed 10 April acceptance is factually and architecturally wrong — P0

The official event window is 7–11 April and Men/Open is currently provisional on 7–10 April. The motivating fixture must use `EventTiming`; it must not claim 10 April is confirmed.

### F2 — downstream format identity is lost — P0

`UserGoal.eventPreset` is resolved to a demand vector and discarded. A new root category with multiple future formats requires a stable `UserEvent.presetId` (or equivalent) so taper/coverage/optimizer semantics do not infer format from a demand vector.

### F3 — another category-only switch would violate single-authority design — P0

Introduce one canonical resolver for persisted category+preset metadata. Existing consumers should call it or receive its result, instead of adding independent `fitness_race` switch branches.

### F4 — compromised running is a coverage role, not a new adaptation axis — P0

Use exact coverage keys/requirements. Existing physiological objective axes remain the adaptation ledger unless a genuinely new physiological construct is separately justified.

### F5 — fitness-race needs a generated PlanDefinition — P0

A HYROX-specific coverage contract cannot be enforced by the generic periodization fallback. Add a `fitness_race`/`hyrox_open_singles` plan builder with event-relative build/specificity/taper/race/recovery blocks and exact coverage requirements.

The initial block boundaries are product calibration. They must be named, tested and registered as policy, not presented as universal physiology.

### F6 — HYROX composite sessions must cross the ADR-0023 boundary — P0

Catalog templates alone are insufficient. Canonical run-station workouts must resolve to reviewed executable definitions and immutable prescriptions.

### F7 — exact workout coverage is required — P0

Add a dedicated coverage set rather than allowing generic Running + generic Strength to satisfy fitness-race specificity. Useful new roles include at minimum:

- `fitness_race_station_work`;
- `fitness_race_compromised_run`;
- `fitness_race_specific_simulation`;
- `fitness_race_race_day`.

Existing roles such as `aerobic_volume`, `primary_strength` and `recovery_or_rest` should be reused where their meaning is genuinely identical.

### F8 — equipment capability is first-class — P0

The canonical workout/session layer must declare the equipment required for each station-specific option. The planner must be able to reject or substitute a session when a sled, SkiErg, rower, wall-ball setup or suitable carry/lunge equipment is unavailable.

P0 does not need to fake every official station if the catalog cannot execute it safely. It does need at least one genuinely executable compromised-running session and one station-focused session, plus honest alternatives.

### F9 — custom event must stay generic — P0

`other_event/custom` is an escape hatch, not an inference engine. It should have:

- generic demand only;
- no specific modality bonus;
- no HYROX coverage set;
- no HYROX-specific taper;
- no title/prose parsing.

If a generic priority-based competition taper is intentionally retained, call it exactly that and test it. Do not represent it as format-specific knowledge.

### F10 — knowledge and policy counts must not drift — P0

The current knowledge claim explicitly refers to 19 preset vectors. Adding both `hyrox_open_singles` and `custom` yields **21 registry entries** if the claim continues to count all authored presets. A safer amendment is to stop relying on a brittle literal count and validate registry membership/lineage structurally.

Decision-affecting changes to demand, taper, coverage or ranking require a `POLICY_VERSION` bump under ADR-0010. Knowledge claims and policy identity must ship in the same merge as the behavior they justify.

### F11 — the architecture decision needs an ADR — P0

This feature changes canonical event identity, semantic resolution and plan/coverage authority. ADR-0001 requires a durable architecture record. This review therefore adds proposed ADR-0048 rather than leaving the decision only in analysis prose.

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

`goalToUserEvent` copies the validated `UserGoal.eventPreset` into `presetId` and resolves semantics once.

### 4.3 Canonical preset semantics

Extend the preset descriptor beyond a demand vector:

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

The exact type names may differ, but one resolver must own this information.

Initial entries:

- `fitness_race / hyrox_open_singles` — specific support, Running + Strength + Cross Training semantics, HYROX coverage/plan/taper policy;
- `other_event / custom` — generic support, empty specific-modality set, no format-specific coverage.

## 5. HYROX Open Singles demand interpretation

The existing seven demand axes can describe the high-level physiology without adding new axes in P0:

- high aerobic endurance;
- high threshold power / sustainable high aerobic output;
- moderate-high VO2max demand;
- high repeated-surges / transition demand;
- modest pure sprint importance;
- high fatigue resistance;
- high neuromuscular demand.

Exact normalized values are product calibration. They must be registered as policy and must not be presented as direct scientific measurements.

The missing semantics are not another scalar axis; they are **session morphology** and exact role coverage.

## 6. Cross-check against the active athlete plan used for this review

The supplied 2026–2027 cycling-primary hybrid plan treats HYROX Warsaw as a secondary event and deliberately preserves these constraints:

- October–January: only running robustness/station familiarity;
- protected cycling VO2 work through early February;
- February: transition toward roughly two run exposures plus skills;
- March: main HYROX-specific block, with three runs only if mechanically tolerated;
- HYROX work replaces cycling/generic assistance rather than stacking on top;
- one real strength exposure remains;
- partial simulations are preferred to repeated full simulations;
- after HYROX, cycling regains priority quickly;
- exact Warsaw race day is still provisional.

The product feature must be capable of representing this architecture. It must not hardcode those athlete-specific priorities as universal HYROX defaults.

## 7. Scope boundary

P0 should make one fitness-race format correct end-to-end. It should **not** attempt to model every HYROX division or every branded fitness race.

Deferred formats may include:

- HYROX Pro;
- HYROX Doubles;
- HYROX Relay;
- adaptive divisions;
- other fitness-race brands.

Each may reuse the root category while supplying different preset metadata, coverage and executable station prescriptions.

## 8. Acceptance bar for the implementation PR

P0 is complete only when all of the following are true:

1. HYROX Open Singles is selectable and round-trips through persistence.
2. The downstream `UserEvent` retains format identity.
3. A provisional HYROX Warsaw fixture can be represented with `EventTiming`; no test calls 10 April a confirmed day.
4. Canonical event semantics are resolved in one place and consumed by periodization **and** optimizer focus-modality logic.
5. Fitness-race specificity is expressed with exact coverage roles, not invented from stimulus/category.
6. A HYROX-specific `PlanDefinition` exists for the supported preset.
7. At least one compromised-running and one station-focused catalog workout are executable through the canonical workout -> `SessionDefinition` -> `ExecutionPrescription` path.
8. Equipment/time/readiness gates can reject or scale those sessions without losing role identity.
9. Generic `other_event/custom` receives no HYROX-specific semantics.
10. Explicit authored taper still overrides product defaults.
11. SKR lineage is updated and `POLICY_VERSION` changes atomically with behavior.
12. Existing event categories remain behaviorally unchanged in regression tests.
13. `npm run check` and repository CI are green.

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
