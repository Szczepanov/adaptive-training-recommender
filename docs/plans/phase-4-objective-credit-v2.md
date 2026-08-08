# Phase 4 — Objective credit V2 and honest load

* **Status:** In progress — implementation tasks are committed; release approval remains blocked on the failing scenario-harness aggregate gate.
* **Blocked by:** Scenario evidence must be reconciled before Phase 4 is release-ready. Phase 0 is already implemented on `main`; its harness is available and is the gate reporting the failure, not a missing dependency.
* **Depends on:** Phase 0 (implemented harness), Phase 2 (ADR-0012 fixes the credit contract)
* **Unlocks:** Phase 5
* **Addresses:** F7, F8, F12
* **Rough effort:** 4–5 days

---

## Task board

Status legend: `[ ]` not started · `[-]` in progress · `[x]` finished.
Update the marker on the work-item heading **and** this table in the same commit.

| Task | Status | Summary | Primary files |
|---|:--:|---|---|
| 4.1 | `[x]` | One authoritative fractional credit model; deterministic V1→V2 divergence matrix replaces the obsolete live shadow model (F7) | `app/src/engine/stimulus.ts`, `microcycle.ts`, `planner.ts`, `phase4ReviewFixes.test.ts` |
| 4.2 | `[x]` | Canonical stimulus axes required; legacy persistence validated and converted at the boundary (F8) | `app/src/engine/models.ts`, `templates.ts`, `optimizer.ts`, `stimulus.ts`, `completedTraining.ts`, fixtures |
| 4.3a | `[x]` | Sort/assert history and retain unsaturated external load (F12) | `app/src/engine/fatigue.ts`, `trainingHistorySnapshot.ts` |
| 4.3b | `[x]` | Compare fatigue-fusion functions before choosing (F12) | Phase 0 harness, ADR-0014 |
| 4.5 | `[x]` | `PlannedDose { volume, intensity }`; authored PlanBlock owns both values in explicit mode (D2 / F17) | `app/src/engine/trainingIntent.ts`, `planner.ts`, `dose.ts`, `optimizer.ts` |
| 4.4 | `[x]` | Cost responds to delivered duration and completion ratio | `app/src/engine/completedTraining.ts`, `fatigue.ts` |

4.5 is numbered after 4.3 but landed before 4.4 because both touch the same dose path.
4.3(b) is complete as a comparison: it did **not** validate `max()` as safe; it only found
no evidence to replace it with the tested capped-addition candidate.

---

## Goal

Collapse the objective-credit paths into one dose-sensitive model, finish the stimulus
vocabulary migration, make planned dose follow authored plan blocks, and make delivered load
respond to what was actually done — without inventing constants the repository cannot justify.

---

## `[x]` 4.1 — F7: one credit model

The repository started Phase 4 with three competing semantics:

| Model | Location | Phase-4 disposition |
|---|---|---|
| Keyword substring on free text | `microcycle.ts` `updateMicrocycleProgress` | last-resort compatibility only |
| Stimulus-vector coverage ≥ 0.6 | former live/planner path | retained only for compatibility/regression comparison |
| Fractional dose-sensitive credit | `stimulus.ts` `deriveObjectiveCredit` | authoritative |

The keyword matcher is directionally wrong, not merely approximate: broad terms such as
`running`, `cycling`, `hard`, or `tempo` can classify the wrong objective. It therefore must
not become the Garmin or normal structured-history path.

`deriveObjectiveCredit` is authoritative at the untrusted/persisted boundary;
`deriveObjectiveCreditFromProfile` is the internal primitive for already-canonical profiles.
`requiredCredit` / `completedCredit` determine live resolution; `projectedCredit` is
forecast-only; `completedExposures` is a compatibility display projection.

### Credit semantics supported by current evidence

The contract currently carries a numeric stimulus vector, planned/completed duration,
completion ratio, modality, and category. It does **not** carry effort count, recovery
pattern, continued pedalling after efforts, aerobic-load context, or event-like context.
The rules are intentionally limited to evidence that exists.

