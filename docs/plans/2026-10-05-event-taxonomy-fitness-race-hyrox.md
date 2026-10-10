# Event taxonomy + HYROX fitness-race implementation plan

| | |
|---|---|
| **Status** | Ready for P0 implementation after review/acceptance of ADR-0048 |
| **Date** | 2026-10-05 |
| **Analysis** | `docs/analysis/2026-10-05-event-taxonomy-fitness-race-hyrox.md` |
| **Architecture decision** | `docs/adr/0048-event-taxonomy-and-format-semantics.md` |
| **P0 supported format** | HYROX Open Singles (`hyrox_open_singles`) |
| **Compatibility requirement** | Existing event categories and decisions remain unchanged unless explicitly covered below |

## 1. Goal

**2026-10-10 goal-entry slice:** HYROX Open Singles can be created, edited and persisted as
`fitness_race / hyrox_open_singles`, with format identity retained in `UserEvent.presetId`.
The UI explicitly discloses generic training/taper guidance. This slice reuses the existing
generic demand and priority-based competition taper; it does not implement the P0 planning
system below. ADR-0048 remains proposed, and its acceptance-dependent format-specific
calibration, centralized semantics, exact coverage, generated plans and multidomain sessions
remain pending. The generic interim registration is not the proposed specifically supported P0 format.

Deliver the smallest end-to-end product slice that can represent and plan a fitness race honestly without weakening existing architecture contracts.

P0 must support:

- root `fitness_race` and `other_event` categories;
- HYROX Open Singles as a first-class format/preset;
- an honest `other_event/custom` fallback;
- provisional event windows through existing `EventTiming`;
- downstream preservation of format identity;
- centralized event semantics;
- exact fitness-race programming-role coverage;
- a generated HYROX event-relative `PlanDefinition`;
- **bounded exact coverage from a supported secondary event while a different event remains global focus**;
- executable multidomain run/station sessions;
- equipment-aware eligibility/degradation;
- explicit plan/taper calibration with knowledge lineage;
- regression-safe behavior for all existing categories.

P0 does not need HYROX Pro, Doubles, Relay or every station combination.

## 2. Non-negotiable architecture constraints

### A. Event timing authority

Use existing `EventTiming`:

```ts
interface EventTiming {
  earliestDate: string;
  latestDate: string;
  planningDate: string;
  confirmedDate?: string;
}
```

`planningDate` remains the planning/taper anchor until a confirmed date exists. The UI must not force a provisional multi-day event into a fake confirmed date.

### B. Plan authority

ADR-0012 remains in force:

```text
explicit PlanDefinition
  > generic days-to-event fallback
```

HYROX Open gets a generated event-relative `PlanDefinition` because exact fitness-race programming roles cannot be expressed through demand vectors alone.

### C. Dual ledgers

ADR-0016 remains in force:

```text
adaptation ledger = physiological stimulus/objectives
coverage ledger   = exact programming roles
```

Do not add `compromised_running` or `station_strength_endurance` as `ObjectiveKey`s merely to force session shape. Those are coverage requirements backed by exact workout identity.

### D. Executable-session authority

ADR-0004 and ADR-0023 remain in force:

```text
engine/catalog candidate
  -> canonical WorkoutDefinition
  -> normalized SessionDefinition
  -> frozen ExecutionPrescription
```

A selectable HYROX candidate must be executable through that path. No prose parsing and no template-only dead end.

### E. Multi-event authority

Keep one global focus event for season-level adaptation/ranking authority. Do **not** promote a secondary HYROX event to focus merely because its specific block has started.

Instead, a specifically supported scheduled event may contribute a bounded **structured-plan coverage overlay** when its registered plan window is active.

Overlay rules:

- exact coverage only comes from a registered plan/coverage set;
- overlay requirements enter the existing weekly feasibility/capacity/coverage allocation path;
- they are not appended after the weekly plan has been built;
- lower-priority optional/generic volume is displaced first when capacity is constrained;
- safety, explicit authored plan/taper/recovery constraints and infeasibility rules stay higher authority;
- conflicts are resolved deterministically inside existing allocation logic using urgency, event priority and coverage criticality;
- no second optimizer is introduced;
- overlay authority expires after its event/recovery window.

