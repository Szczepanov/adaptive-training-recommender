# Phase 4 — Objective credit V2, and honest load

* **Status:** Ready — derivation-constant decision taken 2026-08-08 (see 4.2)
* **Depends on:** Phase 0 (hard), Phase 2 (ADR-0012 fixes the credit contract)
* **Unlocks:** Phase 5
* **Addresses:** F7, F8, F12
* **Rough effort:** 4–5 days

---

## Goal

Collapse three objective-credit models into one dose-sensitive model, finish the stimulus
vocabulary rename, and make delivered load respond to what was actually done — without
inventing constants the repository cannot justify.

---

## 4.1 — F7: one credit model

Today there are three:

| Model | Location | Status |
|---|---|---|
| Keyword substring on free text | `microcycle.ts:110-141` | live (fallback) |
| Stimulus-vector coverage ≥ 0.6 | `microcycle.ts:198-213` | live (primary) |
| Fractional dose-sensitive credit | `stimulus.ts:26-99` | **dead** |

The keyword matcher is directionally wrong, not merely approximate: `zone2_aerobic`
matches any type containing `running` or `cycling`, so a threshold ride credits Zone 2;
`threshold_quality` matches `hard` or `tempo`. Phase 1.2 already establishes that it must
not become the Garmin path.

**Target:** `deriveObjectiveCredit` becomes authoritative, with `requiredCredit` /
`completedCredit` / `projectedCredit` / `windowStart` / `windowEnd` / `priority` — all
already declared in `models.ts` and all unused — carrying real values from Phase 2's
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

A single generic formula is not appropriate — 15 abbreviated minutes should not equal a
75-minute race-specific ride because each "counts once".

| Objective | Credit should depend primarily on |
|---|---|
| `zone2_aerobic` | meaningful aerobic minutes |
| `threshold_quality` | accumulated work near threshold — `2×8`, `4×8`, `3×12` are not equivalent |
| `surge_repeatability` | effort count, duration, recovery pattern, and whether performed under aerobic load |
| `race_specific_endurance` | duration, fatigue resistance, continued pedalling after efforts, event-like context |
| `strength_maintenance` | useful sets and movement exposure at relative intensity, not elapsed time |

Implement as per-objective functions behind one interface. Resist collapsing them into a
shared formula with per-objective coefficients — that reintroduces F11's uncited-constant
problem in a new place.

### Shadow mode before cutover

Run V1 and V2 crediting side by side for one iteration, emitting both into the simulation
report. Compare objective-resolution counts per scenario. Cut over only when the
divergence is explainable — not merely when V2 runs without throwing.

## 4.2 — F8: finish the stimulus rename

`WorkoutStimulusProfile` carries 7 canonical + 5 legacy axes, **all optional**.
`canonicalizeStimulus` (`templates.ts:575-590`) fills both sides and invents two
derivations with no cited basis:

```ts
vo2MaxPower:       s.vo2MaxPower       ?? (s.surgeRepeatability   ? s.surgeRepeatability   * 0.8 : 0),
fatigueResistance: s.fatigueResistance ?? (s.thresholdDevelopment ? s.thresholdDevelopment * 0.7 : 0),
```

Consumers disagree on which vocabulary is authoritative — `optimizer.ts` reads legacy
only, `stimulus.ts` reads canonical-first. This is masked today only because both are
populated.

1. Make canonical axes **required**; delete the legacy aliases via a one-shot codemod over
   `templates.ts` and the catalog.
2. Type `WeeklyObjective.targetStimulus` as
   `Partial<Record<keyof WorkoutStimulusProfile, number>>` instead of
   `Record<string, number>`, so a typo'd axis is a compile error rather than a silent
   zero-coverage objective that can never resolve.