* `zone2_aerobic`, `threshold_quality`, `surge_repeatability`, `vo2_max`, and
  `race_specific_endurance` derive their raw contribution from the relevant canonical
  stimulus axis/axes and, when both durations are measured, scale by
  `completedDurationMin / plannedDurationMin` clamped to `0..1`.
* An independently supplied `completionRatio` is separate evidence and scales the result
  independently.
* `strength_maintenance` does **not** use elapsed duration as a proxy for useful sets or
  relative load; it uses the stronger supported strength stimulus plus completion evidence.
* Qualification gates remain hard gates: failing modality/category/minimum-stimulus rules
  yields zero credit.

This fixes the concrete defect that 15 abbreviated minutes and 75 planned minutes with the
same inferred endurance stimulus could previously earn identical credit.

### Legacy fallback uses the same ledger

`updateMicrocycleProgress` remains only for records without usable structured stimulus.
A keyword match contributes a documented conservative `0.5` compatibility credit to
`completedCredit` instead of updating only `completedExposures`. Structured→legacy and
legacy→structured replay therefore produce the same result. One keyword-only record cannot
resolve a one-credit objective by itself.

The live and forecast paths now use the same compatibility projection constant, so
`completedExposures` cannot report a whole legacy exposure from a fractional credit amount
that the live path would still present as partial.

### Cutover evidence — amended after PR #11 review

The original plan required V1 and V2 to run side-by-side for one iteration and said
“Cut over only when the divergence is explainable.” The implementation had already cut over
while that checkbox remained open, which made the plan contradict the code.

That gate is **explicitly amended** rather than keeping the known-defective V1 model live in
parallel. The cutover evidence is now a deterministic semantic-divergence regression matrix,
plus the existing Phase 0 scenario harness. Every expected V1→V2 difference must be named
and tested; any new unexplained difference must fail review.

Required divergence matrix:

1. qualifying stimulus below V1's `0.6` coverage threshold earns fractional V2 credit
   instead of V1's zero;
2. abbreviated endurance work earns less credit than the same stimulus delivered for the
   planned duration;
3. malformed persisted stimulus (`string`, `NaN`, outside `0..1`) is rejected rather than
   entering the ledger;
4. keyword-only fallback contributes `0.5` to the authoritative ledger and is replay-order
   independent with structured evidence;
5. qualification failures still earn zero; and
6. future recommendations accumulate in `projectedCredit`, not `completedCredit`.

These cases are covered in `phase4ReviewFixes.test.ts`; exact authored plan-dose ownership is
also covered in `trainingIntentAcceptance.test.ts`. ADR-0014 records this cutover amendment.
The broader scenario harness remains a release gate and is **not** waived by this change.

---

## `[x]` 4.2 — F8: finish the stimulus rename and persistence boundary

`WorkoutStimulusProfile` now exposes eight required canonical axes. Typed producers and
consumers use that vocabulary; the old repository-wide derived fallbacks are not recreated.

Persisted historical data cannot be codemodded, so `readStimulusProfile` is the compatibility
boundary:

| Persisted record | Behaviour |
|---|---|
| Canonical fields present | Use canonical values per axis. |
| Legacy rename present for a missing corresponding canonical axis | Convert that valid legacy value. |
| Both present and disagreeing | Canonical wins and divergence is logged once per parsed exposure. |
| Neither vocabulary | `DataState.INVALID`. |
| Any supplied known axis is non-numeric, non-finite, or outside `0..1` | `DataState.INVALID`. |

The partial-canonical policy is explicitly **axis-local**. A valid legacy rename may backfill
only its missing canonical counterpart; canonical-only axes with no historical equivalent
remain zero when absent. A malformed legacy value is not silently ignored merely because a
canonical value also exists — malformed persistence is invalid input.

Engine-owned template normalization also clamps finite authored axes into the canonical
`0..1` range before they enter the typed catalog. This prevents a malformed authored number
from bypassing the stricter persistence reader simply because it originated in code.

---

## `[x]` 4.3 — F12: fatigue correctness and fusion evidence

### `[x]` 4.3a — chronological replay and unsaturated external load

History is validated/sorted at ingestion and replay asserts the chronological invariant it
relies on. External load retains an unsaturated latent state so repeated hard work can remain
“deeper in the hole” instead of losing information at a `1.0` clamp. A clamped projection
remains available to ranking/presentation.