This is required for a secondary April HYROX event to receive exact March programming while an August cycling A-race remains the season focus.

### F. Knowledge/provenance authority

Numeric demand vectors, block boundaries, taper duration and role counts are product calibration unless directly evidenced. Register them under ADR-0033. Any decision-affecting implementation merge bumps `POLICY_VERSION` under ADR-0010.

## 3. Fixed P0 product decisions

### D1 — root taxonomy

Add:

```ts
'fitness_race'
'other_event'
```

Keep `general_target` separate: it is a dated non-competition target; `other_event` is a generic competition/event escape hatch.

### D2 — first supported formats

Add:

- `fitness_race / hyrox_open_singles` — specifically supported;
- `other_event / custom` — generic fallback only.

Do not infer event type from title/description text.

### D3 — preserve downstream preset identity

Add a stable field to `UserEvent`, preferably:

```ts
presetId?: string;
```

`goalToUserEvent` copies the validated `UserGoal.eventPreset`. Downstream semantics must not reverse-engineer format identity from `demandProfile`.

### D4 — one canonical semantics resolver

Extend the preset descriptor or add a sibling descriptor so one resolver owns:

```ts
interface ResolvedEventSemantics {
  presetId: string;
  demandProfile: EventDemandProfile;
  specificModalities: SessionTemplate['modality'][];
  supportLevel: 'specific' | 'generic';
  taperPolicyId: EventTaperPolicyId;
  coverageSetId?: CoverageSetId;
  planPolicyId?: EventPlanPolicyId;
}
```

Exact names may differ. The invariant is one source of truth.

### D5 — HYROX specificity is coverage

Add exact coverage roles, not fake physiological axes:

```ts
'fitness_race_station_work'
'fitness_race_compromised_run'
'fitness_race_specific_simulation'
'fitness_race_race_day'
```

Reuse existing roles such as `aerobic_volume`, `primary_strength` and `recovery_or_rest` where their semantics truly match.

### D6 — HYROX Open gets an explicit generated plan

Initial named product calibration:

- plan active **56 days before** `event.timing?.planningDate ?? event.date`;
- main fitness-race specificity from **28 days before**;
- default taper begins **7 days before** unless explicit authored taper overrides;
- post-event recovery block through **D+7**.

These are not universal physiology constants. Register and test them by policy identity.

### D7 — supported secondary-event coverage is bounded, not stacked

When `hyrox_open_singles` is a secondary event and its D-56..D+7 plan window is active:

- its adaptation demand may continue to participate through existing multi-event objective logic;
- its exact coverage requirements become an event-plan overlay;
- the overlay competes for the same weekly slots/load budget as focus-event/generic work;
- it may displace optional endurance/generic assistance before protected higher-authority work;
- it does not change `focusEventId` solely to gain coverage authority;
- after D+7, its exact overlay disappears.

### D8 — custom stays generic

`other_event/custom` has:

- generic demand calibration;
- no specific modality bonus;
- no format-specific coverage set;
- no format-specific plan builder;
- no HYROX taper policy;
- no title parsing.

If the existing generic A/B/C taper fallback applies, document/test it as generic competition policy.

### D9 — behavior and provenance ship atomically

The first merge that activates fitness-race behavior also contains:

- SKR claims/sources;
- `POLICY_VERSION` bump;
- policy history/drift fixture updates;
- ADR/documentation updates.

## 4. Work packages

## WP0 — freeze the contract with tests before behavior

### WP0.1 Existing category regression matrix

For every current category/preset assert:

- demand vector unchanged;
- specific modality set unchanged;
- taper result unchanged;
- goal -> event conversion unchanged except additive `presetId`;
- optimizer focus-modality behavior unchanged;
- existing coverage/plan behavior unchanged.

