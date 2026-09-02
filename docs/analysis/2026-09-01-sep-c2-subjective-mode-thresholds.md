# SEP-C2 — Subjective Mode Threshold & Neutral-Default Calibration

**Date:** 2026-09-01
**Scope:** Recalibrate `readiness.subjective_mode_thresholds` (`rules.ts:evaluateReadinessAndSafetyEnvelope`, `adapters.ts:mapCheckinToSubjectiveInput`, `models.ts:SubjectiveInput`), decouple `motivation` from the physical fatigue average, calculate adverse score dynamically across answered physical dimensions for partial check-ins, and decouple `painFlag` from fatigue semantics.

## Problem found during review

The SEP-A evidence review identified several structural defects in the legacy subjective classifier:

1. **Psychological drive was conflated with physical strain.** The legacy composite averaged fatigue, soreness, inverted readiness, inverted sleep quality, and inverted motivation with equal weight. Subjective fatigue, soreness, sleep and readiness are useful athlete-monitoring signals, but motivation has substantial non-load variance and should not silently inflate a physiological-fatigue score.

2. **Unanswered fields were imputed as neutral 5/10.** A minimum check-in can contain only safety flags plus fatigue or soreness. Filling omitted fields with 5 diluted a severe single answer and could also push borderline answers across a mode boundary for reasons unrelated to what the athlete actually reported.

3. **Pain/injury was embedded inside a variable called `extremeFatigue`.** Clinical symptoms and training fatigue are separate policy axes and need separate provenance even when both can force recovery.

4. **The pre-SEP-C2 absolute boundary was too narrow.** Before the safety hardening in this PR, the legacy condition used `> 8`, so only fatigue/soreness 9–10/10 independently forced recovery. An 8/10 report could therefore be diluted by otherwise green answers. SEP-C2 deliberately changes that boundary to `>= 8`; the new 8/10 recovery behavior is product calibration and is pinned by regression tests below.

## Corrected architecture

### Four physical recovery dimensions
The adverse physical composite uses:
- `fatigue` (direct),
- `soreness` (direct),
- `readiness` (inverted: `10 - readiness`),
- `sleepQuality` (inverted: `10 - sleepQuality`).

`motivation` is excluded from this physical average. It remains available elsewhere as a psychological/preference/performance-context signal.

### Answered-dimension averaging
`SubjectiveInput.answeredDimensions` records which dimensions were actually answered. When present, only answered physical dimensions participate.

Examples:
- fatigue 6 only -> score 6.0 -> `modify`;
- fatigue 8 only -> score 8.0 -> `recover`;
- fatigue 3 only -> score 3.0 -> no composite escalation.

Legacy callers without `answeredDimensions` retain the four-dimension fallback average.

### Absolute severe subjective override
In addition to the composite, an explicit absolute rule prevents dilution:

```ts
const severeFatigue = subjective.fatigue >= 8 || subjective.soreness >= 8;
```

Thus fatigue 8/10 or soreness 8/10 (`>= 8`) independently forces `recover` even when all other answered physical dimensions are excellent. A 7/10 value does not cross this absolute recovery rule by itself; other composite/objective/context rules may still modify or recover the day. Floating-point profile fixtures with baseline 7 and noise stay under 8, preserving their modify floor.

### Clinical symptoms are separate
`clinicalRecoverOverride` carries the legacy aggregate clinical flag separately from `severeFatigue`. Clinical lineage is handled through `clinicalEnvelopeSources` / SEP-C4 rather than being relabeled as physiological fatigue.

## Evidence boundary

The literature supports subjective self-report as a useful and often sensitive component of athlete monitoring (for example, Saw et al. 2016 and subsequent athlete-monitoring reviews). It does **not** establish a universally validated 1–10 threshold at which every athlete should automatically stop training.

Therefore:
- the **structure** of using athlete-reported fatigue/soreness and avoiding artificial neutral imputation is evidence-informed;
- the exact `>= 8` absolute boundary is a **conservative product calibration**, not a clinical diagnostic cutoff;
- it should remain versioned, observable, and open to later calibration against outcome/simulation data rather than being described as a medical threshold.

## Behaviour matrix

| Input scenario | SEP-C2 behavior | Reason |
|---|---|---|
| All 4 physical dimensions = 5 | `train` absent other signals | Composite = 5.0 |
| Readiness = 4, others = 5 | `modify` | Composite = 5.25 |
| Low motivation, physical dimensions good | no physical-fatigue escalation | Motivation excluded from physical composite |
| Partial check-in: fatigue = 8 only | `recover` | Composite 8.0 + absolute override |
| All dimensions answered; fatigue = 8, others excellent | `recover` | Absolute override prevents dilution |
| All dimensions answered; soreness = 8, others excellent | `recover` | Absolute override prevents dilution |
| Fatigue = 7 with otherwise excellent inputs | not `recover` from the absolute rule alone | Boundary is `>= 8` |
| Pain/red flag | handled by clinical policy | Separate clinical axis |

## Verification added in PR #320

`app/src/engine/subjectiveThresholdSafety.test.ts` pins the safety boundary:
- fatigue 8/10 + otherwise excellent answered dimensions -> `recover`;
- soreness 8/10 + otherwise excellent answered dimensions -> `recover`;
- fatigue 7/10 does not independently trigger the absolute recovery override.

## Knowledge lineage

`policy.readiness.subjective_mode_thresholds_v1` is deprecated. Decisions under SEP-C2 consume `policy.readiness.subjective_mode_thresholds_v2`, which records:
- four-item physical composite;
- motivation decoupling;
- dynamic answered-dimension participation;
- absolute `>= 8` fatigue/soreness recovery calibration;
- separate clinical override semantics.

## Policy version

The combined PR ultimately publishes `POLICY_VERSION = '2026-09-safety-policy-remediation-sep-c4'`; SEP-C2 remains a named policy component within that release.