### `[x]` 4.3b — fusion comparison

The Phase 0 harness compared current `max(external, internal)` fusion with the monotonic
`min(1, external + internal)` candidate:

* `max()` — **58.9%** rest/recovery days (169/287) at the original reviewed Phase-4 boundary
* capped addition — **70.4%** (202/287) at the same boundary

Both violated the current aggregate recovery-share gate. Capped addition was worse on that
metric and also has uncalibrated double-counting risk because internal response can partly
reflect the same external work. The supported conclusion is therefore **retain `max()` for
now; there is no evidence to replace it with this candidate**. It is not evidence that
`max()` is safe or calibrated.

### Harness boundary analysis (2026-08-08)

Phase 0 on `main` passed its aggregate gate at **34.8%** rest/recovery days (100/287). The
Phase 4 branch descended through the Phase 3 series, whose last pre-Phase-4 point already
failed at **52.3%** (150/287). That inherited failure is release debt, not a reason to retune
the bound.

The deterministic boundary analysis found:

| Boundary | Rest/recovery share | Interpretation |
|---|---:|---|
| Phase 3 / before Phase 4 (`89434d7`) | 52.3% | inherited failure |
| After 4.1 initial / 4.2 (`6d2ad01`) | 52.3% | no change |
| After 4.3a (`d6c3a23`) | 58.5% | unsaturated replay retains external-load depth |
| After 4.2 validation / 4.5 / 4.4 (`347cee4`) | 58.5% | no additional change |
| Original reviewed Phase 4 boundary (`81a1b75`) | 58.9% | 4.1 adds 0.4 percentage points |
| Post-stack/review-fix PR #11 run (`f475c8c`) | **44.3%** | improved, but still above the 40% release ceiling |

Do not retune the 5–40% bound or choose a fusion formula merely to force the metric green.
The latest measured aggregate failure remains a release blocker until a subsequent CI run
proves otherwise.

---

## `[x]` 4.5 — `PlannedDose`: give `intensityScale` its consumer (D2/F17)

`PlannedDose` is `{ volume, intensity }` and both dimensions have an owner. The persisted
contract is finite `volume ∈ [0,1]`, `intensity ∈ [0,1.2]`.

1. In ADR-0012 **explicit mode**, the active authored `PlanBlock` owns both values, bounded
   only by the persisted contract. The September plan therefore produces travel
   `0.6 / 0.8` and taper `0.5 / 1.0`; generic days-to-event periodization cannot overwrite them.
2. In **generic mode**, `resolvePlannedDose` retains the existing objective-urgency volume
   calculation and generic periodization intensity, bounded to the same persisted contract.
3. `resolveExecutionDose` rejects invalid/out-of-contract plan inputs, intersects valid
   volume with the clinical ceiling, and leaves intensity as a separate candidate-admissibility gate.
4. Recommendation/provenance paths carry both planned and execution doses.
5. The week-ahead planner uses the same `resolvePlannedDoseForDate` ownership rule on every
   projected date.

`trainingIntentAcceptance.test.ts` asserts exact build, travel, and taper values rather than
only checking that taper volume is lower than build volume. `dose.test.ts` covers the invalid
input boundary and `optimizer.test.ts` covers hard-session rejection below intensity `0.8`.

---

## `[x]` 4.4 — dose-sensitive completed-load cost

The six-dimensional cost vector remains the abstraction. `scaleCostByDeliveredDose` makes
completed cost respond to delivered duration relative to a comparable catalog session and,
when independently supplied, completion ratio. The catalog reference uses the authored
`durationMin`/`durationMax` range rather than silently choosing one boundary. Delivered
duration can scale cost down for abbreviated work but is capped at the fully delivered
intended dose (`1.0`) so an unusually long or inflated record cannot create unbounded raw
fatigue. Unknown modalities remain unscaled rather than receiving an invented reference.

The measured-response adjustment remains out of scope because the current delivered-dose
contract does not carry a reliable per-session measured-response field at every construction
site. It must not be added as a term that silently defaults to neutral.

