# PR #306 review — respiration shadow-evidence hardening

**Date:** 2026-08-30  
**PR:** #306 — `fix: add respiration shadow evidence and replay`  
**Scope:** engineering review, evidence interpretation, replay semantics, provenance, and release-readiness implications.  
**Decision effect:** none. Respiration elevation remains shadow/observation evidence and does not gain live training authority.

## Review conclusion

The PR's evidence-first direction is appropriate: personal nocturnal respiration elevation is a plausible health-anomaly signal, but the current evidence does not justify turning an in-sample personal-delta threshold into a clinical cutoff or an independent live training gate.

Two implementation issues were found and corrected during review:

1. replay corroboration could count unusually **high** HRV as corroborating adverse physiology even though the live HA evaluator correctly treats high-HRV `two_sided` anomalies as non-adverse telemetry;
2. the discrete respiration-elevation classifier's same-day provenance check compared the recovery document date to the evaluation date, even though `respirationAvg` can come from the backend's D-1 sleep fallback.

The fixes deliberately tighten evidence quality without changing recommendation behavior.

## Finding 1 — replay corroboration had drifted from evaluator semantics

### Before

`healthAnomalyReplay.ts` considered an elevated-respiration day corroborated whenever any non-respiration core signal had `moderate_anomaly` or `strong_anomaly` status.

That is broader than the actual HA evaluator. `healthAnomaly.ts:isAdverseCoreSignalEvidence` treats:

- high RHR as adverse;
- high respiration as adverse;
- **low** HRV as adverse;
- unusually high HRV as `two_sided` out-of-range telemetry, not an illness/adverse vote.

The replay therefore could overstate the number of corroborated respiration events and understate isolated-alert burden.

### Fix

Replay now calls the same exported `isAdverseCoreSignalEvidence` authority used by the evaluator. A regression fixture creates strongly high HRV alongside elevated respiration and verifies that the event remains **isolated**, not corroborated.

This is important for HA9-R3 because isolated-versus-corroborated performance is one of the principal release slices. A semantic mismatch in that denominator would bias the eventual ship/no-ship decision.

## Finding 2 — current-day respiration provenance was nominal rather than source-derived

### Backend semantics

The Garmin canonicalizer establishes the relevant source truth:

- target-date sleep is preferred;
- when target-date sleep is unavailable, the selected sleep record may fall back to D-1;
- `respiration_rate_brpm` follows the selected sleep record;
- the precise respiration-endpoint average is used only against the target-date sleep window;
- `mapper.py:_build_metric_dates` persists the selected sleep record's logical date as `source.metricDates.sleep`.

Therefore the existing snapshot already carries the bounded logical-date provenance needed by this PR. A new schema field is unnecessary.

### Before

The discrete classifier received:

```ts
measurementDate: recoverySnapshot.date
```

For a D-day assessment this made the date check effectively tautological even if the underlying sleep/respiration value had fallen back to D-1.

The older HA core-feature mapper also keyed historical respiration observations by the recovery **document** date, which could silently relabel a fallback night and inflate apparent current-day coverage.

### Fix

The shadow path now uses `source.metricDates.sleep` consistently:

- `evaluatePhysiologicalAnomaly` passes `metricDates.sleep` into `evaluateRespirationElevation`;
- a missing or mismatched sleep date makes discrete respiration evidence unavailable with `DATE_PROVENANCE_MISMATCH`;
- `buildRespirationFeatures` exposes a current respiration value only when the selected sleep date equals the recovery snapshot date;
- historical respiration observations are keyed/deduplicated by the selected sleep date rather than the document date;
- feature provenance records `garmin:sleep:<logical-date>` when available.

A regression test verifies that D-1 fallback respiration cannot become a D-day core anomaly or elevated-respiration event.

## Scientific evidence update

The implementation should continue to distinguish **signal plausibility** from **validated release thresholds**.

### Longitudinal respiratory rate can be informative

A wearable respiratory-rate validation/COVID-19 study reported good agreement for its tested wearable algorithm and showed that some infected participants exhibited nocturnal respiratory-rate elevations relative to their regular rate. Importantly, the signal was not universal: only a subset of symptomatic and asymptomatic cases crossed a large personal increase. This supports personal longitudinal monitoring, not a universal diagnostic threshold.

- https://pubmed.ncbi.nlm.nih.gov/34526602/

A prospective validation study in health-care workers used a **multi-signal** wearable model including resting heart rate, respiratory rate, and HRV during sleep. That is directionally consistent with ADR-0025's multi-channel design and with requiring prospective validation before visible or training-authoritative use.

- https://pubmed.ncbi.nlm.nih.gov/39018555/

### Device/measurement uncertainty matters

Systematic-review evidence shows that wearable/cardiorespiratory measurement accuracy varies by device, population, context, and validation design. A numerical error estimate from one wearable algorithm must not be transferred to Garmin as if it were a Garmin specification.

- https://pubmed.ncbi.nlm.nih.gov/35947876/
- https://pubmed.ncbi.nlm.nih.gov/36292252/

Other longitudinal sleep-monitor validation work further supports the usefulness of individualized respiratory-rate baselines, but it remains device-specific rather than evidence for these exact E1/E2/E3/S1 boundaries.

- https://pubmed.ncbi.nlm.nih.gov/38875674/

### Consequence for E1/E2/E3/S1

The current personal-delta boundaries remain **shadow calibration candidates**:

| Candidate | vs 28d median | vs 7d median |
|---|---:|---:|
| E1 | >= +0.75 br/min | >= +0.25 br/min |
| E2 | >= +1.00 br/min | >= +0.50 br/min |
| E3 | >= +1.25 br/min | >= +0.75 br/min |
| S1 | >= +2.00 br/min | >= +1.00 br/min |

E2's separation of the currently observed high nights is in-sample evidence. It is not a physiological law, a disease cutoff, or permission to tighten training.

## Release implications

This review does **not** authorize any of the following:

- enabling `RespirationStrainPolicy='median-mad-v1'` in normal readiness calls;
- changing `DecisionScoreTelemetry.totalDecisionScore` from respiration elevation;
- showing diagnostic or pseudo-probabilistic illness wording;
- changing a training recommendation from respiration alone;
- promoting E2/S1 from candidate thresholds to product truth.

HA9-R3 should continue prospectively and should report, at minimum:

1. labelled elevated and normal healthy periods;
2. false-alert burden per observed days and per episode;
3. measurement/provenance-unavailable rate;
4. E1/E2/E3/S1 sensitivity to threshold choice;
5. one-night versus persistent variants;
6. isolated respiration versus corroborated **adverse** RHR/low-HRV cases;
7. whether existing readiness was already conservative;
8. 24/48/72-hour symptom/outcome labels and lead time;
9. confounders such as hard training, poor sleep, stress, alcohol, travel, heat/dehydration, vaccination/medication, and allergy context;
10. resolving-tail behavior so recovery is not punished by stale drift.

A future `tighten-v1` decision should be a separate, explicit release decision based on that prospective evidence.

## Verification added in this review

Regression coverage now asserts that:

- unusually high HRV does not count as adverse corroboration for elevated respiration;
- D-1 sleep-fallback respiration is unavailable for a D-day elevation assessment;
- D-1 fallback respiration is also unavailable as the D-day core respiration anomaly channel;
- historical respiration coverage follows the selected sleep date rather than blindly following the recovery document date.

The intended invariant remains:

> Better provenance can remove unsupported evidence, but shadow respiration work must not silently gain live training authority.
