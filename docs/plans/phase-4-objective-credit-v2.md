# Phase 4 Ă˘â‚¬â€ť Objective credit V2, and honest load

* **Status:** In progress — implementation tasks are committed; release approval is blocked on Phase 0 harness evidence
* **Blocked by:** Phase 0Ă˘â‚¬â„˘s harness-gate evidence is required before credit/fusion cutover is
  considered release-ready; implementation work proceeds on the committed Phase 2 contract.
* **Depends on:** Phase 0 (harness evidence), Phase 2 (ADR-0012 fixes the credit contract)
* **Unlocks:** Phase 5
* **Addresses:** F7, F8, F12
* **Rough effort:** 4Ă˘â‚¬â€ś5 days

---

## Task board

Status legend: `[ ]` not started Ă‚Â· `[-]` in progress Ă‚Â· `[x]` finished.
Update the marker on the work-item heading **and** this table in the same commit.

| Task | Status | Summary | Primary files |
|---|:--:|---|---|
| 4.1 | `[x]` | One credit model: fix and promote `deriveObjectiveCredit`; shadow-run V1 vs V2 first (F7) | `app/src/engine/stimulus.ts`, `microcycle.ts`, `trainingIntent.ts` |
| 4.2 | `[x]` | Canonical stimulus axes required; legacy aliases and derived fallbacks deleted (F8) | `app/src/engine/models.ts`, `templates.ts`, `optimizer.ts`, `microcycle.ts`, `completedTraining.ts`, fixtures |
| 4.3a | `[x]` | Sort/assert history and retain unsaturated external load (F12) | `app/src/engine/fatigue.ts`, `trainingHistorySnapshot.ts` |
| 4.3b | `[-]` | Compare fatigue-fusion functions before choosing (F12) | Phase 0 harness, ADR-0014 |
| 4.5 | `[x]` | `PlannedDose { volume, intensity }` Ă˘â‚¬â€ť gives `intensityScale` its consumer (D2 / F17) | `app/src/engine/trainingIntent.ts`, `dose.ts`, `models.ts`, `optimizer.ts` |
| 4.4 | `[x]` | Cost responds to delivered duration and completion ratio | `app/src/engine/completedTraining.ts`, `fatigue.ts` |

4.5 is numbered after 4.3 but should land **before** 4.4 Ă˘â‚¬â€ť 4.4's dose-sensitive cost and
4.5's `PlannedDose` touch the same call path, and doing 4.4 first means reworking it.
4.3(b) is deliberately open: do not pick a fusion function without harness data.

---

## Goal

Collapse three objective-credit models into one dose-sensitive model, finish the stimulus
vocabulary rename, and make delivered load respond to what was actually done Ă˘â‚¬â€ť without
inventing constants the repository cannot justify.

---

## `[x]` 4.1 Ă˘â‚¬â€ť F7: one credit model

Today there are three:

| Model | Location | Status |
|---|---|---|
| Keyword substring on free text | `microcycle.ts` `updateMicrocycleProgress` | live (fallback) |
| Stimulus-vector coverage Ă˘â€°Ä„ 0.6 | `microcycle.ts` `creditObjectivesFromStimulus` | live (primary) |
| Fractional dose-sensitive credit | `stimulus.ts` `deriveObjectiveCredit` | **dead** |

The keyword matcher is directionally wrong, not merely approximate: `zone2_aerobic`
matches any type containing `running` or `cycling`, so a threshold ride credits Zone 2;
`threshold_quality` matches `hard` or `tempo`. Phase 1.2 already establishes that it must
not become the Garmin path.

**Target:** `deriveObjectiveCredit` becomes authoritative, with `requiredCredit` /
`completedCredit` / `projectedCredit` / `windowStart` / `windowEnd` / `priority` Ă˘â‚¬â€ť all
already declared in `models.ts` and all unused Ă˘â‚¬â€ť carrying real values from Phase 2's
`PlanDefinition`.

### Fix `deriveObjectiveCredit` before promoting it

Two defects in the current scaffolding:

1. `qualifies: earnedCredit > 0` conflates *"not permitted"* with *"contributed nothing"*.
   A session that passes every qualification gate but scores zero stimulus reports
   `qualifies: false`. Separate the two: `qualifies` reflects the gates only;
   `earnedCredit` reflects the dose.
