# SEP-C2 — Subjective Mode Threshold & Neutral-Default Calibration

**Date:** 2026-09-01
**Scope:** Recalibrate `readiness.subjective_mode_thresholds` (`rules.ts`, `adapters.ts`, `models.ts`), decouple `motivation` from the physical fatigue average, calculate adverse score dynamically across answered physical dimensions for partial check-ins, and decouple `painFlag` from `extremeFatigue`.

## Problem found during review

The SEP-A evidence review ([`docs/analysis/2026-09-01-evidence-pack-subjective-readiness.md`](./2026-09-01-evidence-pack-subjective-readiness.md)) identified several structural defects in the legacy subjective classifier:

1. **Conflating psychological drive with physical strain**:
   The legacy composite averaged five items with equal weight (0.2 each):
   $$\text{overallFatigueScore} = \frac{\text{fatigue} + \text{soreness} + (10 - \text{readiness}) + (10 - \text{sleepQuality}) + (10 - \text{motivation})}{5}$$
   Evidence (Saw 2016, Duignan 2020, Brauers 2026) indicates that fatigue, muscle soreness, and sleep quality reflect training load and physiological recovery, whereas motivation exhibits high non-load psychological variance and weak correlation with objective strain. Poor motivation alone should not artificially inflate physiological fatigue scores.

2. **Artificial neutral-default imputation**:
   `safetyCheckin.ts` `getMinimumSafetyCheckinStatus` permits an athlete to complete a check-in with only boolean safety flags plus either `fatigue` or `soreness`.
   Previously, `adapters.ts` `mapCheckinToSubjectiveInput` imputed `5` for every omitted dimension (`readiness`, `sleepQuality`, `motivation`, `stress`).
   - If an athlete reported `fatigue: 8` and left the rest blank:
     $$\text{score} = \frac{8 + 5 + 5 + 5 + 5}{5} = 5.6 \implies \text{modify}$$
     The severe fatigue was diluted by unentered questions, avoiding the `> 7` recover threshold!
   - Conversely, entering `fatigue: 6` with all 5s produced $26 / 5 = 5.2 > 5$, forcing `modify` even though 6 was only slightly elevated.

3. **Coupling `painFlag` into `extremeFatigue`**:
   `rules.ts` defined:
   ```ts
   const extremeFatigue = subjective.fatigue > 8 || subjective.soreness > 8 || subjective.painFlag;
   ```
   Musculoskeletal pain and clinical illness flags were embedded into a variable named `extremeFatigue`, triggering `fatigueTriggeredRecover` and masking whether recovery was caused by clinical symptoms or physiological fatigue.

## Corrected architecture

### 1. Four physical recovery dimensions
The primary adverse physiological composite now comprises the four physical recovery dimensions:
- `fatigue` (direct)
- `soreness` (direct)
- `readiness` (inverted: $10 - \text{readiness}$)
- `sleepQuality` (inverted: $10 - \text{sleepQuality}$)

`motivation` is removed from this physical fatigue average. It remains available in `SubjectiveInput` for neuromuscular modeling (`fatigue.ts`), session duration preferences, and modality preference.

### 2. Answered-dimension dynamic averaging
`SubjectiveInput.answeredDimensions` records which dimensions were explicitly answered by the athlete.
- When `answeredDimensions` is present, the composite averages only the *answered physical dimensions* among the four.
- If only `fatigue: 6` was answered:
  $$\text{score} = \frac{6}{1} = 6.0 > 5 \implies \text{modify}$$
- If `fatigue: 8` was answered:
  $$\text{score} = \frac{8}{1} = 8.0 > 7 \implies \text{recover}$$
- If `fatigue: 3` was answered:
  $$\text{score} = \frac{3}{1} = 3.0 \le 5 \implies \text{train}$$
- When all 4 physical dimensions are answered (or when `answeredDimensions` is absent in legacy fixtures), the denominator is 4.

### 3. Decoupling clinical recover override from severe fatigue
- `clinicalRecoverOverride` explicitly isolates `subjective.painFlag`.
- `severeFatigue` is strictly `subjective.fatigue > 8 || subjective.soreness > 8`.
- Both contribute cleanly to `fatigueTriggeredRecover` to preserve backward-compatible safety invariants, but telemetry and rationale can distinguish the two.

## Behaviour matrix

| Input scenario | Legacy mode | SEP-C2 mode | Reason |
|---|---|---|---|
| All 4 physical dimensions = 5 | train (score 5.0) | train (score 5.0) | $20/4 = 5.0 \le 5$ |
| Readiness = 4, others = 5 | modify (score 5.2) | modify (score 5.25) | $(6 + 5 + 5 + 5)/4 = 5.25 > 5$ |
| Low motivation (1/10), good physicals (2/10) | modify (score 3.0 + 9/5 = 4.8, or modify if others 4) | train | Low motivation does not inflate physical fatigue |
| Partial check-in: fatigue = 8 only | modify (score 5.6) | **recover** (score 8.0) | Severe fatigue no longer diluted by neutral defaults |
| Partial check-in: fatigue = 4 only | train (score 4.8) | train (score 4.0) | Clean single-dimension evaluation |
| PainFlag = true | recover | recover | Preserved clinical override; decoupled from fatigue |

## Knowledge-lineage change

`policy.readiness.subjective_mode_thresholds_v1` is deprecated.
Decisions under SEP-C2 consume `policy.readiness.subjective_mode_thresholds_v2`.
Lineage records:
- 4-item physical composite;
- motivation decoupled from physical fatigue score;
- dynamic answered-dimension participation for partial check-ins;
- clinical override decoupled from extreme fatigue.

## Policy Version

`POLICY_VERSION` is incremented to `'2026-09-safety-policy-remediation-sep-c2'`.
