# HRF3 trace-diagnostics review hardening

**Date:** 2026-08-29
**Scope:** follow-up review of PR #286 (`feat(hrf): add deterministic HR trace diagnostics`)
**Status:** implemented on the PR branch; shadow-only behavior remains unchanged

## Why this follow-up exists

The first HRF3 implementation established the correct architectural boundary: pure transient FIT analysis, explicit `UNKNOWN` vs assessed `UNRELIABLE`, no persistence, and no recommendation-policy effect. A deeper contract and scientific review found several places where otherwise valid FIT files or normal exercise physiology could be mistaken for measurement failure.

The fixes below intentionally bias toward **specific evidence over aggressive artifact detection**. HRF3 is a measurement-fidelity layer, so a false artifact label is not harmless: later authority logic can remove HR-derived evidence from max-HR, threshold, decoupling, zone, load, or health-anomaly uses.

## Findings and changes

### 1. FIT recording cadence is not a 1 Hz contract

Garmin's FIT Activity documentation permits `record` messages at regular **1, 5, 10, or 30 second** intervals and also permits irregular **Smart Recording**. Timer events are the intended mechanism for distinguishing recording cadence from pauses.

The original HRF3 estimator ignored intervals above 10 seconds when estimating cadence and then fell back to 1 second. A completely valid 30-second trace could therefore be classified as severely under-covered.

**Implemented:**

- coverage is now the fraction of unique active FIT record timestamps that contain valid HR, rather than coverage against an invented fixed-rate grid;
- observed record cadence is retained for time-gap interpretation;
- 30-second regular recording remains valid;
- Smart Recording irregularity is reported separately as `sampling_irregularity_pct` and does not by itself lower confidence;
- long time gaps remain visible and can still become dropout evidence when they materially exceed the observed/documented cadence.

This separates two different questions:

```text
Did the FIT record surface contain HR when it recorded a sample?
!=
Was the FIT record cadence perfectly regular?
```

### 2. Timer topology must be conservative, not merely parseable

Timer events can begin before the first record and end after the last record. Incomplete topology can also occur in malformed or partially observed evidence.

The original state machine could omit the initial active segment when the first observed timer event was a stop, while still treating later windows too optimistically.

**Implemented:**

- event windows are clamped to the observed record span;
- a leading stop can preserve the inferable first-record-to-stop segment but forces `PARTIALLY_ASSESSABLE`;
- duplicate/missing/unknown timer transitions cannot become fully assessable;
- raw numeric FIT timer enum fallbacks are recognized alongside decoded string values;
- artifact detectors execute **inside each active timer window**, so physiological/workload comparisons never bridge a pause.

### 3. Running FIT cadence is stride cadence, not displayed step cadence

Garmin's running UI describes cadence in steps per minute, while Garmin developer guidance for the FIT/Connect IQ cadence field describes running cadence as **stride cadence** and instructs consumers to multiply by two for step cadence. That distinction is load-bearing for cadence-lock detection.

The first HRF3 running detector compared HR directly with raw FIT cadence. A classic wrist-PPG crossover such as ~180 bpm reported HR with ~90 raw running cadence would therefore be missed.

**Implemented:**

```text
running candidate: HR ~= 2 * FIT record.cadence
cycling candidate: HR ~= 2 * cycling cadence (harmonic candidate)
```

The current decoder does not retain FIT `fractional_cadence`; its maximum sub-RPM contribution maps to less than two running steps/minute and remains inside the v1 tolerance band. If later replay shows that precision matters, HRF2 should add that field explicitly rather than hide the approximation.

### 4. Cadence coincidence is not enough to call signal crossover

PPG literature describes **signal crossover**: periodic motion can be mistaken for the cardiovascular pulse. That supports cadence-aware diagnostics, but it does not justify labelling every numerical cadence/HR coincidence as artifact.

**Implemented cadence/harmonic candidates now require all of:**

- modality-specific ratio;
- minimum paired cadence coverage;
- minimum sample count;
- minimum duration;
- meaningful movement-cadence variation (constant 90 rpm + 180 bpm is not enough);
- high match percentage through that changing cadence;
- independent FIT power coverage with stable power context across thirds.

