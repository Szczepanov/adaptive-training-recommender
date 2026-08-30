# PR #306 respiration calibration addendum

**Date:** 2026-08-30  
**Scope:** compliance check against the canonical cardiorespiratory knowledge pack plus targeted external-evidence review.  
**Decision effect:** none; respiration remains shadow/observation evidence.

## Compliance verdict

PR #306 is compliant with the repository's current respiration evidence boundary provided the feature remains shadow-only until prospective labelled validation is complete.

The implementation matches the canonical policy in the important ways:

- it uses nocturnal respiration as a **longitudinal personal-baseline signal**, not a bedside diagnosis;
- it compares the current night with backward-looking personal baselines rather than a population cutoff;
- it fails closed for incompatible baseline versions, insufficient history/coverage, source/date provenance problems, and invalid/missing measurements;
- a resolving current value cannot newly tighten training;
- persistence and adverse RHR/low-HRV corroboration are measured separately;
- exact E1/E2/E3/S1 values are explicitly product calibration candidates rather than scientific constants;
- no current recommendation selector consumes `RespirationElevationEvidence`.

The numeric `6–35 br/min` acceptance range in `respirationElevation.ts` is an ingestion/QA plausibility guard only. It must not be documented or surfaced as a clinical normal range, disease threshold, or training-action threshold.

## External evidence cross-check

The research supports the architecture more strongly than it supports any exact threshold.

1. Longitudinal nocturnal respiratory rate can be estimated from wearables and can change during respiratory infection. A 2021 validation/infection study reported wearable-derived RR agreement around MAE 0.46 breaths/min and used longitudinal nocturnal changes to study COVID-19. This supports trend monitoring, while also showing that changes near fractions of a breath/min are close enough to measurement uncertainty that they should not be treated as universal clinical cut-points.  
   https://pubmed.ncbi.nlm.nih.gov/34526602/
2. A 2022 systematic review/meta-analysis of wearable/contactless RR validation found pooled wearable RR bias around 0.68 breaths/min with wide pooled limits of agreement and substantial study heterogeneity. Device-specific error therefore cannot be assumed away or transferred blindly between wearable platforms.  
   https://pubmed.ncbi.nlm.nih.gov/35947876/
3. A prospective 2024 respiratory-infection validation study used **resting HR + respiratory rate + HRV during sleep** rather than respiration in isolation. This is directionally consistent with ADR-0025 and with treating corroborated/persistent cases differently from isolated one-night elevations.  
   https://pubmed.ncbi.nlm.nih.gov/39018555/
4. Broader reviews of wearable infection detection conclude that physiological deviations can be useful early digital biomarkers, but real-world infection detection and generalizability remain imperfect. That supports a labelled prospective release gate rather than retrospective threshold fitting.  
   https://pubmed.ncbi.nlm.nih.gov/35461692/  
   https://pubmed.ncbi.nlm.nih.gov/34932906/

## Additional hardening in this commit

The replay previously exposed the canonical median/MAD standardized respiration deviation only at row level. That made E2/S1 calibration harder to review because an absolute +1 br/min change can represent very different departures from an athlete's own normal nightly variability.

The replay summary now additionally reports:

- classifier-unavailable days and rate;
- unavailable reason counts, so warm-up/history limitations can be distinguished from provenance/data failures;
- count of days with usable 28-day median/MAD standardized respiration evidence;
- among discrete elevated/strong days, the robust standardized-deviation median and range.

These values are **calibration telemetry only**. They do not modify E2/S1, do not add another decision boundary, and do not change live readiness.

## Release gate remains unchanged

Do not authorize `tighten-v1` from this PR's retrospective history alone. Before any live training authority, HA9-R3 still needs a prospective dataset with enough labelled healthy and illness/systemic-stress periods to estimate false-alert burden and useful detection performance. At minimum, the release report should stratify:

- one-night vs persistent elevation;
- isolated respiration vs adverse RHR/low-HRV/symptom corroboration;
- E1/E2/E3/S1 sensitivity;
- absolute delta and robust median/MAD deviation;
- unavailable reason/rate;
- source/device/firmware changes when known;
- confounders such as hard training, sleep disruption, alcohol, travel/altitude, heat/dehydration, vaccination/medication, and allergy/respiratory context;
- 24/48/72-hour symptom/outcome labels and lead time;
- whether the existing readiness decision was already `modify`/`recover`.

Until those labels exist, `falsePositiveRate` must remain `null`; absence of a symptom label is not evidence of a healthy true negative unless the prospective labelling protocol establishes that interpretation.
