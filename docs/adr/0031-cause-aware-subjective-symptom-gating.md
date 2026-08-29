# ADR-0031: Cause-Aware Subjective Symptom Gating

* **Status:** Accepted
* **Date:** 2026-08-29
* **Deciders:** Core Engineering Team

## Context

The morning check-in historically collapsed both `painOrInjury` and `illnessSymptoms` into the engine's `SubjectiveInput.painFlag`. In `rules.ts`, that flag is intentionally conservative: it activates the clinical safety envelope, adds a Running restriction, and caps the plan at Mobility. That is appropriate for undifferentiated illness or injury, but it also treated athlete-reported hay-fever symptoms exactly like systemic infection.

PR #282 adds a richer symptom vocabulary (`congestion`, `runny_nose`, `sneezing`, etc.) and an athlete-reported `suspectedCause`. That makes a narrow allergy exception possible, but it also creates a false-negative risk: selecting `allergy` is a self-report, not a diagnosis, and clearing `painFlag` removes a strong training restriction.

Sports-medicine guidance supports distinguishing non-infective respiratory illness from acute respiratory infection, while also emphasizing diagnostic uncertainty and overlap between allergic rhinitis, asthma and exercise-induced bronchoconstriction. The app currently has no dedicated wheeze, chest-tightness, dyspnoea, exercise-induced bronchoconstriction or objective allergy-diagnosis fields, so ambiguous respiratory presentations cannot safely be inferred to be benign allergy.

Research anchors:

- IOC consensus on acute respiratory illness in athletes, part 1 (acute respiratory infections): https://pubmed.ncbi.nlm.nih.gov/35863871/
- IOC consensus on acute respiratory illness in athletes, part 2 (non-infective respiratory illness): https://pubmed.ncbi.nlm.nih.gov/35623888/
- EAACI position paper on allergy and respiratory disorders in sport: https://pubmed.ncbi.nlm.nih.gov/35809082/
- Polish Society of Allergology / Polish Society of Sports Medicine position paper on asthma and exercise-induced respiratory disorders in athletes: https://pubmed.ncbi.nlm.nih.gov/30858772/

## Decision

- **D-ALLERGY-SELF-REPORT:** `suspectedCause` records the athlete's own attribution. It is never treated as a diagnosis and is never inferred from symptom types or wearable physiology.
- **D-ALLERGY-FAIL-CLOSED:** the legacy illness safety behavior remains the default. Missing or ambiguous detail must not soften `painFlag`.
- **D-ALLERGY-EXPLICIT-SEVERITY:** an allergy-attributed day may soften the illness contribution to `painFlag` only when severity is explicitly `mild` or `moderate`. Missing, `null` or `severe` severity remains conservative.
- **D-ALLERGY-NASAL-SHAPE:** symptom types must be present and non-empty, and every reported type must be one of `congestion`, `runny_nose`, or `sneezing`.
- **D-ALLERGY-BROAD-SYMPTOMS:** `sore_throat`, `cough`, `fever_or_chills`, `headache_or_body_aches`, `gastrointestinal`, `unusual_fatigue`, `other`, or any future type not added deliberately to the allow-list keeps the existing illness gate active even when the athlete selects `allergy`.
- **D-ALLERGY-INJURY-AUTHORITY:** `painOrInjury` remains unconditional. Allergy attribution can only remove the `illnessSymptoms` contribution; it can never loosen an injury/tissue restriction.
- **D-ALLERGY-BOUNDARY:** the decision stays in `adapters.ts::mapCheckinToSubjectiveInput`. `rules.ts` continues to consume a simple `painFlag` and owns the safety-envelope consequence. This keeps persistence vocabulary separate from the narrower decision-eligible subset.
- **D-ALLERGY-ANOMALY-ORTHOGONAL:** physiological-anomaly reporting may retain symptom/cause context independently. The real-time training exception does not erase abnormal measurements, prove an allergy diagnosis, or reclassify an anomaly as infectious/non-infectious disease.

## Consequences

The rule intentionally prefers false positives (an unnecessary conservative day) over false negatives at the clinical-gating boundary. A real allergy presentation that includes cough, sore throat or another broader symptom will still be restricted until the health-context model can represent the respiratory red flags and/or stronger diagnostic evidence needed to distinguish allergic rhinitis from infection or exercise-induced airway disease.

The positive allow-list is also safer under schema evolution than a blacklist: a newly added symptom type remains conservative automatically until the decision policy explicitly reviews it.

`POLICY_VERSION` remains `2026-08-allergy-symptom-gating-v1` because this hardening is part of the same unmerged policy change introduced by PR #282, not a post-release policy revision.

## Verification

`adapters.test.ts` must cover at least:

- the valid mild and moderate nasal-allergy paths;
- missing and `null` severity;
- missing symptom types;
- severe symptoms;
- every current non-nasal symptom type;
- `infectious`, `unsure` and absent cause;
- unconditional `painOrInjury` authority.

Firestore validation remains permissive enough to store honest athlete reports; the adapter is responsible for deciding whether that report is sufficiently specific to relax the recommendation safety gate. Policy-drift checks must continue to treat `adapters.ts` as decision-affecting.
