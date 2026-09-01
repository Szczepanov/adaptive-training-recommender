# Analysis — SEP-C3: Tissue Response Severity Latency & Lumbar Axial Guardrail Precision

**Date:** 2026-09-01
**Status:** Implemented and safety-hardened in PR #320
**Branch:** `feat/sep-c4-clinical-escalation-protocol`
**Supersedes:** `policy.injury.tissue_response_severity_v1`, `policy.injury.region_lumbar_loading_v1`
**Policy Version:** `2026-09-safety-policy-remediation-sep-c4`
**Prerequisites:** SEP-C1 (merged PR #319), SEP-C2

---

## 1. Problem Analysis

### 1.1 Premature Severity Escalation on Transient Loading Discomfort
Under pre-SEP-C3 logic (`injuryPolicy.ts:deriveTissueSeverity`), the engine translated tissue responses into constraint severities using a simple worst-of aggregator:
```typescript
// Legacy worst-of aggregation:
const worst = levels.reduce((worst, level) => (TISSUE_LEVEL_RANK[level] > TISSUE_LEVEL_RANK[worst] ? level : worst));
if (worst === 'severe') return 'exclude';
if (worst === 'moderate') return 'limit';
if (worst === 'mild') return 'monitor';
```
This ignored response latency used in lower-limb tendinopathy load-progression and pain-monitoring frameworks (Escriche-Escuder et al. 2020; Silbernagel et al.). In those contexts, some discomfort during loading can be acceptable when symptoms settle and the next-morning response returns to the accepted range.

That evidence does **not** establish that every tissue, diagnosis, or acute injury can safely tolerate the same pain dose. SEP-C3 therefore uses the next-morning concept only as a conservative load-management heuristic. It does not diagnose tendinopathy and it does not use a numeric pain threshold as universal clinical permission.

### 1.2 Missing Follow-up Was Initially Fail-Open
The first SEP-C3 implementation correctly documented that transient moderate during-session discomfort should only resolve to `monitor` when post-session **and** next-morning observations are normal/mild. However, the implementation did not require those later observations to exist. A response with only `painDuringTraining: 'moderate'` could therefore be treated as settled.

That is unsafe because absence of follow-up is unknown, not evidence of recovery. PR #320 now fails closed:
- moderate during-session discomfort with incomplete post-session or next-morning follow-up -> `limit`;
- downgrade to `monitor` only after both later observations are explicitly present and each is `normal` or `mild`.

### 1.3 Missing High-Impact Axial Guardrail for Severe Lumbar Constraints
For `lower_back: exclude`, the policy now adds `avoid_high_impact` alongside `avoid_heavy_spinal_loading` and `avoid_heavy_lower_body`. This is a product guardrail for a severe lumbar constraint, not a diagnosis-specific treatment recommendation. Individual lumbar presentations vary, and red-flag neurological/systemic symptoms are handled separately by SEP-C4 clinical escalation.

---

## 2. Policy Specifications (SEP-C3 V2)

### 2.1 24-Hour Latency-Aware Tissue Severity Resolver (`deriveTissueSeverity`)

1. **Severe observation (`exclude`)**
   - Any `severe` observation across `morningState`, `painDuringTraining`, `afterTrainingState`, or `nextMorningReaction` crosses the automated-training exclusion boundary.
2. **Persistent or delayed moderate response (`limit`)**
   - `morningState === 'moderate'`, `afterTrainingState === 'moderate'`, or `nextMorningReaction === 'moderate'` -> `limit`.
3. **Moderate during-session discomfort with complete settled follow-up (`monitor`)**
   - `painDuringTraining === 'moderate'` may resolve to `monitor` only when both `afterTrainingState` and `nextMorningReaction` are explicitly recorded and each is `normal` or `mild`.
4. **Moderate during-session discomfort with incomplete follow-up (`limit`)**
   - Missing post-session or next-morning observation remains `limit` until the response latency is actually observed.
5. **Mild response (`monitor`)**
   - Any remaining `mild` signal -> `monitor`.
6. **Normal or absent (`null`)**
   - No adverse observed signal -> no derived constraint.

### 2.2 Lumbar Loading Guardrails (`resolveInjuryRestrictions`)
For `region === 'lower_back'`:
- `severity === 'limit'`: `avoid_heavy_spinal_loading`.
- `severity === 'exclude'`: `avoid_heavy_spinal_loading`, `avoid_heavy_lower_body`, `avoid_high_impact`.

---

## 3. Behavior Comparison Matrix

| Scenario | Pre-SEP-C3 | SEP-C3 V2 | Safety rationale |
|---|---|---|---|
| During moderate; post normal; next morning normal | `limit` | `monitor` | Later observations explicitly settled. |
| During moderate; post mild; next morning mild | `limit` | `monitor` | Later observations explicitly settled within the configured response scale. |
| During moderate; post missing; next morning normal | `limit` | `limit` | Missing post-session observation is unknown. |
| During moderate; post normal; next morning missing | `limit` | `limit` | 24-hour response has not yet been observed. |
| During moderate; post moderate | `limit` | `limit` | Persistent response. |
| During moderate; next morning moderate | `limit` | `limit` | Delayed reactivity. |
| Any severe observation | `exclude` | `exclude` | Automated training is stopped for that regional constraint. |
| Lower back `exclude` | two loading guardrails | three loading guardrails including `avoid_high_impact` | Conservative severe-lumbar loading boundary. |

---

## 4. Evidence Interpretation

- Escriche-Escuder A, Casaña J, Cuesta-Vargas AI. *Load progression criteria in exercise programmes in lower limb tendinopathy: a systematic review.* BMJ Open. 2020;10:e041433. The review supports symptom-response/load-progression monitoring but also shows heterogeneous criteria; it does not validate a universal tissue-severity classifier.
- Silbernagel-style pain-monitoring work in Achilles tendinopathy permits continued loading within a monitored symptom envelope and requires symptoms to settle by the following morning. This is condition-specific rehabilitation evidence and must not be generalized into a diagnosis claim.
- Herring et al. 2024 provides consensus guidance for initial musculoskeletal assessment. It supports conservative escalation when significant structural/neurological findings are suspected but does not provide the exact software guardrail mapping used here.

**Product-policy boundary:** `monitor`, `limit`, `exclude`, and the exact guardrail mappings are application policy choices informed by evidence. They are not evidence-derived clinical diagnoses or validated medical-device thresholds.

---

## 5. Verification Added in PR #320

`app/src/engine/injuryPolicyLatencySafety.test.ts` covers the previously untested missing-follow-up states:
- missing post-session observation -> `limit`;
- missing next-morning observation -> `limit`;
- complete normal/mild follow-up -> `monitor`;
- delayed moderate flare -> `limit`.
