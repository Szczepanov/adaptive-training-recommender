# SEP-B Injury, Tissue-Response, and Clinical-Symptom Evidence Review

**Date:** 2026-09-01

**Scope:** Existing injury-constraint, tissue-response, and clinical-symptom policy. This review does not change medical guidance or recommendation behavior.

## Decision summary

SEP-B registers the current executable mappings as high-safety product policy and records three scientific boundaries. The result is **partial**, not clinical validation: broad region labels and a boolean clinical-symptom flag do not contain the diagnosis, functional assessment, activity demands, or response history needed for condition-specific return-to-sport decisions.

The inventory therefore retains the tissue-response mapping, four region-family mappings, and generic clinical-symptom envelope as P0 research debt. The preserve-or-tighten behavior, expiry, explicit restriction pass-through, and today-only derived scope are software safety invariants rather than claims of external evidence.

## Reconciled policy surface

- `injuryPolicy.ts` `deriveTissueSeverity` maps the worst recorded daily response to `exclude`, `limit`, `monitor`, or no inferred constraint.
- `injuryPolicy.ts` `resolveEffectiveInjuryConstraints` preserves or tightens active standing constraints and makes newly inferred constraints today-only.
- `injuryPolicy.ts` `resolveInjuryRestrictions` has four distinct region families: lower-limb impact, lower-limb strength, lumbar loading, and upper-limb loading.
- `adapters.ts` `mapCheckinToSubjectiveInput` maps `painOrInjury` and non-allergy illness symptoms into the same `painFlag`.
- `rules.ts` `evaluateEnvelopes` adds Running restriction and Mobility ceiling for that flag; already-trained status tightens the ceiling to Rest.

Structured tissue response and the generic symptom envelope can both apply. They are separate policy branches and their lineage is independently recorded.

## Evidence appraisal

### Symptom and pain boundary

The IOC pain-management consensus describes pain in athletes as multifactorial and supports assessment of contributors rather than a single-cause interpretation. It does not provide an anatomy-agnostic training ceiling or consumer-app decision rule. The 2024 Team Physician consensus on selected musculoskeletal injuries similarly concerns clinician-led assessment rather than automated routing.

**Registered boundary:** pain or symptom report does not independently establish diagnosis, injury severity, tissue pathology, or session suitability.

**Limit:** this boundary is drawn from clinical/elite-athlete consensus and is not a validation study of the product check-in or its active restriction choices.

### Return-to-sport boundary

The Team Physician return-to-sport update supports contextual risk management rather than body-region-only routing. The product does not collect diagnosis, clinical examination, functional testing, imaging, activity demand, or shared decision-making inputs.

**Registered boundary:** condition-, athlete-, and activity-specific assessment is required for return-to-sport decisions.

**Limit:** this does not prove that the current regions should be restricted, or that unlisted modalities are safe.

### Tissue-response monitoring boundary

The lower-limb tendinopathy systematic review found that pain-based progression criteria were common in exercise programmes for specified Achilles, patellar, and gluteal tendinopathies, but that their use was not supported by strong comparative evidence.

**Registered boundary:** temporal symptom response can be a condition-specific monitoring input, but there is no support here for a universal severity scale, worst-signal aggregator, or monitor/limit/exclude translation.

**Limit:** this evidence does not apply to undiagnosed pain, acute injury, lumbar or upper-limb symptoms, illness, or all product sports.

### Deep-review cross-checks and evidence deliberately not promoted to runtime lineage

Additional literature was reviewed to challenge the boundaries above rather than to maximize registry size:

- Arora et al. (2024) umbrella-reviewed 274 systematic reviews of exercise for musculoskeletal pain and concluded that high-quality evidence is lacking for optimal prescription variables such as intensity, frequency and duration. This strengthens the decision **not** to present the current broad region restrictions or Mobility ceiling as evidence-derived dosing.
- Purcell et al. (2025) developed an athlete pain-assessment framework through international sports-physiotherapist Delphi consensus. Its multidimensional assessment model reinforces that a single pain boolean or body region is too sparse to support diagnosis-specific exercise clearance.
- IOC acute-respiratory-illness guidance (2022) was also checked because `painFlag` can be triggered by non-allergy illness. It provides a clinical framework for respiratory illness and return to sport, but the product's `illnessSymptoms` branch is broader: it can include gastrointestinal, systemic, respiratory, fatigue and other presentations. Attaching respiratory-illness science to every non-allergy illness decision would therefore create false lineage.

