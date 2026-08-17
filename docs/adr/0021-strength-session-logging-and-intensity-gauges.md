# ADR-0021: Strength Session Logging and Intensity Gauge Semantics

* **Status:** Accepted
* **Date:** 2026-08-17
* **Proposed:** 2026-08-17
* **Deciders:** Repository owner
* **Related:** [ADR-0005](./0005-raw-archive-store-and-rebuild-pipeline.md) (raw-source-of-truth and rebuild precedent), [ADR-0010](./0010-decision-provenance-and-audit-replay.md) (replay), [ADR-0014](./0014-objective-credit-v2-and-honest-load.md) (**D-FUSE** — measure before choosing), [ADR-0020](./0020-subjective-baselines-in-readiness-mode.md) (**D-SUBJCAL** — synthetic evidence is not sufficient to ship)
* **Implemented by:** [`strength-session-logging.md`](../plans/strength-session-logging.md)

> **Acceptance boundary.** Accepting this ADR approves the **persisted logging schema**, the intensity-gauge semantics, and the 1RM write-back ownership rule. It does **not** approve letting strength work contribute dimensional fatigue or stimulus to recommendations. That remains a separate go/no-go under **D-STRCOST**, requiring measurement against the current behaviour on real logged data.

---

## Context

`workouts/exercises.ts`, the strength catalog, `StepTarget`/`IntensityTarget`, and `AthletePerformanceProfile.estimated1RmKg` let this system prescribe structured strength work — including reps-in-reserve targets, `estimated_1rm_percent` loads, and `technical_quality` stop conditions. The return path does not exist. `buildTrainingHistorySnapshot` declares `manualTraining` as a first-class history source and hardcodes it to `{ status: 'MISSING' }`; `estimated1RmKg` has readers and no writer. Full findings are in [`2026-08-17-strength-logging-gap.md`](../analysis/2026-08-17-strength-logging-gap.md).

Building the return path forces three questions that cannot be deferred to the implementer, because each is expensive or impossible to reverse once athlete data exists.

### The intensity gauge is not one number

**For failure-limited work, RPE and RIR are the same scale inverted.** The RPE scale used in resistance training (Zourdos et al., 2016 — the RIR-based RPE scale for resistance exercise) is defined against reps in reserve: RPE 10 = 0 RIR, 9 = 1, 8 = 2, 7 = 3. Logging "RPE 8" and logging "2 RIR" are the same measurement in different vocabulary; powerlifting practice prefers RPE and uses half-points, hypertrophy literature prefers RIR.

**For speed and power work, proximity to failure is not merely a different number — it is the wrong instrument.** A power snatch, jump, throw or sprint is never taken near failure. The set terminates when output quality degrades; further repetitions remain physically available but slow, which defeats the training intent. The established gauges in that domain are velocity loss (Sánchez-Medina & González-Badillo, 2011, on velocity loss as a neuromuscular-fatigue indicator during resistance training) and explicit technical stop conditions.

The prescription side of this repository **already encodes that distinction correctly**: `hang_power_clean`'s instruction reads *"Use light-to-moderate loads and crisp speed. Stop before bar speed drops."*, and `IntensityTarget` carries a `technical_quality` variant with `stopConditions`. Only a logging schema would collapse the two.

**A second, unrelated RPE exists.** Session RPE (Borg CR-10, applied to training load by Foster et al.) is a single whole-session rating multiplied by duration to produce a load figure. It is a different construct from any set-level gauge and is the one potentially relevant to `fatigue.ts` as a global internal-load term.

> **Citation standard.** The works above are named by author, year and finding. Unlike ADR-0020, PMID/DOI identifiers have not been verified against a database and are deliberately omitted rather than approximated. Anyone hardening this ADR to ADR-0020's citation bar should add verified identifiers; nothing in the decisions below depends on a specific identifier being correct.

### The estimator is only valid on part of the data

Epley (1985) and Brzycki (1993) style 1RM estimates are derived from repetitions performed near momentary failure. Applying either to a deliberately fast, submaximal power triple returns a number with no physiological meaning. Since `estimated1RmKg` feeds prescription through `estimated_1rm_percent`, a polluted estimate does not stay contained — it propagates into every subsequent prescribed load.