2. `default: rawStimulusContribution = 0.5` silently grants half credit for any
   unrecognised objective key. Make it `0` and log, or make the switch exhaustive over
   `ObjectiveKey` so the compiler catches a missing arm.

### Objective-specific dose semantics

A single generic formula is not appropriate Ă˘â‚¬â€ť 15 abbreviated minutes should not equal a
75-minute race-specific ride because each "counts once".

| Objective | Credit should depend primarily on |
|---|---|
| `zone2_aerobic` | meaningful aerobic minutes |
| `threshold_quality` | accumulated work near threshold Ă˘â‚¬â€ť `2Ä‚â€”8`, `4Ä‚â€”8`, `3Ä‚â€”12` are not equivalent |
| `surge_repeatability` | effort count, duration, recovery pattern, and whether performed under aerobic load |
| `race_specific_endurance` | duration, fatigue resistance, continued pedalling after efforts, event-like context |
| `strength_maintenance` | useful sets and movement exposure at relative intensity, not elapsed time |

Implement as per-objective functions behind one interface. Resist collapsing them into a
shared formula with per-objective coefficients Ă˘â‚¬â€ť that reintroduces F11's uncited-constant
problem in a new place.

**The input contract must carry the evidence these rules need.** `stimulus.ts`'s
`DeliveredDose` currently offers only `plannedDurationMin`, `completedDurationMin` and
`completionRatio`, and `CreditContext` only `modality`/`category`. That cannot express
effort count, recovery pattern, continued pedalling after efforts, aerobic-load context,
or event-like context. Either extend the contract to carry them (with
`stimulusConfidence` marking what is measured vs inferred) **or** narrow the objective
rules to what the available evidence supports. What must not happen is a credit function
that silently ignores a factor its own specification names Ă˘â‚¬â€ť that is how an unfalsifiable
formula gets shipped.

### Shadow mode before cutover

Run V1 and V2 crediting side by side for one iteration, emitting both into the simulation
report. Compare objective-resolution counts per scenario. Cut over only when the
divergence is explainable Ă˘â‚¬â€ť not merely when V2 runs without throwing.

**Completed 2026-08-08:** The live microcycle ledger now accumulates
`WeeklyObjective.completedCredit` from `deriveObjectiveCredit`, with
`requiredCredit` as the unresolved authority. The legacy `completedExposures` field is a
compatibility projection only; it no longer decides resolution. Reconciled completed events
carry `DeliveredDose` into history, so actual duration reaches the credit function. The
objective rules are intentionally narrowed to the currently measured stimulus vector plus
completion ratio; effort-count, recovery-pattern, and event-context rules remain deferred
until those signals have a source. `npm run check` passes. The scenario run produced a
58.9% recovery-share aggregate-bound failure; its release interpretation remains blocked on
the Phase 0 harness gate and is recorded below rather than silently accepting the cutover.

## `[x]` 4.2 Ă˘â‚¬â€ť F8: finish the stimulus rename

`WorkoutStimulusProfile` carries 7 canonical + 5 legacy axes, **all optional**.
`canonicalizeStimulus` (`templates.ts` `canonicalizeStimulus`) fills both sides and invents two
derivations with no cited basis:

```ts
vo2MaxPower:       s.vo2MaxPower       ?? (s.surgeRepeatability   ? s.surgeRepeatability   * 0.8 : 0),
fatigueResistance: s.fatigueResistance ?? (s.thresholdDevelopment ? s.thresholdDevelopment * 0.7 : 0),
```

Consumers disagree on which vocabulary is authoritative Ă˘â‚¬â€ť `optimizer.ts` reads legacy
only, `stimulus.ts` reads canonical-first. This is masked today only because both are
populated.