For that reason, illness-only runtime decisions intentionally receive the **generic product-policy claim only** in SEP-B. No pain-specific, musculoskeletal, tendinopathy, or respiratory-illness scientific claim is inferred from the undifferentiated illness boolean. A future cause-specific illness evidence pack can add scientific lineage once the runtime input establishes the matching condition/context without diagnosis inference.

## Product-policy conclusion

The following are explicit product choices, each represented by a versioned heuristic claim and alignment test:

- worst-signal tissue-response translation;
- lower-limb impact mapping;
- lower-limb strength mapping;
- lumbar loading mapping;
- upper-limb loading mapping;
- generic clinical-symptom Running/Mobility/Rest envelope.

No condition-specific guideline is attached at runtime from a region label alone. The runtime lineage attaches the relevant product descriptor and only the broad scientific boundary whose applicability matches the information actually available.

## Behavior-equivalence and policy-version guard

The implementation review found that a resolver test which compares `resolveInjuryPolicy()` with the same production resolver functions it delegates to is not an independent equivalence proof: both sides could change together. SEP-B therefore uses a **frozen pre-SEP-B oracle** in `injuryPolicyLineageEquivalence.test.ts`.

The oracle independently pins:

- every body region across `monitor` / `limit` / `exclude` and active/expired review states;
- all four tissue-response observation points across normal/mild/moderate/severe values, with and without standing constraints;
- explicit modality pass-through, multiple same-region constraints, regionless constraints and expired-plus-fresh tissue composition;
- the pre-existing pain/non-allergy-illness/allergy-like boolean semantics;
- equality of envelope and selected recommendation with versus without the runtime trace, excluding only `knowledgeRefs`.

The policy-drift exception is also **one-shot**. It is accepted only while the frozen oracle and this appraisal document are absent from the comparison-base tree. After SEP-B merges, those artifacts exist in `main`, so a later `adapters.ts` or `injuryPolicy.ts` executable change cannot reuse the SEP-B exception even if a developer edits the tests or documentation; the normal `POLICY_VERSION` rule applies.

## Sources reviewed

1. Hainline et al. *International Olympic Committee consensus statement on pain management in elite athletes*. Br J Sports Med. 2017;51:1245-1258. PMID 28827314; DOI 10.1136/bjsports-2017-097884.
2. Herring et al. *Team Physician Consensus Statement: Return to Sport/Return to Play and the Team Physician: A Team Physician Consensus Statement-2023 Update*. Curr Sports Med Rep. 2024;23:183-191. PMID 38709944; DOI 10.1249/JSR.0000000000001169.
3. Escriche-Escuder et al. *Load progression criteria in exercise programmes in lower limb tendinopathy: a systematic review*. BMJ Open. 2020;10:e041433. PMID 33444210; PMCID PMC7678382; DOI 10.1136/bmjopen-2020-041433.
4. Herring et al. *Initial Assessment and Management of Select Musculoskeletal Injuries: A Team Physician Consensus Statement*. Curr Sports Med Rep. 2024;23:86-104. PMID 38437494; DOI 10.1249/JSR.0000000000001151.

### Supplementary challenge sources reviewed, not registered for generic runtime attribution

5. Arora et al. *The Impact of Exercise Prescription Variables on Intervention Outcomes in Musculoskeletal Pain: An Umbrella Review of Systematic Reviews*. Sports Med. 2024;54:711-725. PMID 38093145; PMCID PMC10978700; DOI 10.1007/s40279-023-01966-2.
6. Purcell et al. *Developing Consensus for an Upper and Lower Limb Athlete Pain Assessment Framework — A Real-Time Delphi Study With International Sports Physiotherapists*. J Orthop Sports Phys Ther. 2025;55:45-55. PMID 39680670; DOI 10.2519/jospt.2024.12807.
7. Schwellnus et al. *International Olympic Committee (IOC) consensus statement on acute respiratory illness in athletes part 1: acute respiratory infections*. Br J Sports Med. 2022. PMID 35863871.

## Remaining work

SEP-B is behavior-identical evidence/provenance work. Any future change to restriction thresholds, body-region mappings, clinical ceiling, illness routing, red-flag behavior, or return-to-sport advice requires a separately scoped SEP-C policy change with `POLICY_VERSION` review and safety evaluation.

`POLICY_VERSION remains unchanged` because SEP-B's trace is observational: the frozen pre-SEP-B oracle pins the effective-constraint, restriction and clinical-flag behavior, while envelope/recommendation tests assert that removing the trace changes only knowledge lineage. Any future change to restriction thresholds or other executable injury/symptom behavior cannot reuse the one-shot SEP-B drift exception.
