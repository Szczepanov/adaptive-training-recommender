# Clinical Analysis & Specification — SEP-C4: Red-Flag & Clinical Escalation Protocol

**Date:** 2026-09-01
**Status:** Implemented and safety-hardened in PR #320
**Related PRs / ADRs:** ADR-0002, ADR-0025, SEP-A, SEP-B, SEP-C1 (#319), SEP-C2, SEP-C3
**Policy Version:** `2026-09-safety-policy-remediation-sep-c4`

## 1. Scope boundary

The adaptive training recommender is a workload-planning system. It is **not** a diagnostic device, emergency-triage service, or rehabilitation prescriber. Its job at the clinical boundary is deliberately narrow: recognize configured warning disclosures, stop generating exercise prescriptions, and direct the athlete out of the training workflow when evaluation is needed.

Sports-medicine consensus supports conservative assessment of significant musculoskeletal/neurological findings, while acute chest pain and significant breathing difficulty require a substantially stronger urgency message than ordinary training-load symptoms. American Heart Association chest-pain guidance explicitly advises immediate emergency evaluation for acute chest pain/chest-pain equivalents such as shortness of breath. The application therefore must not present a target event as something the athlete is neutrally “cleared to decide” when a clinical-escalation flag is active.

## 2. Operational taxonomy

The taxonomy below is a **product screening taxonomy**, not a diagnosis. Its exact category boundaries are not claimed to be clinically validated classifiers.

| Category | Product screening examples | System action |
|---|---|---|
| `neurological` | Numbness/paresthesia, radiating weakness, or other concerning neurological change | Rest-only envelope; prescriptions and adjustments blocked; clinical evaluation message |
| `acute_trauma_structural` | Cannot bear weight after trauma, visible deformity, gross joint give-way/instability | Rest-only envelope; prescriptions and adjustments blocked; clinical evaluation message |
| `systemic_infection` | Severe fever/chills; legacy bucket also carries explicit cardiopulmonary warning disclosure such as unexplained chest pain or shortness of breath | Rest-only envelope; prescriptions and adjustments blocked; clinical evaluation message; emergency-care wording when emergency symptoms are present |
| `rapidly_worsening` | Rapid symptom progression or loss of basic function despite rest | Rest-only envelope; prescriptions and adjustments blocked; clinical evaluation message |

### Naming caveat

`systemic_infection` predates the current UI copy and is retained in this PR to avoid widening the persistence/migration surface. The user-facing label is now **“Systemic / cardiopulmonary warning”** so chest pain or dyspnea are not mislabeled as infection. A later schema migration can split this bucket into separate systemic-infectious and cardiopulmonary categories without weakening the current fail-safe behavior.

## 3. Independent red-flag disclosure

The initial PR implementation displayed the red-flag questionnaire only after `painOrInjury` was checked and automatically turned `painOrInjury` on whenever any red flag was selected. That made non-musculoskeletal warnings—especially fever/chills, chest symptoms, or breathing symptoms—artificially dependent on an injury toggle.

PR #320 now treats these as independent channels:
- the red-flag screening section is always available in Health & Safety;
- selecting a red flag no longer fabricates `painOrInjury = true`;
- turning the pain/injury toggle off no longer erases an explicit red-flag disclosure;
- adapter normalization still sets the legacy aggregate `SubjectiveInput.painFlag` when any clinical source is active, preserving backward compatibility while `clinicalEnvelopeSources` retains the true source.

Regression coverage: `app/src/engine/redFlagIndependence.test.ts`.

## 4. Engine invariants

When a red-flag finding reaches the engine:
- `redFlagActive = true`;
- `clinicalEscalationRequired = true`;
- `maxAllowableTier = 'Rest'`;
- readiness mode is forced to `recover`;
- ranked catalog prescriptions collapse to Rest;
- one-tap harder/easier alternatives are disabled;
- the decision card presents clinical-escalation messaging.

Severe fever/chills in structured health symptoms also creates an implicit `systemic_infection` finding even when the athlete did not use the explicit red-flag checklist.

## 5. Imported-session and event hardening

A cross-path review found that imported target events followed ADR-0019 D-EVENT and returned an advisory before ordinary clinical/readiness skip/defer logic. Under a red flag the old text could therefore still say: “the decision to start is yours.” That contradicted SEP-C4’s own safety contract.

The adjudication order is now:

`clinical escalation -> event advisory / session skip -> ordinary clinical/feasibility -> readiness -> dose`

Behavior:
- imported **training sessions** under clinical escalation return `skip`, with no execution dose;
- imported **events** remain represented as `advisory` so the recommender does not silently delete a real-world commitment, but the advisory explicitly says the engine **cannot clear the athlete to start**, requires medical evaluation first, and tells the athlete to seek emergency care for chest pain, severe shortness of breath, fainting, or another emergency concern;
- the permissive “decision to start is yours” copy is not used under clinical escalation.

Regression coverage: `app/src/engine/externalSessionClinicalEscalation.test.ts`.

## 6. Evidence interpretation

- Herring SA et al. *Initial Assessment and Management of Select Musculoskeletal Injuries: A Team Physician Consensus Statement.* Med Sci Sports Exerc. 2024. Supports appropriate initial assessment/management of significant sports injuries; it does not validate this software taxonomy verbatim.
- Hainline B et al. IOC consensus on pain management in elite athletes. Supports separating pain management from serious pathology assessment; again, it does not turn application labels into diagnoses.
- American Heart Association chest-pain guidance: acute chest pain/chest-pain equivalents, including shortness of breath, warrant immediate medical care. This supports stronger emergency wording for cardiopulmonary warning symptoms rather than generic “monitor/rest” language.

**Product-policy boundary:** the application stops training recommendations when configured warning findings are reported. It does not determine the underlying diagnosis, severity, or fitness to return to sport.

## 7. Verification additions in PR #320

Focused regression tests added during review:
- `injuryPolicyLatencySafety.test.ts` — missing latency follow-up fails closed;
- `subjectiveThresholdSafety.test.ts` — 8/10 fatigue or soreness cannot be diluted by other good answers;
- `externalSessionClinicalEscalation.test.ts` — imported sessions/events cannot bypass escalation;
- `redFlagIndependence.test.ts` — explicit red flags remain independent from the pain/injury toggle.