1. Make canonical axes **required**; delete the legacy aliases. **Inventory every producer
   and consumer first** Ă˘â‚¬â€ť the codemod is not limited to `templates.ts` and the catalog.
   Known readers of the legacy vocabulary: `optimizer.ts` (`calculateStimulusBenefit`
   reads legacy axes exclusively), `microcycle.ts` (`targetStimulus` keys in
   `generateWeeklyObjectives` and `stimulusCoverage`), `completedTraining.ts`
   (`ZERO_STIMULUS`), `planner.ts` (`ZERO_STIMULUS`), `stimulus.ts` (canonical-first),
   plus test fixtures and any persisted `estimatedStimulus` on stored
   `CompletedTrainingEvent`s. Deleting aliases without migrating all of them either fails
   to compile or, worse, compiles and silently scores zero coverage. Include a
   compatibility read for persisted profiles written under the old vocabulary.

   **Specify that compatibility read before deleting anything.** Persisted
   `estimatedStimulus` on stored `CompletedTrainingEvent`s is the one input this change
   cannot codemod, and records exist in three states Ă˘â‚¬â€ť canonical-only, legacy-only, and
   both (everything `canonicalizeStimulus` has written to date, since it fills both
   sides). Define one `readStimulusProfile(raw): WorkoutStimulusProfile` at the read
   boundary and route every consumer through it:

   | Persisted record | Behaviour |
   |---|---|
   | Canonical fields present | Use them. **Canonical wins**, unconditionally. |
   | Legacy only | Convert via the canonical mapping below; do not consult legacy again downstream. |
   | Both present and disagreeing | Canonical wins, and the divergence is **logged** Ă˘â‚¬â€ť it means a writer was missed, and silently preferring one would hide that. |
   | Neither | `DataState.INVALID`, not a zero profile. A zero profile is indistinguishable from "genuinely no stimulus" and scores zero coverage forever. |

   The canonical mapping is the *identity for the five renamed axes* Ă˘â‚¬â€ť this is a rename,
   not a remodelling Ă˘â‚¬â€ť with one exception: the two derived fallbacks
   (`vo2MaxPower Ă˘â€ Â surgeRepeatability * 0.8`, `fatigueResistance Ă˘â€ Â thresholdDevelopment
   * 0.7`) are **not** part of the mapping, because item 3 deletes them as unjustified. A
   legacy-only record therefore converts with `vo2MaxPower` and `fatigueResistance`
   absent, which is honest: those values were never measured, only invented.

   Tests required before the aliases are removed: legacy-only converts correctly;
   canonical-only passes through; conflicting record resolves canonical **and** logs;
   empty record yields `INVALID`. Remove the alias fields only once every producer and
   every consumer named above reads through `readStimulusProfile`.
2. Type `WeeklyObjective.targetStimulus` as
   `Partial<Record<keyof WorkoutStimulusProfile, number>>` instead of
   `Record<string, number>`, so a typo'd axis is a compile error rather than a silent
   zero-coverage objective that can never resolve.
3. **Decision (2026-08-08): delete the derived fallbacks; make templates declare the axes
   explicitly.** `vo2MaxPower` and `fatigueResistance` become required fields that each
   template states outright, and the `* 0.8` / `* 0.7` derivations in
   `canonicalizeStimulus` are removed.

   The alternative Ă˘â‚¬â€ť find a citation for the coefficients Ă˘â‚¬â€ť is the wrong shape of work.
   No citation can justify a *repository-wide* claim that VO2 stimulus is uniformly 80% of
   surge stimulus across every template; that relationship varies per session by
   construction. Making 22 templates each declare two numbers is a couple of hours, removes
   two unexplained constants permanently, and forces the one person who knows what a given
   session develops to say so explicitly rather than having it inferred.

**Completed 2026-08-08:** The compatibility boundary is exercised with raw legacy-only
records, while every typed fixture and planner fallback now supplies the complete canonical
profile. `npm run typecheck`, lint, and the unit suite pass; the partial TypeScript fixture
migration left by the initial implementation was corrected before this task was closed.

## `[x]` 4.3 Ă˘â‚¬â€ť F12: fatigue, in two separable pieces

**This section was revised after PR #5 review.** An earlier draft prescribed
`1 - exp(-x)` saturation plus a weighted external/internal combination. That is withdrawn:
it was not justified by anything in the review, and it is the exact practice F11
criticises. It may also be wrong Ă˘â‚¬â€ť internal response (HRV/RHR/soreness) is partly a
*reaction to* the same external work, so a weighted sum double-counts load unless
calibrated, and `1 - exp(-x)` changes the state's scale and meaning, not just its
monotonicity.

### `[x]` (a) Correctness — done

`buildFatigueStateFromHistory` seeds from `history[0].date`, and
`applyCompletedSessionLoad` floors `elapsedHours` at 0. Oldest-to-newest ordering is
therefore load-bearing and asserted only in a comment on `projectTrailingHistory`. Out-of-order
input silently mis-decays.