Prefer fixture/snapshot parity where appropriate.

### WP0.2 HYROX Warsaw timing fixture

Do **not** use `2027-04-10` as confirmed by default.

```ts
timing: {
  earliestDate: '2027-04-07',
  latestDate: '2027-04-11',
  planningDate: '2027-04-07',
  // no confirmedDate
}
```

Add a second test where the user later confirms `2027-04-10` and `planningDate` moves accordingly. Future plan/taper dates move deterministically; historical recommendation records are not rewritten.

### WP0.3 Multi-event authority fixture

Create at least:

- April 2027 HYROX Open Singles as a **secondary** event;
- August 2027 cycling event with priority A.

Assert:

- August cycling remains the global focus event under existing focus selection;
- inside the March HYROX plan window, exact HYROX coverage requirements are active;
- those requirements consume existing weekly capacity rather than increasing the schedule unboundedly;
- after HYROX recovery ends, HYROX exact coverage disappears and cycling-only specificity resumes.

### WP0.4 Custom-event negative fixture

Assert `other_event/custom` has no HYROX modality, coverage or plan semantics.

## WP1 — event identity and preset semantics

Primary files:

- `app/src/engine/models.ts`
- `app/src/engine/eventPresets.ts`
- `app/src/engine/periodization.ts`
- tests/validation

### WP1.1 Expand `UserEvent['category']`

Add `fitness_race` and `other_event`.

Update exhaustive `Record<UserEvent['category'], ...>` and switches. Do not hide missing categories behind broad defaults where exhaustiveness is useful.

### WP1.2 Add `UserEvent.presetId`

Populate from validated `UserGoal.eventPreset`.

Compatibility:

- old goals without explicit preset use existing category default;
- existing category behavior does not change;
- persisted authority remains the goal, so no unnecessary runtime-event migration.

### WP1.3 Canonical event semantics

Move demand + specific modalities + support level + taper/coverage/plan policy IDs under one resolver.

Keep a compatibility `resolveDemandProfile` wrapper if useful, but implement it through canonical semantics.

### WP1.4 P0 presets

`hyrox_open_singles`:

- category: `fitness_race`;
- support: `specific`;
- specific modalities: Running, Strength, Cross Training at engine-routing level;
- HYROX plan/coverage/taper policy IDs.

`custom`:

- category: `other_event`;
- support: `generic`;
- empty specific-modality set;
- no format-specific plan/coverage policy.

## WP2 — consume canonical semantics everywhere

Primary files:

- `app/src/engine/periodization.ts`
- `app/src/engine/optimizer.ts`
- `app/src/engine/taperPolicy.ts`
- tests

### WP2.1 Periodization

Retire category-only modality mapping as semantic authority. Resolve specific modalities from format semantics.

Demand-derived adaptation objectives continue to use existing `ObjectiveKey`s.

### WP2.2 Optimizer focus bonus

Replace optimizer's duplicated category-to-modality table with resolved event semantics. Regression-test all existing categories.

### WP2.3 Taper

Selection order stays:

1. explicit authored `event.taper.startDate`;
2. supported format-specific taper policy;
3. existing category/generic fallback where applicable;
4. no taper.

Register HYROX Open's 7-day P0 default as product calibration rather than burying a literal branch.

## WP3 — fitness-race coverage, PlanDefinition and multi-event overlay

Primary files:

- `app/src/workouts/event-plan.ts`
- `app/src/engine/planSchedule.ts`
- weekly coverage/allocation orchestration
- tests

### WP3.1 Extend coverage vocabulary

Add:

- `fitness_race_station_work`;
- `fitness_race_compromised_run`;
- `fitness_race_specific_simulation`;
- `fitness_race_race_day`.

Add a coverage set such as `hyrox_open_fitness_race`.

### WP3.2 Add `HYROX_OPEN_COVERAGE_SET`

Map new roles only to exact HYROX-capable workout IDs. Generic Running must not satisfy compromised running; generic Strength must not satisfy station work.