RIR self-estimates also degrade with distance from failure. This repository's own `taper-race.ts` sets `primer_rir` to a default of 6 (range 4–8); at that distance the value functions as a coaching instruction, not a measurement.

### Two audiences want different shapes of the same data

Progressive-overload tracking wants durable per-set history queryable per exercise over time. The engine wants six-dimensional `WorkoutCostProfile` and `WorkoutStimulusProfile` values. Persisting only the second permanently destroys the first; persisting only the first leaves the engine blind. ADR-0005 already resolved this class of problem for wearable data, by archiving raw provider payloads and rebuilding derived state from them offline.

---

## Decision

### D-GAUGE — set intensity persists as a tagged gauge, never a bare number

A logged set's intensity is stored as a discriminated union carrying its own scale:

```ts
type IntensityGauge =
    | { scale: 'rir'; value: number }
    | { scale: 'rpe_rts'; value: number }
    | { scale: 'velocity_loss'; percent: number }
    | { scale: 'technical'; met: boolean; note?: string };
```

**The persisted value is what the athlete entered.** No conversion occurs on write, including between `rir` and `rpe_rts` where a conversion is arithmetically exact. Converting at the persistence boundary would discard which instrument was used, and the instrument is the part that determines whether the value is admissible downstream (D-1RMSRC, and any future D-STRCOST mapping).

Conversion **is** permitted at read time — for display, for comparing a logged set against a prescribed target, or for charting. Read-time conversion is recomputable and revisable; write-time conversion is neither.

`rir` and `rpe_rts` are mutually convertible because they measure one construct. `velocity_loss` and `technical` are **not** convertible to either, in either direction, and no code may treat them as such. They answer a different question.

Session RPE is stored as a separate session-level field and is never typed as an `IntensityGauge`. The two must not share a field name, a type, or a consumer.

### D-SETLOG — the raw per-set log is the source of truth

`users/{userId}/strength_sessions/{sessionId}` holds the per-set record: load, repetitions, gauge, warm-up flag, completion timestamp, notes. Every downstream artifact — 1RM estimates, dimensional cost, tonnage, charts — is **derived from it and recomputable from it**, and nothing derived is ever written back into it.

This is ADR-0005's rebuild philosophy applied to athlete-entered data rather than provider payloads, and for the same reason: when a derivation formula changes, the correct response is to recompute from the retained raw record, not to discover the inputs were discarded.

Two consequences are load-bearing rather than incidental:

* **Rest duration is derived from consecutive set timestamps, not stored.** A separately stored rest field is a second source of truth that can disagree with the timestamps.
* **Warm-up sets are recorded, flagged, and retained.** They are excluded from tonnage and from 1RM estimation, but deleting them would discard genuine performed work that Step C may later need to cost.

### D-1RMSRC — a derived 1RM is its own ownership rung and never overwrites a human value

`AthletePerformanceProfile.targetSources` exists, in its own words, so that *"Field-level ownership prevents a Garmin refresh from replacing a coach target."* A derived 1RM joins that mechanism as an additional source rather than bypassing it.

A derived estimate may populate a target whose source is absent or already `derived`. It may **never** overwrite `manual` or `coach`. Where a derived estimate and a human-set value disagree, the human value stands and the disagreement is surfaced rather than silently resolved.

Derivation is admissible only from sets whose gauge indicates proximity to failure. `velocity_loss` and `technical` gauged sets, warm-up sets, and sets beyond a stated distance-from-failure threshold are excluded. **A set with no gauge at all is excluded by default**; any fallback that admits ungauged sets is a policy choice that must be stated explicitly where it is implemented, not assumed.

### D-STRCOST — strength load reaches the engine only after measurement

The mapping from a set log to `WorkoutCostProfile` and `WorkoutStimulusProfile` is built **default-off** and compared against current behaviour on real logged data before any decision to enable it. Coefficients come from that evidence, not from this ADR.