---

## Forecast ledger ownership

The week-ahead planner previously mutated `completedCredit` for tomorrow/future picks even
though `WeeklyObjective.projectedCredit` existed specifically for forecast allocation.
Phase 4 now enforces the distinction:

* completed history owns `completedCredit`;
* forecast recommendations own `projectedCredit`;
* forecast unresolved state uses completed + projected credit;
* live unresolved state ignores projected credit; and
* displayed `objectiveCredits` carry the fractional V2 amount actually allocated.

Planner fan-out uses the same validated-profile V2 primitive as the live ledger and the same
compatibility exposure projection. `addressesObjectives` therefore cannot say “no credit”
while a separate planning model silently applies a partial contribution.

---

## Acceptance criteria

- [x] one credit model live; `updateMicrocycleProgress` is documented last-resort compatibility
- [x] `deriveObjectiveCredit` separates qualification from earned credit and has no unknown-objective default credit
- [x] original live V1/V2 shadow gate explicitly amended to a reviewed deterministic divergence matrix; expected deltas are named and tested
- [x] endurance/power objective credit responds to delivered duration when planned/completed duration is measured
- [x] keyword fallback updates the authoritative fractional ledger and is replay-order independent
- [x] planner display/ledger uses V2 fractional credit rather than the old 0.6 coverage gate
- [x] future planning owns `projectedCredit`; completed evidence is not mutated by forecast picks
- [x] live and forecast compatibility exposure projection share one named constant/helper
- [x] persisted canonical/legacy stimulus values are finite `0..1` numbers or the record is `INVALID`
- [x] partial-canonical persistence policy is documented and tested
- [x] canonical stimulus axes required downstream; legacy aliases are boundary-only
- [x] chronological ordering asserted in `buildFatigueStateFromHistory`; out-of-order replay equals ordered replay
- [x] unsaturated latent external-load state retained
- [x] fusion function not changed without a recorded harness comparison
- [x] fusion evidence is described as “retain max for now”, not “safe”
- [x] cost responds to bounded delivered duration and completion ratio
- [x] active authored PlanBlock owns bounded `PlannedDose` in explicit mode; generic periodization is fallback only
- [x] `PlannedDose { volume, intensity }` exists and `intensityScale` has a reader (D2/F17)
- [x] invalid execution-dose inputs fail closed
- [x] history ordering is validated/sorted at ingestion; malformed order degrades, not crashes
- [x] historical policy version is explicitly audit-only in the current replay build
- [x] `POLICY_VERSION` bumped
- [ ] Phase 0 aggregate scenario gate reconciled; latest measured PR #11 evidence is 44.3% rest/recovery, above the 40% ceiling

## Risks & rollback

* **Credit-model cutover is behavior-changing.** Expected V1→V2 divergences are now an
  explicit regression matrix. A new divergence must be explained and reviewed rather than
  silently accepted.
* **Persisted data is untrusted.** Invalid stimulus must remain a controlled data state, not
  a zero profile and not a source of `NaN` progress.
* **Projection must not masquerade as completion.** Keep `projectedCredit` ephemeral and
  never persist it as completed evidence.
* **Fusion remains unresolved modelling debt.** If a future candidate is not supported by
  better evidence, retain `max()` rather than introducing an uncited formula.
* **Historical audit is not historical execution.** Old `policyVersion` values are readable
  evidence, but this build refuses to replay a decision function it no longer contains.

## Out of scope

Sequence search (Phase 5). The evidence hierarchy for interpreting unplanned outdoor work
(Phase 5) is also out of scope: Phase 4 improves vectors, dose semantics, and ledger
authority, not the inference chain that produces those signals.

## Docs updated

- [x] **ADR-0014** — objective credit V2 semantics, cutover-evidence amendment, plan-dose ownership, projected-credit ownership, and fatigue-fusion interpretation
- [x] **ADR-0006** — completed-load replay and the completed fusion comparison interpretation
- [x] `docs/architecture/recommendation-engine.md` — live credit, planned/execution dose, forecast ledger, completed-load, fatigue and replay sections
- [x] `docs/README.md` — ADR-0014 index entry and encoding
