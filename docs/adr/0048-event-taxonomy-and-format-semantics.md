# ADR-0048: Event Taxonomy, Format Identity, and Event-Specific Planning Semantics

* **Status:** Proposed
* **Date:** 2026-10-05
* **Deciders:** Repository owner / core engineering
* **Related:** ADR-0001, ADR-0004, ADR-0007, ADR-0010, ADR-0012, ADR-0016, ADR-0023, ADR-0033
* **Analysis:** [`2026-10-05-event-taxonomy-fitness-race-hyrox.md`](../analysis/2026-10-05-event-taxonomy-fitness-race-hyrox.md)
* **Implementation plan:** [`2026-10-05-event-taxonomy-fitness-race-hyrox.md`](../plans/2026-10-05-event-taxonomy-fitness-race-hyrox.md)

## Context

The event model currently distinguishes running races, cycling events, triathlon, strength meets and general targets. That taxonomy is sufficient only while the root category itself carries most downstream meaning.

Fitness races expose the limitation. HYROX Open Singles is not accurately represented as a running race or strength meet: it combines repeated running with ordered functional stations, loaded locomotion, local muscular endurance and transitions. Future fitness-race formats may share the same root category while differing materially in load, team structure, station sequence and event-specific training needs.

The current implementation also distributes event meaning across several independent places:

- `eventPresets.ts` resolves a category/preset to a demand vector;
- `periodization.ts` maps categories to modalities and demand-derived objectives;
- `optimizer.ts` separately maps event categories to modality bonuses;
- `taperPolicy.ts` owns category/priority taper behavior;
- `planSchedule.ts` gives only cycling events a generated event-relative `PlanDefinition`;
- `workouts/event-plan.ts` owns exact programming-role coverage;
- `Goals.tsx` owns labels and single-date event input.

Adding another category-specific switch in every consumer would compile but would create a new source of semantic drift.

Two accepted architecture decisions constrain the solution:

1. ADR-0016 separates physiological adaptation credit from exact programming-role coverage. Session morphology must not be inferred from stimulus, modality or title.
2. ADR-0023 makes `SessionDefinition` and frozen `ExecutionPrescription` the executable boundary for composite sessions.

A third existing domain object is directly relevant: ADR-0012 already treats `EventTiming` as the generic authority for uncertain date windows, even though the current Goal UI exposes only a single date.

## Decision

### D-EVENT-ROOT — add fitness-race and generic-event root categories

Extend the root event taxonomy with:

```ts
'fitness_race'
'other_event'
```

`general_target` remains a dated non-competition target. `other_event` is a competition/event escape hatch when the application does not have specific format knowledge.

Root categories remain broad families. They are not expected to encode every competition format.

### D-EVENT-FORMAT — preserve format identity downstream

A selected preset/format is decision-relevant and SHALL survive conversion from persisted `UserGoal` to runtime `UserEvent`.

`UserEvent` therefore gains a stable optional format identifier, for example:

```ts
presetId?: string;
```

The selected format SHALL NOT be reconstructed from a demand vector, title, description, or other lossy derived field.

Historical goals without an explicit preset continue to use the existing category default.

### D-EVENT-SEMANTICS — one canonical preset-semantics authority

Preset metadata SHALL become the canonical authority for format-specific event semantics.

The resolved semantics include at least:

- demand profile;
- event-specific modalities used for event-focus preference/ranking;
- support level (`specific` or `generic`);
- taper policy identity;
- optional coverage-set identity;
- optional event-plan policy identity.

A compatibility `resolveDemandProfile` API may remain temporarily, but it SHALL delegate to the canonical resolver.

Periodization and optimizer code SHALL NOT keep independent category-to-modality tables once migrated.

### D-EVENT-COVERAGE — session morphology is exact coverage, not a new stimulus axis

Event-specific programming obligations such as:

- compromised running;
- station work;
- fitness-race-specific partial simulation;
- fitness-race race day;

belong to the ADR-0016 coverage ledger and are fulfilled only by exact authored workout/session identities.

P0 SHALL NOT add a `WeeklyObjective` key merely to force a particular session shape when the requirement is not a distinct physiological adaptation axis.

Generic Running plus generic Strength cannot satisfy a compromised-running role unless an explicit coverage mapping says that exact workout identity does so.

### D-EVENT-PLAN — specifically supported formats may provide generated PlanDefinitions

A specifically supported format may register an event-relative plan policy and coverage set.

For P0, `fitness_race / hyrox_open_singles` receives a generated `PlanDefinition` so exact fitness-race coverage can participate in the normal plan/coverage allocator.

`other_event / custom` does not receive a format-specific plan or coverage set.

The initial HYROX Open block boundaries and role counts are product calibration. They SHALL be named/versioned policy and registered in the Sports Knowledge Registry rather than described as universal physiological thresholds.

### D-EVENT-TIMING — provisional event windows use EventTiming

Multi-day or not-yet-confirmed event dates SHALL use the existing `EventTiming` model rather than inventing a confirmed date.

The Goal UI SHALL support the minimum distinction between:

- confirmed single date; and
- provisional earliest/latest date window.

Periodization and plan/taper resolution continue to use `timing.planningDate ?? event.date` as the planning anchor. Confirmation updates the validated timing record; it does not rewrite historical recommendation audits.

### D-EVENT-EXECUTION — composite event sessions cross the multidomain boundary

