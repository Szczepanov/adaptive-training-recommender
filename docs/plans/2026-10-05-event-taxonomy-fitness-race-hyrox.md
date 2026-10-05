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

Deliver the smallest end-to-end product slice that can represent and plan a fitness race honestly without weakening existing architecture contracts.

P0 must support:

- a root `fitness_race` category;
- HYROX Open Singles as a first-class format/preset;
- an honest `other_event/custom` fallback;
- provisional event windows through the existing `EventTiming` model;
- centralized event semantics;
- exact fitness-race programming-role coverage;
- executable multidomain run/station sessions;
- explicit taper/plan calibration with knowledge lineage;
- regression-safe behavior for all existing categories.

P0 does **not** need to support HYROX Pro, Doubles, Relay or every station combination.

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

`planningDate` remains the date used by periodization/taper until a confirmed date exists. The UI must stop forcing a provisional multi-day event into a fake confirmed date.

### B. Plan authority

ADR-0012 remains in force:

```text
explicit PlanDefinition
  > generic days-to-event fallback
```

The supported HYROX format gets a generated event-relative `PlanDefinition` because it has exact programming-role requirements that generic demand vectors cannot express.

### C. Dual ledgers

ADR-0016 remains in force:

```text
adaptation ledger = physiological stimulus/objectives
coverage ledger   = exact programming roles
```

Do not add `compromised_running` or `station_strength_endurance` as `ObjectiveKey`s merely to force session morphology. Those are coverage requirements backed by exact workout identity.

### D. Executable-session authority

ADR-0004 and ADR-0023 remain in force:

```text
engine/catalog candidate
  -> canonical WorkoutDefinition
  -> normalized SessionDefinition
  -> frozen ExecutionPrescription
```

A selectable HYROX candidate must be executable through that path. No prose parsing and no template-only dead end.

### E. Knowledge/provenance authority

Any numeric demand vector, block boundary, taper duration or exact weekly role target introduced here is product calibration unless directly supported by evidence. Register it as such under ADR-0033. Any decision-affecting merge must bump `POLICY_VERSION` under ADR-0010.

## 3. Fixed P0 product decisions

### D1 — root taxonomy

Add:

```ts
'fitness_race'
'other_event'
```

Keep `general_target` separate: it is a dated non-competition target, while `other_event` is a competition/event escape hatch.

### D2 — first supported formats

Add:

- `fitness_race / hyrox_open_singles` — specifically supported;
- `other_event / custom` — generic fallback only.

Do not infer an event type from title/description text.

### D3 — preserve downstream preset identity

Add a stable internal field to `UserEvent`, preferably:

```ts
presetId?: string;
```

`goalToUserEvent` copies the validated `UserGoal.eventPreset` into this field. Downstream semantics must not attempt to reverse-engineer a format from `demandProfile`.

### D4 — one canonical semantics resolver

Replace independent category/preset interpretation with one resolver, for example:

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

