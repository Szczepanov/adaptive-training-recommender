# ADR-0024: Metric-specific biometric baseline estimators

* **Status:** Accepted
* **Date:** 2026-08-20
* **Deciders:** Core Engineering Team

---

## Context

ADR-0006 introduced personal baselines for sleep score, resting heart rate (RHR), HRV,
respiration rate and steps, and later added observation-only median/MAD fields for those
metrics plus body battery, stress and training readiness.

A robust location/scale pair is attractive because wearable time series contain illness,
travel, unusually hard training, measurement artefacts and other excursions. That does **not**
mean one estimator should be used for every metric. These signals differ materially in
measurement process, distribution shape, physiological interpretation and the question the
engine is asking.

The project therefore rejects a generic "median/MAD is better than mean/stdev" migration.
Estimator choice is metric-specific and must be justified by replay evidence before it can
change a recommendation.

---

## Statistical interpretation

### Mean/stdev

Mean and standard deviation are efficient summaries when observations are approximately
well-behaved and symmetric, but both are sensitive to outliers and to genuine excursions
inside the reference window.

### Median/MAD

Median and median absolute deviation (MAD) are robust to a minority of extreme observations.
`calculate_mad` currently multiplies raw MAD by `1.4826`. That constant makes MAD a
**normal-consistent scale estimator**: under a Gaussian distribution its magnitude is
comparable to standard deviation. It does **not** make scaled MAD universally equivalent to
standard deviation for bounded, skewed, multimodal or quantized wearable metrics.

MAD can also be exactly zero when many values are tied/rounded. In that case any downstream
floor becomes part of the model rather than a measured estimate of the athlete's variability.
A floor must therefore be documented and calibrated as a heuristic; it must not be described
as device measurement resolution unless provider documentation or raw-data evidence supports
that statement.

Future comparison candidates may include trimmed means and robust scale estimators such as
Qn, but they are candidates for replay rather than additional production complexity by
default.

References:

* NIST Engineering Statistics Handbook, measures of scale / robust alternatives:
  https://www.itl.nist.gov/div898/handbook/eda/section3/eda356.htm
* NIST Dataplot Qn scale estimator:
  https://www.itl.nist.gov/div898/software/dataplot/refman2/auxillar/qn_scale.htm

---

## Metric policy

### Respiration rate

**Current baseline candidate:** trailing median + 28-day scaled MAD.

Rationale: elevated nightly respiration during systemic/respiratory illness can contaminate a
trailing mean/stdev reference window and reduce sensitivity after recovery. A robust baseline
is therefore a reasonable anomaly-detection candidate.

The literature supports respiration as a potentially useful early illness signal, including
wearable studies in which respiratory rate changed around respiratory infection. It does
**not** support calling respiration a specific illness detector. Wearable changes may reflect
multiple illnesses and other physiological/environmental causes.

The latent `median-mad-v1` scoring path remains **default-off** at the snapshot-to-engine
adapter. It may be enabled explicitly by comparison/replay tooling, but production callers
must not opt in until the release criteria below are satisfied.

Compatibility rules:

* `baselineComputationVersion < 3` respiration deltas were computed against mean baselines and
  must never enter the median/MAD scoring path.
* A v3+ snapshot without a measured `respiration28dMad` is also decision-inert. The engine
  must not substitute a generic floor for an unavailable personal spread estimate.
* The existing `1.0 br/min` scoring floor is a first-pass modelling heuristic. We do not have
  evidence that Garmin's exported nightly respiration has a documented 1 br/min measurement
  resolution; the floor must be calibrated from actual exported data/replay before live use.

Relevant evidence:

* Wearable respiration validation / respiratory infection signal:
  https://www.nature.com/articles/s41746-021-00493-6
* Early physiological changes in athletes around SARS-CoV-2 infection:
  https://pubmed.ncbi.nlm.nih.gov/37401442/
* Wearable illness detection cannot be assumed disease-specific:
  https://www.nature.com/articles/s41746-020-00363-7
* Garmin respiration overview:
  https://www.garmin.com/en-GB/garmin-technology/health-science/respiration-rate/

### Resting heart rate (RHR)

Keep the existing mean/stdev production path until replay shows a better alternative.
Observation-only median/MAD remains useful.

The likely best estimator depends on purpose:

* **acute anomaly detection:** a longer-window median is a strong candidate because it is
  resistant to transient high-RHR episodes;
* **gradual fitness/training drift:** mean or an exponentially weighted moving average (EWMA)
  preserves sustained small changes that a median may suppress.

NightSignal used the median of overnight-average RHR to establish a personal baseline for
illness/anomaly detection, while Garmin itself exposes rolling-average concepts for RHR.

References:

* NightSignal personal RHR baseline:
  https://www.nature.com/articles/s41591-021-01593-2
* Garmin RHR definition/support:
  https://support.garmin.com/en-GB/?faq=F8YKCB4CJd5PG0DR9ICV3A

### HRV

Do **not** treat median/MAD as the presumed successor to mean/stdev.

The sports-monitoring literature commonly evaluates repeated HRV using log-transformed
RMSSD-derived values, rolling averages and coefficient of variation (CV). HRV distribution
and interpretation differ from RHR/respiration; variability itself may carry useful recovery
information. A robust median can remove observations that are physiologically meaningful.

Before any HRV estimator cutover, compare at least:

1. current raw-domain mean/stdev;
2. median/MAD;
3. log-domain rolling mean plus rolling CV/SD.

Also verify exactly what Garmin's exported `hrvOvernightAvg` represents before assuming that
literature based on directly measured LnRMSSD transfers one-to-one.

Higher HRV must not be encoded as universally better without validation: unusually high
values can also fall outside an individual's normal range.

References:

* Review of HRV-guided monitoring, including rolling mean/CV concepts:
  https://pubmed.ncbi.nlm.nih.gov/41516438/
* Garmin HRV Status (personal baseline / rolling 7-day average):
  https://www.garmin.com/en-GB/garmin-technology/health-science/hrv-status/

### Sleep score

Sleep score is a bounded 0-100 vendor composite, not a raw physiological measurement. Garmin
combines sleep duration/stages, interruptions/restlessness and overnight stress/recovery
information. Scaled MAD therefore must not be interpreted as a physiological "sigma".

Keep median/MAD observation-only. For decision logic, compare personal-baseline approaches
against simpler semantics such as:

* last-night absolute score;
* short multi-night history/debt;
* trend/EWMA.

Consumer-wearable sleep estimates also have non-trivial error relative to polysomnography,
which further argues against over-precise z-score interpretation.

References:

* Garmin sleep tracking / Sleep Score:
  https://www.garmin.com/en-IE/garmin-technology/health-science/sleep-tracking/
* 2025 systematic review/meta-analysis of consumer wrist sleep trackers:
  https://pubmed.ncbi.nlm.nih.gov/39484805/

### Steps

Steps have two distinct semantics and should not share one estimator policy:

* **habitual activity baseline / surge detection:** median is a useful candidate because a
  small number of very high-step days should not redefine "normal" ambient walking;
* **actual mechanical/external load:** a 25k-step hike is real load, not noise. Sum, mean,
  EWMA or explicit activity accounting must preserve it rather than robustly discard it.

The current `fatigue.ts` usage is an ambient-step surge detector after estimated structured
activity steps are removed. A median baseline is therefore worth replaying here. A
same-weekday/weekday-aware baseline should also be tested because stable weekend walking or
hiking patterns can otherwise make weekday comparisons misleading.

Reference:

* Day-to-day step variability / number of measurement days needed for habitual activity:
  https://www.nature.com/articles/s41598-021-89141-3

### Body Battery, stress and Training Readiness

Keep all personal-baseline fields observation-only.

These Garmin metrics are not statistically independent upstream signals:

* stress is primarily derived from heart rate / HRV;
* Sleep Score already contains recovery/stress-related information;
* Body Battery uses stress/HRV and sleep-related inputs;
* Training Readiness combines Sleep Score, HRV Status, acute load, recovery time, sleep
  history and stress history.

Therefore the engine must **not** simply add positive strain weights for HRV + sleep + stress
+ Body Battery + Training Readiness. That would count substantially overlapping physiology
multiple times.

If Training Readiness is ever consumed, choose one of two explicit designs and compare them:

1. use Garmin Training Readiness as a weak composite/expert prior; or
2. use the project's own constituent-signal model.

Do not blindly sum both models.

References:

* Garmin stress tracking:
  https://www.garmin.com/en-US/garmin-technology/health-science/stress-tracking/
* Garmin Body Battery:
  https://www.garmin.com/en-CA/garmin-technology/health-science/body-battery/
* Garmin Training Readiness components:
  https://www8.garmin.com/manuals/webhelp/GUID-2C274FD2-F0C3-445C-B0AC-700FECCE12E9/EN-US/GUID-C21BE0C8-A08E-4DA1-B6C6-2E0E2DDDB372.html
* Garmin HRV-related metric derivation overview:
  https://support.garmin.com/en-GB/?faq=04pnPSBTYSAYL9FylZoUl5

---

## Release criteria for any estimator or weight change

Observation is not validation. A statistic becomes decision-relevant only after a recorded
comparison using real or representative histories.

At minimum, the comparison must report per metric:

* mean-minus-median difference;
* stdev/MAD relationship;
* zero-MAD frequency;
* ties/quantization frequency;
* missingness / coverage;
* skew/outlier frequency;
* autocorrelation;
* weekday effects where applicable;
* pairwise correlations with other candidate readiness signals.

Candidate estimators to compare where relevant:

* mean/stdev;
* median/MAD;
* trimmed mean / Qn or another justified robust scale;
* log-HRV rolling mean + CV/SD;
* EWMA for slow drift;
* weekday-aware steps.

The decision-level comparison must report at least:

* number/rate of `train -> modify`, `modify -> recover`, and reverse mode flips;
* hard-session suppression rate;
* isolated-signal versus combined-signal effects;
* combined adverse cases (for example respiration up + RHR up + HRV down + sleep down);
* agreement/disagreement with subjective readiness and explicit illness flags where those
  labels exist;
* lead time around known illness episodes when available;
* false-positive modify/recover days after the underlying event has resolved.

A synthetic sweep is useful for exposing thresholds but is **not** sufficient calibration on
its own. Historical replay or prospectively collected labelled data remains required before a
new weight/estimator is enabled in production.

---

## Consequences

### Positive

* Robust statistics remain available without forcing a one-size-fits-all migration.
* Production behavior is protected from statistically plausible but uncalibrated estimators.
* HRV, steps and vendor composite metrics receive treatment consistent with their actual
  semantics rather than being forced through the respiration design.
* Correlated Garmin composites cannot silently multiply-count the same recovery signal.

### Negative

* More than one candidate estimator must be maintained during the comparison period.
* The replay harness and telemetry need enough detail to compare estimators honestly.
* A future cutover may be metric-specific rather than a single baseline-version migration.

---

## Relationship to other ADRs

* ADR-0006 defines the reconciled strain telemetry and the currently persisted baseline
  fields. This ADR constrains how those fields may become decision-relevant.
* ADR-0005 provides the raw archive/rebuild capability needed for historical estimator replay.
* ADR-0014 establishes the precedent that a decision-policy change requires measured-response
  evidence and a recorded comparison rather than architectural preference alone.
* ADR-0020 applies the same observation/comparison discipline to subjective baselines.