### WP3.3 Add `buildFitnessRaceEventPlan`

For `fitness_race + hyrox_open_singles` generate:

```text
D-56 .. D-29  build / transition
D-28 .. D-8   peak / fitness-race specificity
D-7  .. D-1   taper
D0             race
D+1 .. D+7    recovery
```

Explicit taper start overrides D-7 and boundaries adjust consistently.

Use:

- existing adaptation objectives for aerobic/quality/strength stimulus;
- coverage-only requirements for session morphology where no honest standalone physiological axis exists.

### WP3.4 Add active supported-event overlays

Add one orchestration function (name illustrative), e.g.:

```ts
resolveActiveEventPlanOverlays(events, asOf): ActiveEventPlanOverlay[]
```

Rules:

- only specifically supported events with a registered `PlanDefinition` participate;
- the global focus event's plan remains primary structured authority;
- non-focus overlays expose bounded coverage requirements and any explicitly allowed plan metadata, not an independent optimizer result;
- deduplicate semantically identical coverage roles;
- preserve event/role provenance so diagnostics explain which event required a slot;
- feed merged requirements into existing coverage feasibility/allocation;
- when infeasible, resolve/degrade according to existing capacity/coverage policy rather than adding a session beyond capacity;
- secondary overlay must never silently override explicit recovery/taper/safety constraints;
- overlay expires at the plan's end.

### WP3.5 Weekly-role calibration

P0 should remain conservative and executable.

**Build/transition:** preserve aerobic work + one real strength role; station work may be a target, not a compulsory extra hard day.

**Specificity:** one compromised-running role/week minimum when admissible; one station-work role/week target; partial simulation optional/target rather than weekly full rehearsal; one real strength role remains.

**Taper:** no high-DOMS station-volume requirement; retain only a small exact specificity touch when appropriate; freshness/recovery dominate.

Counts are product calibration. If capacity/equipment makes the role set impossible, fail/degrade honestly under existing coverage rules.

## WP4 — canonical workouts and multidomain execution

Primary files:

- `app/src/engine/templates.ts`
- `app/src/workouts/*`
- `app/src/sessions/*`
- catalog/session validators and fixtures

### WP4.1 Minimum executable workout set

Add at least:

1. station-focused technique/endurance session;
2. compromised-running session with ordered run/station transitions;
3. partial fitness-race simulation or reduced equivalent;
4. race-day/session identity if required for coverage/audit.

P0 does not need one workout per official station.

### WP4.2 Canonical mapping

Every selectable engine template resolves to an active canonical workout through current catalog routing. Every selectable canonical workout adapts to a valid ADR-0023 `SessionDefinition` and deterministic `ExecutionPrescription`.

CI must fail if a selectable template has no executable prescription.

### WP4.3 Preserve composite structure

A compromised-running workout cannot be merely `modality = Cross Training` plus prose. Normalized execution must retain ordered run/station blocks, doses, transitions/rest and equipment requirements.

### WP4.4 Equipment

Audit current `EquipmentKey` vocabulary before adding keys. Add only missing capabilities required by P0, likely among sled, SkiErg, rower, wall-ball/target setup, carry loads and sandbag.

Missing required equipment must make a candidate ineligible or choose an explicitly authored alternative. It must not counterfeit exact coverage.

### WP4.5 Reduced/return variants

Reduced prescriptions preserve exact role identity only when the authored coverage mapping says they do. Do not infer coverage from stimulus/category.

## WP5 — Goal UI and persistence for provisional events

Primary files:

- `app/src/components/Goals.tsx`
- `app/src/services/goalService.ts`
- `app/src/engine/validation.ts`
- persistence/rules tests if shape changes

### WP5.1 Category/preset UI

Expose:

- Fitness race -> HYROX Open Singles;
- Other event -> Custom event.

Existing labels remain unchanged.

### WP5.2 Event date mode

Add:

- **Confirmed date** — one date;
- **Provisional window** — earliest/latest.