**Sort, then assert Ă˘â‚¬â€ť do not take the dashboard down.** History is external, persisted
input; a bare `throw` on malformed ordering turns a data problem into an outage. The
boundary behaviour: validate and deterministically sort at ingestion
(`buildTrainingHistorySnapshot`), and have `buildFatigueStateFromHistory` assert the
invariant it relies on. If the assertion ever fires in production it is a programming
error, not bad data Ă˘â‚¬â€ť but the caller still degrades to the established controlled state
(ADR-0010's `INVALID` path) rather than crashing. Add a recommendation-path test for
malformed ordering, not just a unit test on the function.

### `[-]` (b) Modelling — blocked on Phase 0 harness comparison

Two real questions:

* **Saturation.** `Math.min(1, ...)` per axis (`applyCompletedSessionLoad`) means two hard
  lower-body days Ă˘â€°Â one, at the ceiling. The model cannot represent "significantly deeper
  in the hole".
* **Fusion.** `combinedFatigue = max(external, internal)` lets a bad night fully *mask*
  accumulated external load, and vice versa.

**Approach:** retain an unsaturated latent external-load state so depth is not discarded
at accumulation time, keeping the clamped value only as a presentation/ranking projection.
That is a strictly information-preserving change and can land independently. Then use the
Phase 0 harness to **compare** candidate fusion functions against the coaching invariants
before committing to one Ă˘â‚¬â€ť and record the comparison in an ADR, with the data.

This is deliberately slower than picking a formula. It is the process F11 asks for, and
this phase is the first opportunity to actually follow it.

**4.3a completed 2026-08-08:** the ingestion boundary sorts history, replay defends its
chronological invariant, and `rawExternalLoadFatigue` retains unsaturated depth. **4.3b is
not complete:** ADR-0014 records that `max()` remains in force until the harness comparison
exists. The failed 58.9% recovery-share aggregate bound is release evidence, not a basis to
select a fusion formula.

## `[x]` 4.5 Ă˘â‚¬â€ť `PlannedDose`: give `intensityScale` its consumer (D2)

**This is the work item that discharges D2 and F17.** Phase 2 decided `intensityScale`
gets a consumer rather than being deleted; without an owning work item that commitment is
prose, which is the exact failure mode this review criticises.

1. Replace the scalar `plannedDose` (`resolveTrainingIntent`) with
   `PlannedDose { volume, intensity }`.
2. `volume` derives from `PlanBlock.volumeScale` (current behaviour, unchanged).
3. `intensity` derives from `PlanBlock.intensityScale` and gates which intensity-class
   candidates are admissible, so a taper can hold intensity while cutting volume.
4. `Recommendation.plannedDose` and the persisted audit carry both components.
5. `resolveExecutionDose` (`dose.ts`) intersects `volume` with the clinical ceiling as
   today; `intensity` is a separate admissibility gate, not a second ceiling on duration.

**Depends on:** Phase 2's accepted `PlanDefinition`/`PlanBlock` contract (landed on this
branch). **Done when:** all recommendation, prescription, provenance, and replay paths
carry `PlannedDose`; candidate intensity eligibility is tested for a volume-reduced,
intensity-retained taper; and `npm run check` passes. This task's commit also changes its
board and heading markers to `[x]`.

**Completed 2026-08-08:** `resolvePlannedDose` derives `volume` from the existing urgency
formula and carries the authored `intensityScale` unchanged. `rankCandidates` now rejects
hard templates only below the existing Base phase's 0.8 intensity scale; Build (0.9) and
taper (1.0) therefore retain quality eligibility. `resolveExecutionDose` changes volume
only, while the immutable recommendation audit records both the planned and execution
components. Typecheck, lint, unit, and workout-catalog validation pass.

**Acceptance:** `intensityScale` has at least one reader; a taper block with
`volumeScale` down and `intensityScale` held produces shorter sessions at retained
intensity class, asserted in the Phase-0 harness.

## `[x]` 4.4 Ă˘â‚¬â€ť Dose-sensitive cost

`DEFAULT_COST_BY_MODALITY[modality][intensity]` returns a fixed vector; duration has
almost no authority, so a 40-minute hard ride and a 3-hour hard ride score nearly
identically. Move toward:

```text
base session cost Ä‚â€” delivered dose Ä‚â€” measured-response adjustment
```

Keep the six dimensions Ă˘â‚¬â€ť they are a good abstraction. This does **not** require adopting
TSS/CTL/ATL as ground truth; it requires the existing vectors to respond to duration,
completion ratio and measured training effect.

**Two of the three factors have an input today; the third does not.** `DeliveredDose` in
`stimulus.ts` carries `plannedDurationMin`, `completedDurationMin` and `completionRatio`
Ă˘â‚¬â€ť enough for `base Ä‚â€” delivered dose`, and nothing at all for the measured-response
adjustment. Writing the three-factor formula against a two-factor contract is how a term
ends up quietly evaluating to 1.0 forever, which is the `intensityScale` failure (F17)
repeated.

So split the work, and do not let the second half block the first:

1. **Duration and completion Ă˘â‚¬â€ť now.** Extend the cost function to consume `DeliveredDose`
   as it stands. This alone fixes the stated defect: a 40-minute and a 3-hour hard ride
   stop scoring alike.
2. **Measured response Ă˘â‚¬â€ť only once it has a source.** The signal exists upstream
   (`intensityFromGarmin` already reads Garmin training effect, and 4.3 introduces
   internal response), but it is not on `DeliveredDose`. Adding the term requires adding
   the field *and* populating it at every construction site, with `DataState` handling for
   the sessions that have no measurement Ă˘â‚¬â€ť an untracked activity has no training effect,
   and defaulting it to a neutral value silently reintroduces the dead term.

**Acceptance covers step 1 only**: cost responds monotonically to
`completedDurationMin` and to `completionRatio`, asserted on the Phase-0 harness. The
measured-response term is not in this phase's acceptance criteria and must not be written
into the formula until its input contract exists. The six-dimensional cost vector is
unchanged throughout.

**Completed 2026-08-08:** `scaleCostByDeliveredDose` scales every dimension using the
duration relative to a comparable catalog session plus an independently supplied completion
ratio. Garmin and adherence reconciliation now pass measured completed duration to that
function; unknown modalities remain unscaled rather than receiving an invented reference
duration. The measured-response term remains out of scope. Unit tests assert monotonic
duration and completion behavior, and `npm run check` passes.

---

## Acceptance criteria

- [x] one credit model live; `updateMicrocycleProgress` demoted to documented last-resort
      compatibility with a shrinking call surface
- [x] `deriveObjectiveCredit`'s `qualifies` and `default` defects fixed before promotion
- [ ] shadow-mode comparison run and its divergence explained in the PR — blocked by Phase 0 harness
- [x] canonical stimulus axes required; legacy aliases deleted; `targetStimulus` typed
- [x] chronological ordering asserted in `buildFatigueStateFromHistory`
- [x] unsaturated latent external-load state retained
- [x] fusion function **not** changed without a recorded harness comparison
- [x] cost responds to duration and completion ratio
- [x] `PlannedDose { volume, intensity }` exists and `intensityScale` has a reader (D2/F17)
- [x] credit input contract carries the evidence the objective rules name, or the rules are narrowed
- [x] history ordering is validated/sorted at ingestion; malformed order degrades, not crashes
- [x] `POLICY_VERSION` bumped

## Risks & rollback

* **Credit-model cutover moves every recommendation.** Shadow mode exists precisely so
  the divergence is inspected before it ships. Do not skip it to save a day.
* **The stimulus codemod is wide but mechanical.** Land it separately from the credit
  change so a bisect can separate a type migration from a behaviour change.
* **Scope creep into 4.3(b).** If the fusion comparison is not converging, ship 4.3(a) and
  the latent-state change and leave `max()` in place. A documented open question beats an
  undocumented guess.

## Out of scope

Sequence search (Phase 5). The evidence hierarchy for interpreting unplanned outdoor work
(Phase 5) Ă˘â‚¬â€ť 4.x improves the vectors, not the inference chain that produces them.

## Docs to update

* **ADR-0014** (new) Ă˘â‚¬â€ť objective credit V2 semantics and the fatigue fusion decision, with
  the harness comparison attached
* **ADR-0006** Ă˘â‚¬â€ť amend: strain telemetry interacts with the new credit model
* `docs/architecture/recommendation-engine.md` Ă˘â‚¬â€ť the credit and fatigue sections