3. **Decision (2026-08-08): delete the derived fallbacks; make templates declare the axes
   explicitly.** `vo2MaxPower` and `fatigueResistance` become required fields that each
   template states outright, and the `* 0.8` / `* 0.7` derivations in
   `canonicalizeStimulus` are removed.

   The alternative — find a citation for the coefficients — is the wrong shape of work.
   No citation can justify a *repository-wide* claim that VO2 stimulus is uniformly 80% of
   surge stimulus across every template; that relationship varies per session by
   construction. Making 22 templates each declare two numbers is a couple of hours, removes
   two unexplained constants permanently, and forces the one person who knows what a given
   session develops to say so explicitly rather than having it inferred.

## 4.3 — F12: fatigue, in two separable pieces

**This section was revised after PR #5 review.** An earlier draft prescribed
`1 - exp(-x)` saturation plus a weighted external/internal combination. That is withdrawn:
it was not justified by anything in the review, and it is the exact practice F11
criticises. It may also be wrong — internal response (HRV/RHR/soreness) is partly a
*reaction to* the same external work, so a weighted sum double-counts load unless
calibrated, and `1 - exp(-x)` changes the state's scale and meaning, not just its
monotonicity.

### (a) Correctness — do now, no modelling judgement required

`buildFatigueStateFromHistory` seeds from `history[0].date`, and
`applyCompletedSessionLoad` floors `elapsedHours` at 0. Oldest-to-newest ordering is
therefore load-bearing and asserted only in a comment (`planner.ts:129`). Out-of-order
input silently mis-decays.

**Throw on unordered input.** One assertion, one test.

### (b) Modelling — do not pre-decide

Two real questions:

* **Saturation.** `Math.min(1, ...)` per axis (`fatigue.ts:104-111`) means two hard
  lower-body days ≈ one, at the ceiling. The model cannot represent "significantly deeper
  in the hole".
* **Fusion.** `combinedFatigue = max(external, internal)` lets a bad night fully *mask*
  accumulated external load, and vice versa.

**Approach:** retain an unsaturated latent external-load state so depth is not discarded
at accumulation time, keeping the clamped value only as a presentation/ranking projection.
That is a strictly information-preserving change and can land independently. Then use the
Phase 0 harness to **compare** candidate fusion functions against the coaching invariants
before committing to one — and record the comparison in an ADR, with the data.

This is deliberately slower than picking a formula. It is the process F11 asks for, and
this phase is the first opportunity to actually follow it.

## 4.4 — Dose-sensitive cost

`DEFAULT_COST_BY_MODALITY[modality][intensity]` returns a fixed vector; duration has
almost no authority, so a 40-minute hard ride and a 3-hour hard ride score nearly
identically. Move toward:

```text
base session cost × delivered dose × measured-response adjustment
```

Keep the six dimensions — they are a good abstraction. This does **not** require adopting
TSS/CTL/ATL as ground truth; it requires the existing vectors to respond to duration,
completion ratio and measured training effect. `DeliveredDose` in `stimulus.ts` already
has the right shape (`plannedDurationMin`, `completedDurationMin`, `completionRatio`) and
is unused.

---

## Acceptance criteria

- [ ] one credit model live; `updateMicrocycleProgress` demoted to documented last-resort
      compatibility with a shrinking call surface
- [ ] `deriveObjectiveCredit`'s `qualifies` and `default` defects fixed before promotion
- [ ] shadow-mode comparison run and its divergence explained in the PR
- [ ] canonical stimulus axes required; legacy aliases deleted; `targetStimulus` typed
- [ ] chronological ordering asserted in `buildFatigueStateFromHistory`
- [ ] unsaturated latent external-load state retained
- [ ] fusion function **not** changed without a recorded harness comparison
- [ ] cost responds to duration and completion ratio
- [ ] `POLICY_VERSION` bumped

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
(Phase 5) — 4.x improves the vectors, not the inference chain that produces them.

## Docs to update

* **ADR-0014** (new) — objective credit V2 semantics and the fatigue fusion decision, with
  the harness comparison attached
* **ADR-0006** — amend: strain telemetry interacts with the new credit model
* `docs/architecture/recommendation-engine.md` — the credit and fatigue sections
