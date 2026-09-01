# Clinical Analysis & Specification — SEP-C4: Red-Flag & Clinical Escalation Protocol

**Date:** 2026-09-01
**Status:** Approved for Implementation
**Related PRs / ADRs:** ADR-0002, ADR-0025, SEP-A, SEP-B, SEP-C1 (#319), SEP-C2, SEP-C3
**Policy Version Target:** `2026-09-safety-policy-remediation-sep-c4`

---

## 1. Clinical Context & Scope Boundary

The adaptive training recommender is designed for automated athletic workload optimization in healthy or managing athletes. It is **not** a medical diagnostic device, emergency triage tool, or rehabilitation prescriber.

In athletic medicine (IOC Consensus on Pain Management in Elite Athletes, Hainline et al. 2017; Initial MSK Assessment Consensus, Herring et al. 2024), a fundamental distinction is drawn between:
1. **Manageable musculoskeletal / loading symptoms**: Mild to moderate transient irritability that can be monitored, limited, or accommodated via modified cross-training and load adjustments.
2. **Red-flag clinical signs**: Symptoms indicative of potentially serious underlying pathology (e.g., bone stress fracture, acute structural joint disruption, cervical/lumbar radiculopathy with progressive neurologic deficit, acute systemic/cardiopulmonary infection) where algorithm-guided physical training is unsafe and contraindicated.

When a red-flag condition is reported, the engine must not attempt to prescribe "light" or "mobility" training. Instead, the engine must immediately:
- Enforce complete rest (`maxAllowableTier: 'Rest'`, `mode: 'recover'`).
- Invalidate and lock all loading progressions and one-tap alternatives.
- Surface an authoritative, clear clinical referral guidance advising medical evaluation before loading resumes.

---

## 2. Red-Flag Taxonomy

| Category | Clinical Definitions & Scope | Triggers in System | Action & Envelope |
|---|---|---|---|
| `neurological` | Numbness, paresthesia, radiating motor weakness, saddle sensory disturbance, loss of bowel/bladder control. | Explicit `checkin.redFlags.categories` includes `'neurological'`. | `maxAllowableTier: 'Rest'`, `mode: 'recover'`, lock all progression, clinical referral banner. |
| `acute_trauma_structural` | Inability to bear weight following an acute traumatic incident, gross joint deformity, immediate significant joint effusion, locking or gross ligamentous instability. | Explicit `checkin.redFlags.categories` includes `'acute_trauma_structural'`. | `maxAllowableTier: 'Rest'`, `mode: 'recover'`, lock all progression, clinical referral banner. |
| `systemic_infection` | High fever with chills, severe chest tightness/pain, unexplained dyspnea at rest, palpitations, or acute severe systemic prostration. | Explicit `checkin.redFlags.categories` includes `'systemic_infection'`, OR implicit detection from `healthContext.symptoms` (`severity === 'severe'` with `types.includes('fever_or_chills')`). | `maxAllowableTier: 'Rest'`, `mode: 'recover'`, lock all progression, clinical referral banner. |
| `rapidly_worsening` | Severe symptom escalation or progressive loss of basic daily mobility over hours to days despite load cessation. | Explicit `checkin.redFlags.categories` includes `'rapidly_worsening'`. | `maxAllowableTier: 'Rest'`, `mode: 'recover'`, lock all progression, clinical referral banner. |

---

## 3. Data Flow & Architectural Invariants

1. **Check-in Contract**:
   - `DailySubjectiveCheckin` includes optional `redFlags?: RedFlagCheckin`.
   - `DailyCheckin` UI provides a clear disclosure/checkbox list when `painOrInjury` is flagged, letting the athlete easily declare red-flag symptoms.
   - Even without explicit check-in flags, severe systemic symptoms in `healthContext.symptoms` (severe fever/chills) automatically trigger red-flag handling.

2. **Adapter Normalization**:
   - `mapCheckinToSubjectiveInput` extracts red-flag findings into `SubjectiveInput.redFlagFindings`.
   - Adds `'red_flag'` to `clinicalEnvelopeSources`.
   - Ensures `painFlag` is set to `true`.

3. **Engine Evaluation**:
   - `evaluateEnvelopes`:
     - Checks `subjective.redFlagFindings`.
     - When findings are present, enforces `maxAllowableTier = 'Rest'`, `clinicalFlagActive = true`, `redFlagActive = true`, `clinicalEscalationRequired = true`.
     - Formulates an explicit clinical referral reason.
   - `evaluateTrainingWithIntent`:
     - When `envelopes.safety.redFlagActive` is true, forces `mode = 'recover'`, selects `Rest` template (`systemicCost = 0`), and prepends the referral guidance to the decision rationale.

4. **UX & Decision Presentation**:
   - `MorningDecisionCard` displays a high-visibility `clinical-escalation-banner` alerting the athlete that red flags require medical consultation.
   - All progression options (`harder` load adjustments, alternative sessions) are strictly locked.

5. **Sports Knowledge Registry & Coverage**:
   - Registers `policy.safety.clinical_escalation_protocol` in `injuryPainKnowledge.ts`.
   - Documents the policy descriptor in `INJURY_PAIN_POLICY_DESCRIPTOR`.
   - Adds coverage entry in `knowledgeCoverage.ts`.
   - Increments `POLICY_VERSION` to `'2026-09-safety-policy-remediation-sep-c4'`.