This is the same discipline as **D-FUSE** (ADR-0014) and **D-SUBJCAL** (ADR-0020), and for the same reason: naming a tonnage-to-fatigue or volume-to-stimulus coefficient in an architecture document would assert as settled exactly the kind of uncited constant that finding F11 of the 2026-08-08 architecture review criticised.

Recording "no material improvement, not enabling" satisfies this decision. Per **D-BEAM**, a negative result is a valid and useful outcome; shipping is not the success condition.

Two constraints hold regardless of the eventual mapping:

* **An unidentified exercise degrades, it does not fail.** A free-text lift has no `exercises.ts` metadata and therefore no defensible dimensional cost. It joins the existing evidence ladder at low `stimulusConfidence` rather than receiving a guessed profile — the same treatment `genericModalityFallback` already gives an unclassified Garmin session. Logging still works; only engine credit is discounted.
* **Enabling this is a policy change.** It requires a `POLICY_VERSION` bump, keeps `check-policy-drift.mjs` green, moves the committed scenario baseline deliberately rather than incidentally, and must leave ADR-0010 replay of pre-change decisions reproducible.

### Resolved schema questions

Settled here so they are not relitigated during implementation:

* **Session date** is the Warsaw-local calendar date of session *start*, fixed at creation and never recomputed on completion. A session spanning midnight belongs to its start date.
* **Session state** is `in_progress | completed | abandoned`. A session is created on start, not on finish. An abandoned session retains its logged sets — partial work occurred.
* **Durability** is per set, not per session. A set is persisted when logged; completion is a state transition, not the first write.
* **`schemaVersion: 1` is carried** on this document, unlike the Garmin activity record, because it is client-written and its parser is authored alongside it. The version is pinned in Firestore rules from the outset.

---

## Consequences

### Positive

* Progressive-overload history, self-calibrating prescription, and engine integration are separable; the first two deliver with no effect on any recommendation.
* Retaining the raw log means a changed cost or 1RM formula is a recomputation, not a data-loss event.
* Tagging the gauge makes the 1RM estimator's admissibility rule expressible and testable rather than a comment.
* The strength half of the catalog stops being write-only; prescriptions can escape permanently relative targets.

### Negative

* Four gauge variants are more schema than a single number, and the UI must make choosing one cheap or athletes will pick wrongly.
* Per-set persistence requires offline durability, which changes Firestore read timing for every collection in the application, not only this one.
* A client-written training-history collection needs real rules validation with array bounds — an obligation `activities` avoided by being server-only.

### Neutral

* Session RPE is captured but unconsumed. Whether sRPE × duration becomes an engine input is a separate decision on the same measured footing as D-STRCOST.
* Rest duration is derived and retained but deliberately unused until Step C has a measured baseline to compare against.

### Explicitly accepted modelling risk

Self-reported RIR and RPE are imperfect instruments whose accuracy varies with training experience, proximity to failure, and exercise. This ADR accepts that imprecision for **logging and prescription calibration**, where the alternative is no data at all. It does not accept it for decision-making: that is precisely what D-STRCOST holds back for measurement.

---

## Alternatives considered

**Store a single `rpe: number`.** Rejected. It cannot distinguish a failure-limited hypertrophy set from a quality-limited power triple, which is the exact distinction the 1RM estimator must act on. The field would be simpler and silently wrong.

**Normalise every gauge to one canonical scale on write.** Rejected. Exact between `rir` and `rpe_rts`, meaningless for `velocity_loss` and `technical`. It also discards the instrument, which is the information D-1RMSRC depends on. Read-time conversion obtains the same convenience without the loss.

**Store only engine-shaped dimensional cost.** Rejected. It would satisfy the engine and permanently destroy progressive-overload history, which is one of the three stated goals and the one deliverable soonest.

**Let a derived 1RM overwrite any stored value.** Rejected. It reintroduces from a new direction the precise failure `targetSources` was built to prevent, and would silently discard a value the athlete or a coach set deliberately.

**Adopt a third-party logger and import its export.** Rejected for now. It leaves prescription and completion in separate systems, requires an exercise-identity mapping layer in perpetuity, and the imported record would carry no gauge semantics — making D-1RMSRC's admissibility rule unenforceable on imported data. Recorded as out of scope in the implementing plan rather than foreclosed.
