# Strength session logging: the missing return path (2026-08-17)

**Question asked.** The athlete has an AI prescribe gym work (strength, power, speed) but records nothing — no weight, reps, sets, rest, RPE or notes. Third-party loggers (Strong) hold the data behind a closed boundary. What should be built?

**Key finding.** This is not a missing app. The prescription half of strength training is already built and reasonably sophisticated in this repository; the **return path is a declared stub**. `manualTraining` is a first-class training-history source in `trainingHistorySnapshot.ts` that is hardcoded to `{ status: 'MISSING' }`, and `AthletePerformanceProfile.estimated1RmKg` has readers but no writer.

---

## 1. What already exists

Verified against the current tree, not inferred.

| Capability | Location |
|---|---|
| Strength exercise library with `movementPatterns`, `primaryMuscles`, `equipment`, `impact`, `eccentricLoad`, `coordinationDemand`, `contraindicationTags`, coaching `instruction` | `workouts/exercises.ts` |
| Strength session catalog — upper, lower, support, travel primers, taper primers | `workouts/catalog/strength.ts`, `strength-lower.ts`, `support-strength.ts`, `travel.ts`, `taper-race.ts` |
| Prescription intensity targets: `rpe`, `reps_in_reserve`, `estimated_1rm_percent`, `technical_quality` | `StepTarget.metric` / `IntensityTarget` in `workouts/models.ts` |
| Per-exercise 1RM store with positive-number validation | `AthletePerformanceProfile.estimated1RmKg`; validated in `engine/validation.ts` |
| Field-level target ownership so an import never clobbers a manual value | `AthletePerformanceProfile.targetSources` (`'garmin' \| 'manual' \| 'coach'`) |
| Strength stimulus axes | `WorkoutStimulusProfile.maxStrength`, `.hypertrophy` |
| Strength-relevant fatigue dimensions | `WorkoutCostProfile.lowerBody`, `.upperBody`, `.neuromuscular`, `.impactTissue` |
| Strength session categories | `SessionTemplate.category`: `Upper-body Strength`, `Lower-body Strength`, `Full-body Strength`, `Power Maintenance` |
| Sets / reps / set-recovery / notes in the imported-plan schema | `ExternalPrescriptionStep` in `engine/models.ts` |
| Evidence ladder for degrading confidence when identity is unknown | `EvidenceTier`, `stimulusConfidenceForTier` in `engine/completedTraining.ts` |

The engine can already prescribe "front squat, 4×5 @ RIR 3" and reason about what it costs the legs before the next day's ride.

---

## 2. The gap

### 2.1 `manualTraining` is a declared source that nothing writes

`buildTrainingHistorySnapshot` in `engine/trainingHistorySnapshot.ts` returns:

```ts
sourceStates: {
    activities: summarizeDataState(activities),
    recommendations: summarizeDataState(recommendations),
    manualTraining: { status: 'MISSING' },
}
```

`manualTraining` also appears in the `firestore.rules` audit allowlist alongside `activities` and `recommendations`. The slot for exactly this data exists, is wired through the audit contract, and is permanently empty.

### 2.2 `estimated1RmKg` has readers but no writer

Prescription consumes it through the `estimated_1rm_percent` target. `workouts/prescription.test.ts` contains a test named *"keeps strength prescription relative when no 1RM is known"* — the system degrades gracefully to vague relative targets and has no mechanism to ever stop doing so. Nothing in the tree writes `estimated1RmKg`.

### 2.3 Strength work is invisible to fatigue

With no completed-strength record, a heavy squat session contributes nothing to `lowerBody` or `neuromuscular` cost. The next day's cycling recommendation is computed as though it never happened.

---

## 3. Constraints discovered

1. **No offline persistence is configured.** `firebase.ts` calls `initializeFirestore(getApp(), { ignoreUndefinedProperties: true })` with no `localCache`. Every existing write in this app is a desk-chair action (a check-in, a preference edit) so this has never mattered. Set logging happens on a gym floor, frequently without signal, and mid-session data loss is the failure mode that makes a logger get abandoned. **This is a precondition, not an enhancement.**

2. **This would be the first client-written training-history source.** `activities` is server-only (`allow write: if false`) and therefore carries no `firestore.rules` validation. Every client-writable collection here — `daily_subjective_checkins`, `decision_journal`, `goals`, `external_plans` — has a `hasValid*` validation function with an explicit `keys().hasOnly(...)`/`hasAll(...)` allowlist. A strength log needs the same, including array bounds: an unbounded client-written set array is the obvious abuse path.