resolveEventSemantics(category, presetId): ResolvedEventSemantics
```

Exact names may differ. The invariant is one source of truth.

### D5 — HYROX-specificity is coverage

Introduce exact coverage roles rather than new physiological axes. Minimum P0 roles:

```ts
'fitness_race_station_work'
'fitness_race_compromised_run'
'fitness_race_specific_simulation'
'fitness_race_race_day'
```

Reuse existing roles when semantics truly match:

- `aerobic_volume`;
- `primary_strength`;
- `recovery_or_rest`.

### D6 — HYROX Open gets an explicit generated plan

Initial named product calibration:

- plan becomes active **56 days before** `event.timing?.planningDate ?? event.date`;
- fitness-race specificity block begins **28 days before** the planning date;
- default taper begins **7 days before** the planning date unless an authored taper overrides it;
- post-event recovery block lasts **7 days**.

These are **not** universal physiological constants. Register them as a versioned product-policy claim and test them by policy ID.

The policy intentionally avoids starting event-specific coverage 84 days out. Low-cost running/mechanical familiarity can still come from evergreen/other athlete plans before the fitness-race plan takes authority.

### D7 — custom stays generic

`other_event/custom` has:

- generic demand calibration;
- no specific modality bonus;
- no format-specific coverage set;
- no format-specific plan builder;
- no HYROX taper policy;
- no title parsing.

If the existing generic A/B/C taper fallback remains applicable to `other_event`, document and test it explicitly as a generic competition rule.

### D8 — decision-affecting metadata ships atomically

The first merge that activates fitness-race behavior also contains:

- new/updated SKR claims and sources;
- `POLICY_VERSION` bump;
- policy-history registration required by the repository;
- architecture documentation update.

Do not land behavior first and provenance later.

## 4. Work packages

## WP0 — freeze the contract with tests before behavior

Add compile/runtime tests that describe the intended boundary.

### WP0.1 Existing category regression matrix

For every current category/preset:

- resolved demand vector unchanged;
- specific modality set unchanged;
- taper result unchanged;
- goal -> event conversion unchanged except additive `presetId`;
- optimizer focus-modality behavior unchanged;
- existing coverage/plan behavior unchanged.

Prefer snapshot/fixture-based parity tests over hand-written duplicate expectations where possible.

### WP0.2 HYROX Warsaw timing fixture

Do **not** use `2027-04-10` as a confirmed fixture.

Use the current official window:

```ts
timing: {
  earliestDate: '2027-04-07',
  latestDate: '2027-04-11',
  planningDate: '2027-04-07',
  // no confirmedDate yet
}
```

The supported target format is Men/Open Singles. The public schedule currently shows Men/Open on 7–10 April, but it is provisional. The product fixture should test the uncertainty model rather than a temporary schedule detail.

Add a second test where `confirmedDate` becomes `2027-04-10` and `planningDate` is updated accordingly; derived plan/taper dates must move deterministically without rewriting already persisted historical recommendations.

### WP0.3 Custom-event negative fixture

Assert `other_event/custom` has no HYROX modality, coverage or plan semantics.

## WP1 — event identity and preset semantics

Primary files:

- `app/src/engine/models.ts`
- `app/src/engine/eventPresets.ts`
- `app/src/engine/periodization.ts`
- associated tests/validation

### WP1.1 Expand `UserEvent['category']`

Add `fitness_race` and `other_event`.

Update every exhaustive `Record<UserEvent['category'], ...>` and switch. Do not silence exhaustiveness with `default` branches where a missing category should be a compile-time error.

### WP1.2 Add `UserEvent.presetId`

Populate it in `goalToUserEvent` from validated `UserGoal.eventPreset`.

Compatibility:

- old goals without a preset continue to resolve their current category default;
- existing category behavior does not change;
- no persistence migration is required for internal `UserEvent` because persisted authority remains the goal.

### WP1.3 Replace demand-only resolver with canonical semantics resolver

Extend `EventPreset` (or introduce a sibling descriptor) so the registry owns:

- demand profile;
- specific modalities;
- support level;
- taper policy id;
- optional coverage set id;
- optional plan policy id.

Keep a compatibility `resolveDemandProfile` wrapper temporarily if many callers/tests rely on it, but implement it through the canonical resolver.

### WP1.4 Add P0 presets

`hyrox_open_singles`:

- category: `fitness_race`;
- support: `specific`;
- specific modalities: Running, Strength, Cross Training;
- HYROX plan/coverage/taper policy IDs.

`custom`:

- category: `other_event`;
- support: `generic`;
- empty specific-modality set;
- no format-specific coverage/plan policy.

## WP2 — consume canonical semantics everywhere

Primary files:

- `app/src/engine/periodization.ts`
- `app/src/engine/optimizer.ts`
- `app/src/engine/taperPolicy.ts`
- tests

### WP2.1 Periodization

Retire category-only `modalitiesForEventCategory` as the semantic authority. Resolve specific modalities from preset semantics.

Demand-derived adaptation objectives continue to use existing `ObjectiveKey`s. Do not add session-shape objectives for HYROX.

### WP2.2 Optimizer focus-event bonus

ADR-0007 explicitly documents category-to-modality mapping inside the optimizer. Replace that duplication with resolved event semantics.

Regression test that all old categories get the same focus-modality bonus as before.

### WP2.3 Taper

Refactor taper selection order to remain:

1. explicit authored `event.taper.startDate`;
2. supported preset-specific taper policy;
3. current category/generic fallback where applicable;
4. no taper.

For `hyrox_open_singles`, register the 7-day P0 default as product calibration. The implementation must make policy identity visible in tests/knowledge rather than burying `7` inside a branch.

## WP3 — fitness-race coverage set and generated PlanDefinition

Primary files:

- `app/src/workouts/event-plan.ts`
- `app/src/engine/planSchedule.ts`
- coverage/plan tests

### WP3.1 Extend coverage vocabulary

Add the four P0 fitness-race keys:

- `fitness_race_station_work`;
- `fitness_race_compromised_run`;
- `fitness_race_specific_simulation`;
- `fitness_race_race_day`.

Add a new `CoverageSetId`, e.g. `hyrox_open_fitness_race`.

### WP3.2 Add `HYROX_OPEN_COVERAGE_SET`

The set should reuse existing generic roles where valid and map new roles only to exact HYROX-capable workout IDs.

No generic running workout may satisfy `fitness_race_compromised_run` merely because it is Running. No generic full-body circuit may satisfy `fitness_race_station_work` merely because it is hard.

### WP3.3 Add `buildFitnessRaceEventPlan`

For `fitness_race + hyrox_open_singles`, generate blocks relative to the planning date:

```text
D-56 .. D-29  build / transition
D-28 .. D-8   peak / fitness-race specificity
D-7  .. D-1   taper
D0             race
D+1 .. D+7    recovery
```

When an explicit taper start exists, it overrides D-7 and block boundaries adjust consistently.

The generated plan should use:

- existing adaptation objectives for aerobic/quality/strength stimulus where appropriate;
- **coverage-only requirements** for compromised running/station/simulation roles when there is no honest standalone stimulus axis;
- exact coverage identity under ADR-0016.

Do not add a second optimizer.

### WP3.4 Weekly-role calibration

Keep P0 conservative and executable. Example product policy:

**Build/transition:**

- preserve aerobic work;
- preserve one real strength role;
- station-work target available but not allowed to displace primary endurance/strength roles;
- compromised-running minimum may remain zero until specificity.

**Specificity:**

- one compromised-running role/week minimum when admissible;
- one station-work role/week target;
- partial simulation is optional/target, not a required weekly full-race rehearsal;
- one real strength role remains.

**Taper:**

- no high-DOMS station-volume requirement;
- one small exact fitness-race specificity touch may be retained;
- recovery/freshness roles dominate.

Exact counts are product calibration and must be validated against weekly capacity so an impossible role set fails/degrades honestly under ADR-0044 rather than forcing unsafe work.

## WP4 — canonical workouts and multidomain execution

Primary files depend on the current catalog/session adapters, at minimum:

- `app/src/engine/templates.ts`
- `app/src/workouts/*`
- `app/src/sessions/*`
- catalog/session validators and fixtures

### WP4.1 Minimum executable workout set

Add at least:

1. **station-focused technique/endurance session**;
2. **compromised-running session** with ordered run/station transitions;
3. **partial fitness-race simulation** or a reduced version reachable in specificity;
4. **race-day/session identity** for coverage/audit if the current event model requires one.

P0 does not need one workout per official station.

### WP4.2 Canonical mapping

Every new engine template must resolve deterministically to an active canonical workout through `engineTemplateIds` / the current catalog routing contract.

Every selectable canonical workout must adapt to a valid ADR-0023 `SessionDefinition` and produce a content-addressed `ExecutionPrescription`.

CI must fail if a new template is selectable but has no executable prescription.

### WP4.3 Preserve composite structure

A compromised-running workout is not simply:

```text
modality = Cross Training
```

with a prose description.

Its normalized session must retain ordered run/station blocks, doses, rest/transitions and equipment requirements. The engine template may remain a ranking summary, but execution/replay uses the normalized definition.

### WP4.4 Equipment

Audit current `EquipmentKey` vocabulary before adding keys. Add only missing capabilities needed by the P0 executable sessions, likely among:

- sled;
- SkiErg;
- rower;
- wall-ball/target setup;
- kettlebell/dumbbell carry load;
- sandbag.

Do not claim full official-station fidelity if the environment cannot represent it.

Candidate eligibility must reject a station session whose required equipment is absent and leave a clear exclusion reason.

### WP4.5 Reduced/return variants

Where current workout architecture requires it, provide full/reduced variants that preserve role identity. A reduced compromised-running prescription may earn the role only if the authored coverage mapping explicitly allows that identity/dose; do not infer it from stimulus.

## WP5 — Goal UI and persistence for provisional events

Primary files:

- `app/src/components/Goals.tsx`
- `app/src/services/goalService.ts`
- `app/src/engine/validation.ts`
- relevant Firestore/rules tests if persisted shape changes

### WP5.1 Category/preset UI

Expose:

- Fitness race -> HYROX Open Singles;
- Other event -> Custom event.

Existing labels stay unchanged.

### WP5.2 Event date mode

Add a minimal date-state control for dated events:

- **Confirmed date** — one date;
- **Provisional window** — earliest/latest date.

For a provisional window:

- validate `earliestDate <= latestDate`;
- set `planningDate` according to the existing `EventTiming` invariant;
- keep `confirmedDate` absent;
- show the UI as provisional rather than “Target date: 10 Apr”.

When the athlete later confirms a date, persist `confirmedDate` and update `planningDate` through the validated service path.

### WP5.3 Display

Event cards/sidebar should display either:

- confirmed single day; or
- provisional range plus planning-date context.

Countdowns must use `timing.planningDate` rather than blindly reading `goal.targetDate` when timing exists.

## WP6 — demand/taper knowledge lineage

Primary files:

- `app/src/knowledge/periodizationEventDemandKnowledge.ts`
- relevant taper/plan knowledge module if separate
- `app/src/knowledge/sportsKnowledge.ts`
- validators/tests

### WP6.1 Demand preset claim

Add HYROX Open as a product-calibrated demand profile. The official race format supports the qualitative morphology but does not validate normalized 0–1 scalars.

Do not simply change “19 presets” to “20” while also adding `custom`. Either:

- state the exact new structural count correctly (**21 total registry entries**: 19 existing + HYROX + custom); or preferably
- remove the brittle literal from the claim statement and validate registry membership/lineage structurally.

### WP6.2 Plan/taper claim

Register the D-56/D-28/D-7/D+7 policy as `product_policy`, with `evidenceCertainty = not_applicable` if represented by the current knowledge schema.

Reference general taper evidence only for the broad strategy (volume reduction with intensity/frequency retained), not as proof of a HYROX-specific seven-day optimum.

### WP6.3 Source references

Record at least:

- official HYROX Warsaw page;
- official HYROX race-format page;
- current endurance taper synthesis already used by the repository where applicable.

## WP7 — policy identity and docs

Because this feature can change persisted recommendations:

- bump global `POLICY_VERSION`;
- update policy history / drift fixtures;
- update ADR-0007 because optimizer event-modality semantics move from category switch to the canonical event-semantics resolver;
- update ADR-0012/0016 only by new superseding/amending record if implementation changes their accepted responsibility boundaries; do not silently edit accepted history;
- keep ADR-0048 as the primary decision record for the new taxonomy/format semantics.

No decision-affecting code merge is complete without these updates.

## WP8 — end-to-end and regression tests

### Required unit tests

1. every root category has a valid preset/default semantics path;
2. every preset id is unique within its category;
3. unknown preset handling is explicit and deterministic;
4. `goalToUserEvent` retains `presetId`;
5. existing 19 presets keep identical demand vectors;
6. existing event categories keep identical specific modalities;
7. optimizer focus-event modality behavior is unchanged for existing categories;
8. explicit taper overrides every default;
9. HYROX policy resolves only for `fitness_race/hyrox_open_singles`;
10. custom event never resolves HYROX coverage/plan semantics.

### Required coverage/plan tests

1. HYROX exact coverage set validates against active canonical workout IDs;
2. generic Running cannot satisfy `fitness_race_compromised_run`;
3. generic Strength cannot satisfy `fitness_race_station_work`;
4. exact HYROX workout identities do satisfy their authored roles;
5. generated block dates move when `planningDate` changes from provisional to confirmed;
6. authored taper start reshapes taper block without overlap;
7. coverage requirements degrade honestly when weekly capacity/equipment makes them infeasible;
8. post-event recovery block is active only after the resolved event date.

### Required executable-session tests

1. every new selectable engine template resolves to an active canonical workout;
2. each canonical HYROX workout adapts to a valid `SessionDefinition`;
3. execution prescription hash is deterministic;
4. composite run/station order survives normalization;
5. missing required station equipment excludes the candidate;
6. reduced variants do not silently earn undeclared coverage.

### Required UI/service tests

1. Fitness race and Other event render;
2. preset choice round-trips;
3. provisional window round-trips through validation/service;
4. invalid range is rejected;
5. displayed countdown uses planning date;
6. confirmation updates `confirmedDate`/`planningDate` without losing preset identity.

### End-to-end acceptance fixture

Create:

```text
Title: HYROX Warsaw 2027
Category: Fitness race
Format: HYROX Open Singles
Timing: provisional 2027-04-07 .. 2027-04-11
Priority: chosen by fixture, not hardcoded as product truth
Lifecycle: scheduled
```

Assert:

- `presetId === 'hyrox_open_singles'`;
- resolved semantics are specific;
- `planningDate === '2027-04-07'` until confirmed;
- HYROX plan/coverage becomes active only inside its policy window;
- specificity can reserve exact compromised-running/station roles;
- ordinary running/strength stimulus does not counterfeit those roles;
- generated sessions are executable and equipment-aware;
- explicit user taper overrides policy default;
- a later unrelated cycling event is not permanently biased toward Running/Strength after HYROX recovery ends.

Then confirm the date to `2027-04-10` and assert deterministic shift of future fitness-race blocks/taper.

## 5. Delivery sequence

Recommended implementation order:

1. **WP0:** regression/contract tests.
2. **WP1:** category + downstream preset identity + semantics resolver.
3. **WP2:** periodization/optimizer/taper consumers.
4. **WP3:** fitness-race coverage set + plan builder.
5. **WP4:** canonical executable HYROX sessions/equipment.
6. **WP5:** UI + provisional timing.
7. **WP6/WP7:** knowledge lineage + policy version + ADR/docs, in the **same merge** as deciding behavior.
8. **WP8:** complete end-to-end matrix and full CI.

Commits may be split for review, but the deployable merge must not contain decision-affecting behavior without its policy/knowledge provenance.

## 6. CI / verification commands

At minimum run the repository's normal gate:

```bash
npm run check
```

Also run any narrower suites touched by the implementation, including:

- event preset/periodization tests;
- optimizer architecture/ranking tests;
- plan/coverage validators;
- workout catalog validation;
- session-definition/prescription validation;
- sports-knowledge validation;
- policy-drift/replay tests;
- Goal UI/service tests.

No special CI exception is expected for this feature. A failing frozen coverage hash/count is a prompt to review and intentionally update the governed fixture, not to weaken the guard.

## 7. Out of scope for P0

- HYROX Pro;
- Doubles/Relay team semantics;
- adaptive division modeling;
- automatic import of official race schedules;
- start-wave time planning;
- full-race simulation every week;
- automatic prose classification of custom events;
- universal fitness-race ontology;
- replacing the existing adaptation axes with HYROX-specific physiology axes;
- athlete-specific cycling-vs-HYROX macrocycle priorities hardcoded into product defaults.

## 8. Implementation review checklist

Before merging the future implementation PR, verify:

- [ ] ADR-0048 accepted or explicitly superseded.
- [ ] Existing event behavior parity tests pass.
- [ ] No fixed 10-April Warsaw assumption remains.
- [ ] `EventTiming` is exposed for provisional windows.
- [ ] `UserEvent` retains preset/format identity.
- [ ] Periodization and optimizer use the same event-semantics authority.
- [ ] HYROX session morphology is coverage-based, not stimulus-inferred.
- [ ] HYROX has an explicit event-relative `PlanDefinition`.
- [ ] Composite sessions cross the ADR-0023 executable boundary.
- [ ] Equipment gates are real and tested.
- [ ] Custom event stays generic.
- [ ] SKR claims do not overstate scientific support.
- [ ] `POLICY_VERSION` advanced with decision behavior.
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