If independent workload context is unavailable, v1 stays conservative and emits no cadence-lock artifact. This is deliberately lower-recall but safer for later authority gating.

### 5. Abrupt HR changes need persistence and independent workload context

A universal pairwise bpm jump is too brittle around legitimate intervals. HR also has physiological lag relative to workload.

**Implemented:**

- candidate pairwise changes are only the trigger to inspect a wider local window;
- local pre/post HR medians must establish a persistent level change;
- both sides must persist for a minimum duration;
- independent power must be sufficiently covered;
- pre/post power medians must remain similar before `ABRUPT_JUMP` / `ABRUPT_DROP` is emitted.

A large power-backed interval transition is therefore a negative control rather than an artifact.

### 6. Plateau/workload discordance must be sustained

The original whole-trace range test could be triggered by one power outlier against a flat HR trace.

**Implemented:**

- evaluate rolling 180-second blocks;
- require near-flat HR across the block;
- split the block into thirds;
- require enough power samples in each third;
- compare **median** power between thirds;
- require both absolute and relative sustained power change;
- never bridge timer pauses.

A one-sample power spike no longer creates `WORKLOAD_DISCORDANCE`.

### 7. Provenance ambiguity is now explicit evidence

The confidence cap already prevented ambiguous/mixed source evidence from becoming `HIGH`, but the output did not explain why.

**Implemented:**

- `PROVENANCE_AMBIGUOUS` is emitted for ambiguous or `mixed_possible` provenance;
- `SOURCE_UNKNOWN` is emitted for unknown source/provenance.

These are reasons, not signal-artifact flags: unknown provenance does not mean poor measured signal.

## Regression coverage added

The expanded HRF3 tests cover:

- valid 30-second FIT recording;
- irregular Smart Recording without artificial missingness;
- incomplete leading timer topology;
- timer event clamping;
- raw numeric timer enums;
- severe long gap vs sample coverage semantics;
- invalid-HR boundary dropout;
- pause-scoped detectors;
- persistent abrupt jump with stable power;
- legitimate power-backed interval transition;
- sustained plateau vs a single power spike;
- running raw FIT stride cadence conversion;
- constant-cadence negative control;
- sparse cadence negative control;
- missing independent workload negative control;
- ambiguous provenance reason visibility.

## Safety and activation consequence

No recommendation, readiness, load, Firestore, or frontend behavior changes in this follow-up. HRF3 remains shadow-only. These deterministic heuristics should still be treated as **candidate evidence**, not truth, until HRF8 replays representative real-account originals through the qualified runtime decoder and the independent paired-reference study measures false-positive/false-negative behavior by activity and sensor context.

## Research / protocol anchors

1. Garmin FIT SDK, **Encoding FIT Activity Files** — regular 1/5/10/30-second recording, Smart Recording, and timer-event semantics: https://developer.garmin.com/fit/cookbook/encoding-activity-files/
2. Garmin FIT SDK, **Decoding FIT Activity Files** — Smart Recording makes sample-spacing calculations more complex and timer events disambiguate pauses: https://developer.garmin.com/fit/cookbook/decoding-activity-files/
3. Garmin Developer Forums, **running cadence is stride cadence; multiply by two for step cadence**: https://forums.garmin.com/developer/connect-iq/f/discussion/3190/bug-range-of-average-cadence-is-half-of-the-range-of-cadence
4. Bent B, et al. *Investigating sources of inaccuracy in wearable optical heart rate sensors.* npj Digital Medicine. 2020;3:18. https://www.nature.com/articles/s41746-020-0226-6
5. Nelson BW, et al. *Guidelines for wrist-worn consumer wearable assessment of heart rate in biobehavioral research.* npj Digital Medicine. 2020;3:90. https://www.nature.com/articles/s41746-020-0297-4

## Review conclusion

The revised implementation better matches the approved HRF3 contract: timer-aware, cadence-aware, workload-aware, explainable, and conservative about what it can prove. The remaining uncertainty is empirical calibration, which belongs in HRF8 rather than being disguised as more v1 heuristics.
