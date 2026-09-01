# Analysis — SEP-C3: Tissue Response Severity Latency & Lumbar Axial Guardrail Precision

**Date:** 2026-09-01
**Status:** In implementation
**Branch:** `feat/sep-c3-tissue-response-severity`
**Supersedes:** `policy.injury.tissue_response_severity_v1`, `policy.injury.region_lumbar_loading_v1`
**Policy Version:** `2026-09-safety-policy-remediation-sep-c3`
**Prerequisites:** SEP-C1 (merged PR #319), SEP-C2 (commit `c89f1e41`)

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
This naive worst-of aggregation ignored the well-established **24-hour response latency** in athletic load-management and tendinopathy progression frameworks (Escriche-Escuder et al. 2020 *BMJ Open*, Silbernagel et al. pain-monitoring model):
- Mild to moderate discomfort during loading (e.g. pain level <= 5/10) is a normal physiological and rehabilitation response, **provided that symptoms settle promptly after the session and next-morning state returns to baseline (normal or mild)**.
- If an athlete reports `painDuringTraining: 'moderate'` but both `afterTrainingState` and `nextMorningReaction` are `normal` (or `mild`), the tissue tolerated the training stimulus.
- Under legacy logic, however, `painDuringTraining: 'moderate'` immediately produced `severity: 'limit'`, artificially imposing hard guardrails (`avoid_high_impact` or `avoid_heavy_lower_body`) and restricting progressive rehabilitation.

### 1.2 Missing High-Impact Axial Guardrail for Severe Lumbar Constraints
In `resolveInjuryRestrictions`:
- For lower-limb impact regions (`knee`, `achilles`, `ankle`, `calf`), `limit` imposes `avoid_high_impact`, and `exclude` imposes `avoid_high_impact` plus restricts `Running`.
- For `lower_back`:
  - `limit` added `avoid_heavy_spinal_loading`.
  - `exclude` added `avoid_heavy_spinal_loading` + `avoid_heavy_lower_body`.
- However, severe lumbar injury (e.g. acute disc herniation, severe radiculopathy, acute facet lock; Herring et al. 2024 Initial MSK Assessment Consensus) contraindicates repetitive high-impact axial shock (`avoid_high_impact`), while permitting low-impact cross-training (walking, gentle cycling, swimming).
- Leaving `avoid_high_impact` off `lower_back: exclude` allowed high-impact bounding/running workouts to be eligible unless the athlete manually configured preferences or explicit modality blocks.

---

## 2. Policy Specifications (SEP-C3 V2)

### 2.1 24-Hour Latency-Aware Tissue Severity Resolver (`deriveTissueSeverity`)
The refined `deriveTissueSeverity` evaluator distinguishes between transient during-session discomfort and persistent post-training or delayed next-morning reactivity:

1. **Severe Persistence or Reactivity** (`exclude`):
   - Any report of `severe` across `morningState`, `painDuringTraining`, `afterTrainingState`, or `nextMorningReaction` yields `'exclude'`.
2. **Persistent or Delayed Moderate Irritation** (`limit`):
   - If `morningState === 'moderate'`, `afterTrainingState === 'moderate'`, or `nextMorningReaction === 'moderate'`, the tissue exhibits persistent or delayed irritation -> `'limit'`.
3. **Transient During-Session Loading Discomfort** (`monitor`):
   - If `painDuringTraining === 'moderate'` BUT post-session state (`afterTrainingState`) and delayed reaction (`nextMorningReaction`) settled to `normal` or `mild` (and waking `morningState` is not moderate/severe), the loading was tolerated -> `'monitor'`.
4. **Mild Response** (`monitor`):
   - Any remaining signal that is `'mild'` -> `'monitor'`.
5. **Normal or Absent** (`null`):
   - All observed signals `'normal'` (or unentered) -> `null` (no derived constraint).

### 2.2 Lumbar Axial Shock Offloading (`resolveInjuryRestrictions`)
For `region === 'lower_back'`:
- `severity === 'limit'`: `impliedGuardrails: ['avoid_heavy_spinal_loading']`.
- `severity === 'exclude'`: `impliedGuardrails: ['avoid_heavy_spinal_loading', 'avoid_heavy_lower_body', 'avoid_high_impact']`.

---

## 3. Behavior Comparison Matrix

| Scenario | Pre-SEP-C3 Severity | SEP-C3 V2 Severity | Clinical / Evidence Rationale |
|---|---|---|---|
| During: moderate; Post: normal; Next morning: normal | `limit` | `monitor` | Tolerable loading; discomfort resolved within 24h window (Escriche-Escuder 2020). |
| During: moderate; Post: moderate; Next morning: normal | `limit` | `limit` | Post-session persistence demonstrates excessive tissue stress. |
| During: moderate; Post: normal; Next morning: moderate | `limit` | `limit` | Delayed next-morning flare demonstrates failure of load tolerance. |
| During: severe; Post: normal; Next morning: normal | `exclude` | `exclude` | Severe pain during session is an acute red-flag signal. |
| Waking morningState: moderate | `limit` | `limit` | Baseline active symptoms require load bounding. |
| Waking morningState: severe | `exclude` | `exclude` | Acute irritability requires complete regional offloading. |
| Lower back: exclude | `avoid_heavy_spinal_loading`, `avoid_heavy_lower_body` | `avoid_heavy_spinal_loading`, `avoid_heavy_lower_body`, `avoid_high_impact` | Offloads repetitive high-impact axial shock in acute lumbar injury (Herring 2024). |

---

## 4. Knowledge Registry & Versioning Lineage

1. **`app/src/knowledge/injuryPainKnowledge.ts`**:
   - Register `policy.injury.tissue_response_severity_v2` (supersedes `_v1`).
   - Register `policy.injury.region_lumbar_loading_v2` (supersedes `_v1`).
   - Deprecate `policy.injury.tissue_response_severity_v1` and `policy.injury.region_lumbar_loading_v1`.
   - Update `INJURY_PAIN_POLICY_DESCRIPTOR`.
2. **`app/src/knowledge/knowledgeCoverage.ts`**:
   - Update `injury.tissue_response_severity` and `injury.region_mapping.lumbar_loading` rules and rationales.
3. **`app/src/engine/policy.ts`**:
   - Bump `POLICY_VERSION` to `'2026-09-safety-policy-remediation-sep-c3'`.
   - Add `'2026-09-safety-policy-remediation-sep-c2'` to `HISTORICAL_POLICY_VERSIONS`.
