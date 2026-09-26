# Issue #806 — Evidence-backed weekly aerobic dose envelope

**Status:** In review
**Blocked by:** deterministic repository verification and independent diff review
**Unlocks:** athlete-history-bounded weekly easy-aerobic dose and conditional long aerobic anchor

## Goal

Resolve weekly accumulated aerobic minutes from supplied training history, keep modality and
intensity semantics explicit, and report when a feasible exact long anchor cannot be packed.
The existing #757 single-session `aerobic_volume` coverage floor remains a separate contract.

## Preconditions

- ADR-0044 is accepted and keeps requirement classes and exact-role coverage distinct.
- Planning already holds the bounded `TrainingHistorySnapshot`; the resolver adds no IO.
- Existing readiness, injury, load, taper and schedule gates remain authoritative.

## Work items

1. `weeklyAerobicDose.ts`: use four fixed seven-day bins from the 28-day snapshot. Require
   established training and activity in at least three bins; otherwise use the adult-health
   150/150/300 minute floor/target/upper range. For supported history use a 150-minute minimum
   floor and historical quartiles/median for maintenance or development. Do not use availability
   to raise the dose. Done when fixed-window tests cover sparse history, maintenance, development
   and the no-free-time-increase property.
2. `evergreenPlanning.ts` and `evergreenStrategy.ts`: derive the envelope from already available
   history; limit its relative accounting to easy aerobic activity in the dominant evidenced
   modality. Do not equate intensity zones. Done when strategy requirements and claim references
   carry the selected envelope.
3. `weeklyDosePacking.ts`, `coverage.ts`, `weeklyAllocation.ts`, `planSchedule.ts` and
   `workouts/event-plan.ts`: let actually packed quality-session minutes contribute to the
   general-health fallback only, and add a conditional exact `long_aerobic_anchor` requirement
   that one matching session must meet. Report typed shortfall if it cannot be packed.
4. Register and align the policy in `stimulusHeuristicsKnowledge.ts` and
   `knowledgeCoverage.ts`; bump `POLICY_VERSION` and include the old version in history.
5. Update ADR-0044, `recommendation-engine.md`, and this status board entry.

## Tests and verification

- `weeklyAerobicDose.test.ts`: fixed bins, sparse-history fallback, history-derived ranges,
  primary modality, and no availability input.
- `weeklyDosePacking.test.ts`, `coverage.test.ts`, `evergreenPlanning.test.ts`: exact anchor
  packing/shortfall, duration gate, history duration cap and adverse-state suspension.
- Knowledge coverage and policy-alignment tests verify ownership and constants.
- Run `make verify`, `make simulate`, `npm run simulate:plan-judge`, persona scenarios/diff,
  and policy drift against the updated main SHA.

## Acceptance criteria

- [x] Target and floor do not increase merely because more schedule time is free.
- [x] Relative volume counts only the dominant modality's easy aerobic work; no intensity
  equivalence is inferred.
- [x] Fallback follows the 150/150/300 adult-health range and counts packed quality duration
  only after packing.
- [x] Long anchor is one exact session, is bounded by catalog capacity, and has typed shortfall.
- [x] Repository, deterministic simulation and independent review gates complete; the
  deterministic persona corpus was generated.
- [ ] Persona score diff requires the local Ollama service, which was unavailable in this run.

## Risks and rollback

History classification and quartiles can change athlete targets; the policy version, registered
claim, alignment test, and deterministic simulation gate expose that change. If evidence or
simulation results are unacceptable, revert this policy version and the associated envelope/
anchor wiring together; keep the independent #757 duration floor.

## Out of scope

No threshold-to-Zone-2 conversion, clinical prescription, new data collection, alternate
physiological load model, or partial exact-role credit.