3. **`targetSources` already solves the 1RM write-back ownership problem** — its comment states the intent plainly: *"Field-level ownership prevents a Garmin refresh from replacing a coach target."* A derived 1RM must join that scheme rather than writing blind, or it reintroduces from a new direction exactly the bug that mechanism exists to prevent.

4. **Warsaw-local date attribution.** A session starting 23:30 and finishing 00:20 needs a stated rule (session **start**, Warsaw-local, per `CLAUDE.md`). Same class of issue as lap-crossing-midnight in the Garmin telemetry analysis.

5. **Engine consumption is a policy change.** Deriving `WorkoutCostProfile` / `WorkoutStimulusProfile` from set logs alters real recommendations: `POLICY_VERSION` bump, `check-policy-drift.mjs`, a moved `simulate:diff` baseline, and ADR-0010 replay reproducibility. Logging and 1RM derivation carry none of this weight.

---

## 4. Domain finding: the intensity gauge is not one number

A design assumption worth recording, because it is load-bearing for the schema and is easy to get wrong.

**RPE and RIR are the same scale for strength and hypertrophy.** The RPE used in lifting (Tuchscherer / RTS) is defined as an inversion of reps-in-reserve: RPE 10 = 0 RIR, 9 = 1, 8 = 2, 7 = 3. Logging "RPE 8" and logging "2 RIR" are the same measurement in different vocabulary. Powerlifting convention says RPE (and uses half-points such as 9.5); hypertrophy literature says RIR.

**Speed and power work needs a different construct entirely — not a different failure scale.** A power snatch, jump, sprint or med-ball throw is never taken near failure. The set ends when *output quality* degrades, not when repetitions run out; more reps are physically available but slow, which defeats the intent. Proximity-to-failure is therefore not merely a different number, it is the wrong measurement. The correct gauges are velocity loss (stop at ~10–20% drop from the best rep), technical stop conditions, or %1RM at a fixed low rep count.

**The catalog already encodes this correctly.** `hang_power_clean`'s instruction reads *"Use light-to-moderate loads and crisp speed. Stop before bar speed drops."*, and `IntensityTarget` carries a `technical_quality` variant with `stopConditions`. The prescription side already distinguishes quality-limited from failure-limited work; only the logging side would collapse them.

**A second, unrelated RPE exists.** Session RPE (Borg CR-10 / Foster) is one whole-session rating multiplied by duration to yield a training-load figure. It is a different construct from set-level RPE and is the one relevant to `fatigue.ts` as a global internal-load input. The two must not share a field name.

**Caveat on far-from-failure RIR.** `taper-race.ts` sets `primer_rir` to a default of 6 (range 4–8). RIR self-estimates degrade badly that far from failure; at that distance the value functions as a coaching instruction ("stay fast, stay fresh") rather than a measurement, and should not be treated as precise data.

### 4.1 Consequence

A single `rpe: number` field is not sufficient. The gauge must be **tagged** with its scale, because the same numeral means different things across qualities — and because **Epley/Brzycki 1RM estimation is only valid on sets taken near failure.** Feeding the estimator a deliberately fast, submaximal power triple yields a garbage 1RM that then corrupts every prescription derived from it. The scale tag is the mechanism that lets the deriver exclude those sets, which makes this a schema decision that must precede implementation rather than follow it.

---

## 5. Recommended shape

Store one raw log; derive twice. Never blend.

```
users/{userId}/strength_sessions/{sessionId}    raw truth: per-set load/reps/gauge/notes
        ├──► estimated1RmKg  (gauge-filtered)   self-calibrating prescription
        └──► CompletedExposure (manualTraining)  engine fatigue and stimulus
```

Storing only what the engine needs permanently loses overload history; storing only what charts need leaves the engine blind. The raw log must remain the source of truth and both derivations must be recomputable from it.

Sequencing follows the risk, and each step independently delivers one goal: logging (overload history, no policy risk) → 1RM derivation (self-calibrating prescription, no policy risk) → engine consumption (fatigue integration, **policy change requiring measurement**).

Execution detail is in [`docs/plans/strength-session-logging.md`](../plans/strength-session-logging.md).
