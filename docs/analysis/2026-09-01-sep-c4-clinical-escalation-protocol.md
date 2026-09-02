# Clinical Analysis & Specification — SEP-C4: Red-Flag & Clinical Escalation Protocol

**Date:** 2026-09-01
**Status:** Implemented and safety-hardened in PR #320
**Related PRs / ADRs:** ADR-0002, ADR-0025, SEP-A, SEP-B, SEP-C1 (#319), SEP-C2, SEP-C3
**Policy Version:** `2026-09-safety-policy-remediation-sep-c4`

## 1. Scope boundary

The adaptive training recommender is a workload-planning system. It is **not** a diagnostic device, emergency-triage service, or rehabilitation prescriber. Its job at the clinical boundary is deliberately narrow: recognize configured warning disclosures, stop generating exercise prescriptions, and direct the athlete out of the training workflow when evaluation is needed.

Sports-medicine consensus supports conservative assessment of significant musculoskeletal/neurological findings, while acute cardiopulmonary warning symptoms require a substantially stronger urgency message than ordinary training-load symptoms. The 2021 AHA/ACC chest-pain guideline treats acute chest pain/chest-pain equivalents such as shortness of breath as symptoms that warrant immediate medical evaluation. The 2025 AHA/ACC scientific statement for competitive athletes likewise treats cardiopulmonary symptoms including chest pain/tightness, dyspnea, palpitations, and presyncope/syncope as clinically important in sports-participation assessment. The application therefore must not present a target event as something the athlete is neutrally “cleared to decide” when a clinical-escalation flag is active.

## 2. Operational taxonomy

The taxonomy below is a **product screening taxonomy**, not a diagnosis. Its exact category boundaries are not claimed to be clinically validated classifiers.

| Category | Product screening examples | System action |
|---|---|---|
| `neurological` | Numbness/paresthesia, radiating weakness, or other concerning neurological change | Rest-only envelope; prescriptions and adjustments blocked; clinical evaluation message |
| `acute_trauma_structural` | Cannot bear weight after trauma, visible deformity, gross joint give-way/instability | Rest-only envelope; prescriptions and adjustments blocked; clinical evaluation message |
| `systemic_infection` | Severe fever/chills; compatibility bucket may also carry an explicit cardiopulmonary warning disclosure such as acute chest pain/pressure, unexplained dyspnea, or fainting/near-fainting | Rest-only envelope; prescriptions and adjustments blocked; clinical evaluation message; urgent/emergency-care wording for emergency warning symptoms |
| `rapidly_worsening` | Rapid symptom progression or loss of basic function despite rest | Rest-only envelope; prescriptions and adjustments blocked; clinical evaluation message |

### Naming caveat

`systemic_infection` predates the current UI copy and is retained in this PR to avoid widening the persistence/migration surface. It is therefore a **compatibility/storage bucket, not a diagnostic attribution**: a cardiopulmonary disclosure stored under this key is not being classified as an infection. The user-facing label and engine rationale now render this bucket as **“Systemic / cardiopulmonary warning”** so chest pain or dyspnea are not echoed back to the athlete as “systemic infection.” The structured key remains unchanged for persistence and audit compatibility. A later schema migration can split this bucket into separate systemic-infectious and cardiopulmonary categories without weakening the current fail-safe behavior.

The recommender also does not diagnose the cause of dyspnea, chest symptoms, presyncope/syncope, or neurological symptoms. The safety contract is only that configured warning disclosures suspend automated exercise prescription and direct the athlete toward appropriate clinical care.

## 3. Independent red-flag disclosure

The initial PR implementation displayed the red-flag questionnaire only after `painOrInjury` was checked and automatically turned `painOrInjury` on whenever any red flag was selected. That made non-musculoskeletal warnings—especially fever/chills, chest symptoms, or breathing symptoms—artificially dependent on an injury toggle.

PR #320 now treats these as independent channels:
- the red-flag screening section is always available in Health & Safety;
- selecting a red flag no longer fabricates `painOrInjury = true`;
- turning the pain/injury toggle off no longer erases an explicit red-flag disclosure;
- adapter normalization still sets the legacy aggregate `SubjectiveInput.painFlag` when any clinical source is active, preserving backward compatibility while `clinicalEnvelopeSources` retains the true source.

Regression coverage: `redFlagIndependence.test.ts:mapCheckinToSubjectiveInput`.

## 4. Engine and presentation invariants

When a red-flag finding reaches the engine:
- `redFlagActive = true`;
- `clinicalEscalationRequired = true`;
- `maxAllowableTier = 'Rest'`;
- readiness mode is forced to `recover`;
- ranked catalog prescriptions collapse to Rest;
- one-tap harder/easier alternatives are disabled;
- the decision card presents clinical-escalation messaging.

The **presentation layer must fail closed as well as the engine**. While `clinicalEscalationRequired` is true, the Morning Decision card:
- does not expose **Start Session**;
- does not expose **View Workout Targets**;
- does not expose workout export/sync actions;
- does not expose the **1-Tap Alternatives** tab or load stepper;
- does not expose the **Workout Steps** tab or rendered structured targets;
- keeps **Why & Invalidation Rules** available so the athlete can inspect the evidence and reason for the pause.

This avoids a misleading state where execution is blocked in an event handler but the application still displays executable-looking training instructions.

Severe fever/chills in structured health symptoms also creates an implicit `systemic_infection` finding even when the athlete did not use the explicit red-flag checklist.

## 5. Imported-session and event hardening

A cross-path review found that imported target events followed ADR-0019 D-EVENT and returned an advisory before ordinary clinical/readiness skip/defer logic. Under a red flag the old text could therefore still say: “the decision to start is yours.” That contradicted SEP-C4’s own safety contract.

The adjudication order is now:

`clinical escalation -> event advisory / session skip -> ordinary clinical/feasibility -> readiness -> dose`

Behavior:
- imported **training sessions** under clinical escalation return `skip`, with no execution dose and **no authored fallback suggestion**; even a fallback labelled as context can resemble an executable substitute, so the escalation path presents no training alternative;
- imported **events** remain represented as `advisory` so the recommender does not silently delete a real-world commitment, but the advisory explicitly says the engine **cannot clear the athlete to start**, requires medical evaluation first, and tells the athlete to seek urgent or emergency medical care for acute chest pain/pressure, unexplained shortness of breath, fainting/near-fainting, new neurological symptoms, or another emergency concern;
- the Morning Decision clinical-escalation banner uses the same urgent warning set rather than the narrower former wording that mentioned only chest pain, severe dyspnea, and fainting;
- the permissive “decision to start is yours” copy is not used under clinical escalation.

Regression coverage: `externalSessionClinicalEscalation.test.ts:adjudicate`, including the emergency-warning wording and the absence of an imported fallback prescription.

## 6. Evidence interpretation

- Herring SA et al. *Initial Assessment and Management of Select Musculoskeletal Injuries: A Team Physician Consensus Statement.* Med Sci Sports Exerc. 2024. Supports appropriate initial assessment/management of significant sports injuries; it does not validate this software taxonomy verbatim.
- Hainline B et al. IOC consensus on pain management in elite athletes. Supports separating pain management from serious pathology assessment; again, it does not turn application labels into diagnoses.
- Gulati M et al. *2021 AHA/ACC Guideline for the Evaluation and Diagnosis of Chest Pain.* Circulation. 2021. Acute chest pain/chest-pain equivalents, including shortness of breath, warrant immediate medical evaluation; this supports stronger emergency wording rather than generic “monitor/rest” language.
- Kim JH et al. *Clinical Considerations for Competitive Sports Participation for Athletes With Cardiovascular Abnormalities: A Scientific Statement From the American Heart Association and American College of Cardiology.* Circulation. 2025;151:e716–e761. Cardiopulmonary symptoms relevant to sports-participation assessment include chest pain/tightness, dyspnea, palpitations, and presyncope/syncope. This supports routing such disclosures out of automated training clearance while clinical evaluation is pending.

**Product-policy boundary:** the application stops training recommendations when configured warning findings are reported. It does not determine the underlying diagnosis, severity, cause, or fitness to return to sport.

The same evidence discipline applies to SEP-C2 and SEP-C3. Subjective wellness research supports using self-reported recovery/fatigue signals in load monitoring, but does **not** clinically validate the product's exact 1–10 thresholds. Likewise, next-morning symptom response is a useful load-monitoring concept in tendinopathy rehabilitation, but the product's latency rule is an adapted conservative heuristic rather than a universal tissue diagnostic criterion.

## 7. Verification additions in PR #320

Focused regression tests added during review:
- `injuryPolicyLatencySafety.test.ts:deriveTissueSeverity` — missing latency follow-up fails closed;
- `subjectiveThresholdSafety.test.ts:evaluateReadinessAndSafetyEnvelope` — 8/10 fatigue or soreness cannot be diluted by other good answers;
- `externalSessionClinicalEscalation.test.ts:adjudicate` — imported sessions/events cannot bypass escalation, imported training does not expose a fallback suggestion, and imported-event copy retains the urgent cardiopulmonary/neurological warning language;
- `MorningDecisionCardClinicalEscalation.test.tsx` — clinical escalation keeps rationale visible while suppressing start/view/export/alternative/workout-step surfaces;
- `redFlagIndependence.test.ts:mapCheckinToSubjectiveInput` — explicit red flags remain independent from the pain/injury toggle;
- `redFlagReasonLabel.test.ts:evaluateEnvelopes` — the `systemic_infection` storage key renders as the non-diagnostic “systemic / cardiopulmonary warning” in user-facing clinical rationale.