For provisional windows validate `earliestDate <= latestDate`, persist no `confirmedDate`, and use the existing `EventTiming` invariant for `planningDate`.

### WP5.3 Display/countdowns

Display confirmed single date or provisional range. Countdown/planning labels use `timing.planningDate` when timing exists rather than blindly using `goal.targetDate`.

## WP6 — demand/taper/plan knowledge lineage

Primary files:

- `app/src/knowledge/periodizationEventDemandKnowledge.ts`
- relevant plan/taper knowledge modules
- sports-knowledge registry/validators

### WP6.1 Demand preset claim

Add HYROX Open as a product-calibrated demand profile. Official format facts support qualitative morphology, not normalized 0–1 scalars.

Do not naively change “19 presets” to “20” while also adding `custom`. Prefer structural registry validation; otherwise represent the correct 21 registry entries.

### WP6.2 Plan/taper claim

Register D-56/D-28/D-7/D+7 as `product_policy` (`evidenceCertainty = not_applicable` where schema requires). General taper evidence supports broad strategy, not a HYROX-specific seven-day optimum.

### WP6.3 Sources

Record at least:

- official HYROX Warsaw page;
- official HYROX race-format page;
- current endurance taper synthesis already used by the repository where applicable.

## WP7 — policy identity and docs

Because implementation can change persisted recommendations:

- bump global `POLICY_VERSION`;
- update policy history/drift fixtures;
- amend/supersede ADR-0007's local category-to-modality statement as needed;
- retain ADR-0048 as the primary decision record;
- do not silently rewrite accepted historical ADR responsibility boundaries.

## WP8 — end-to-end and regression tests

### Required unit tests

1. every root category has valid default/preset semantics;
2. preset IDs are unique within category;
3. unknown preset handling is explicit;
4. `goalToUserEvent` retains `presetId`;
5. existing 19 presets keep identical demand vectors;
6. existing event categories keep identical specific modalities;
7. optimizer focus-modality behavior is unchanged for legacy categories;
8. explicit taper overrides defaults;
9. HYROX policy resolves only for `fitness_race/hyrox_open_singles`;
10. custom event never resolves HYROX semantics.

### Required plan/coverage tests

1. HYROX coverage set validates against active canonical workout IDs;
2. generic Running cannot satisfy compromised running;
3. generic Strength cannot satisfy station work;
4. exact HYROX identities satisfy authored roles;
5. generated block dates move with `planningDate` confirmation;
6. authored taper reshapes taper block without overlap;
7. role requirements degrade honestly when capacity/equipment makes them infeasible;
8. post-event recovery is active only after the resolved event date;
9. secondary-event overlay activates only inside its plan window;
10. secondary-event coverage is allocated inside the existing weekly budget;
11. overlay expires after its recovery block.

### Required executable-session tests

1. every new selectable engine template resolves to active canonical workout;
2. each canonical HYROX workout adapts to valid `SessionDefinition`;
3. prescription hash is deterministic;
4. composite run/station order survives normalization;
5. missing equipment excludes the candidate;
6. reduced variants do not silently earn undeclared coverage.

### Required UI/service tests

1. Fitness race and Other event render;
2. preset choice round-trips;
3. provisional window round-trips;
4. invalid range is rejected;
5. countdown uses planning date;
6. confirmation updates `confirmedDate`/`planningDate` without losing preset identity.

### End-to-end acceptance fixture

Create:

```text
Event 1:
  Title: HYROX Warsaw 2027
  Category: Fitness race
  Format: HYROX Open Singles
  Timing: provisional 2027-04-07 .. 2027-04-11
  Priority: secondary (e.g. B)

Event 2:
  Title: 2027 cycling A-race
  Category: Cycling event
  Date: 2027-08-07 (or fixture equivalent)
  Priority: A
```

Assert:

- HYROX `presetId === 'hyrox_open_singles'`;
- HYROX semantics are specific;
- provisional `planningDate === '2027-04-07'` until confirmed;
- cycling A remains the global focus event under existing focus rules;
- March activates exact HYROX compromised-run/station coverage despite HYROX not being global focus;
- those roles consume the normal weekly capacity and displace lower-priority generic/optional work rather than increasing load without bound;
- ordinary running/strength stimulus cannot counterfeit those roles;
- generated HYROX sessions are executable and equipment-aware;
- explicit user taper overrides policy default;
- after HYROX D+7, the overlay disappears and cycling specificity resumes without persistent Running/Strength bias.

Then confirm HYROX date to `2027-04-10` and assert deterministic shift of future HYROX blocks/taper.

## 5. Delivery sequence

1. **WP0:** regression/contract tests.
2. **WP1:** category + downstream format identity + canonical semantics.
3. **WP2:** periodization/optimizer/taper consumers.
4. **WP3:** exact coverage + plan builder + bounded secondary-event overlay.
5. **WP4:** canonical executable HYROX sessions/equipment.
6. **WP5:** UI + provisional timing.
7. **WP6/WP7:** knowledge lineage + policy version + docs in the same decision-affecting merge.
8. **WP8:** full end-to-end matrix and CI.

Commits may be reviewable slices, but no deployable decision behavior should land without its policy/knowledge provenance.

## 6. CI / verification

At minimum:

```bash
npm run check
```

Also run suites covering:

- event preset/periodization parity;
- multi-event focus/overlay behavior;
- optimizer ranking/architecture;
- plan/coverage validators;
- workout catalog validation;
- session-definition/prescription validation;
- sports-knowledge validation;
- policy drift/replay;
- Goal UI/service persistence.

A frozen coverage hash/count failure is a prompt to review and intentionally update governed fixtures, not weaken the guard.

## 7. Out of scope for P0

- HYROX Pro;
- Doubles/Relay team semantics;
- adaptive division modeling;
- automatic official schedule/wave import;
- start-wave time planning;
- full-race simulation every week;
- prose classification of custom events;
- universal fitness-race ontology;
- new HYROX-specific adaptation axes without separate justification;
- hardcoding one athlete's cycling-vs-HYROX priority pattern as a global product default.

## 8. Implementation review checklist

- [ ] ADR-0048 accepted or explicitly superseded.
- [ ] Existing event behavior parity tests pass.
- [ ] No fixed 10-April Warsaw assumption remains.
- [ ] `EventTiming` is exposed for provisional windows.
- [ ] `UserEvent` retains format identity.
- [ ] Periodization and optimizer use the same event-semantics authority.
- [ ] HYROX session morphology is coverage-based, not stimulus-inferred.
- [ ] HYROX has an explicit event-relative `PlanDefinition`.
- [ ] A secondary supported event can contribute bounded exact coverage without becoming global focus.
- [ ] Secondary coverage competes inside existing weekly capacity; it is not stacked afterward.
- [ ] Composite sessions cross ADR-0023 executable boundary.
- [ ] Equipment gates are real and tested.
- [ ] Custom event stays generic.
- [ ] SKR claims do not overstate evidence.
- [ ] `POLICY_VERSION` advances with decision behavior.
- [ ] `npm run check` and GitHub CI are green.

## References

- Official HYROX Warsaw: <https://hyrox.com/event/hyrox-warsaw-26-27/>
- Official HYROX race format: <https://hyrox.com/the-fitness-race/>
- Taper meta-analysis: <https://pubmed.ncbi.nlm.nih.gov/37163550/>
- `docs/adr/0001-record-architecture-decisions.md`
- `docs/adr/0004-workout-library-architecture.md`
- `docs/adr/0007-adaptive-multisport-engine-architecture.md`
- `docs/adr/0010-decision-provenance-and-audit-replay.md`
- `docs/adr/0012-plan-intent-authority.md`
- `docs/adr/0016-adaptation-credit-and-weekly-coverage.md`
- `docs/adr/0023-multidomain-session-authoring-execution-and-evidence.md`
- `docs/adr/0033-sports-knowledge-registry.md`