A fitness-race workout may have a single engine/template identity for ranking, but its executable content SHALL preserve the ordered multidomain structure required by ADR-0023.

Selectable HYROX candidates therefore must resolve:

```text
engine/catalog identity
  -> canonical WorkoutDefinition
  -> normalized SessionDefinition
  -> frozen ExecutionPrescription
```

A prose description attached to a `Cross Training` template is not sufficient representation of a run/station session.

### D-EVENT-CUSTOM — generic fallback remains epistemically honest

`other_event / custom` SHALL NOT receive format-specific semantics by inference.

It has:

- generic demand calibration;
- no format-specific modality bonus;
- no HYROX coverage set;
- no HYROX plan policy;
- no HYROX taper policy;
- no title/description parsing into event type.

A generic priority-based competition taper may still apply if that existing fallback is deliberately retained and clearly labelled/tested as generic policy.

### D-EVENT-PROVENANCE — semantics and policy lineage ship with behavior

Any decision-affecting event-format addition SHALL update the relevant Sports Knowledge Registry claims/sources and the global `POLICY_VERSION` in the same deployable merge.

Scientific evidence may justify broad principles. Exact normalized demand values, event-plan lead times, coverage counts and unsupported format-specific taper durations remain product calibration unless directly evidenced.

## Initial P0 registration

The first specifically supported fitness-race format is:

```text
category: fitness_race
presetId: hyrox_open_singles
supportLevel: specific
```

The first generic fallback is:

```text
category: other_event
presetId: custom
supportLevel: generic
```

The HYROX Open Singles descriptor may use Running, Strength and Cross Training as event-specific modalities for engine-level routing, but executable composite sessions remain multidomain `SessionDefinition`s.

The P0 coverage vocabulary adds exact fitness-race roles for station work, compromised running, specific simulation and race day, while reusing existing generic roles such as aerobic volume, primary strength and recovery when their semantics match exactly.

## Consequences

### Positive

- New event families no longer require duplicating semantic switches across periodization and optimizer layers.
- Future HYROX Pro/Doubles/Relay or other fitness-race formats can reuse the root category without pretending their semantics are identical.
- Provisional event dates remain honest and already fit the existing timing model.
- Session-shape requirements stay on the exact coverage ledger instead of contaminating adaptation objectives.
- Composite run/station workouts remain executable and replayable through the source-neutral session architecture.
- Custom events can exist without the product pretending to know their physiology.
- Knowledge provenance and policy replay remain intact.

### Negative / costs

- `UserEvent` becomes slightly richer and more consumers must depend on resolved preset semantics rather than category alone.
- Fitness-race support requires a new coverage set and plan builder instead of only adding a demand vector.
- Goal UI must expose provisional windows to use `EventTiming` correctly.
- Catalog support requires real executable HYROX sessions and equipment modeling; a template-only implementation is not sufficient.
- Format-specific plan/taper calibration creates policy-maintenance work and must be versioned/reviewed.

## Rejected alternatives

### Treat HYROX as a running race

Rejected because generic running does not represent the ordered loaded-station work or compromised-running specificity.

### Treat HYROX as a strength meet

Rejected because eight kilometres of interleaved running and repeated transitions are central to the event.

### Add only `fitness_race` and branch everywhere

Rejected because the current repository already has duplicated event-category semantics; another branch in each consumer increases drift and makes future formats harder.

### Encode compromised running as a new physiological ObjectiveKey

Rejected because ADR-0016 explicitly separates adaptation from programming-role coverage. The requirement is session morphology/identity first.

### Use a generic `Cross Training` template with prose

Rejected because ADR-0023 requires normalized executable structure and replayable prescriptions for composite sessions.

### Hardcode 10 April 2027 for HYROX Warsaw

Rejected because the official 7–11 April event schedule is provisional and Men/Open is currently offered on several days. The existing `EventTiming` model is designed for this uncertainty.

### Infer custom-event semantics from the title

Rejected because prose classification would silently manufacture training authority without reviewed format metadata.

## Compatibility and migration

- Existing categories/presets SHALL retain their demand, modality, taper and ranking behavior under regression tests.
- Existing persisted goals require no bulk migration; missing preset identity uses the current category default.
- Historical recommendation/audit records are never rewritten.
- The canonical resolver may be introduced behind compatibility wrappers to keep the migration reviewable.
- Any accepted implementation SHALL amend ADR-0007's stale statement that optimizer event-modality semantics are category-mapped locally.

## References

Repository:

- [ADR-0001](./0001-record-architecture-decisions.md)
- [ADR-0004](./0004-workout-library-architecture.md)
- [ADR-0007](./0007-adaptive-multisport-engine-architecture.md)
- [ADR-0010](./0010-decision-provenance-and-audit-replay.md)
- [ADR-0012](./0012-plan-intent-authority.md)
- [ADR-0016](./0016-adaptation-credit-and-weekly-coverage.md)
- [ADR-0023](./0023-multidomain-session-authoring-execution-and-evidence.md)
- [ADR-0033](./0033-sports-knowledge-registry.md)

External:

- HYROX Warsaw 2026/27: <https://hyrox.com/event/hyrox-warsaw-26-27/>
- HYROX race format: <https://hyrox.com/the-fitness-race/>
- Endurance taper systematic review/meta-analysis: <https://pubmed.ncbi.nlm.nih.gov/37163550/>
