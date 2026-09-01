# SEP-C1 — Contextual clinical envelope remediation

**Date:** 2026-09-01  
**Scope:** PR #319 — decouple non-allergy illness from the generic Running restriction while preserving conservative systemic symptom handling and injury restrictions.

## Problem found during review

The initial SEP-C1 implementation correctly separated the *source* of the legacy aggregate clinical flag, but then used `UserContext.injuryPolicyTrace.regionMappingFamilies` to decide whether generic pain should restrict Running.

That was unsafe for two reasons:

1. `injuryPolicyTrace` is evidence/provenance. It is intentionally allowed to contain standing injury mappings and is consumed by `knowledgeLineage.ts`; it is not the current symptom location.
2. A standing, unrelated shoulder/hip/back constraint could therefore be mistaken for the location of a new unstructured pain report and suppress the fail-closed generic Running restriction.

Example of the bad attribution:

- standing shoulder constraint -> trace contains `upper_limb_loading`;
- today's check-in says `painOrInjury=true` but supplies no tissue location;
- treating trace as today's location would conclude "upper limb only" and remove the generic Running restriction even though today's pain location is unknown.

## Corrected architecture

SEP-C1 now keeps three concepts separate.

### 1. Current clinical-source category

`SubjectiveInput.clinicalEnvelopeSources` records only compact current-day source categories:

- `pain_or_injury`
- `non_allergy_illness`

The legacy `painFlag` remains an aggregate compatibility signal. New code must not assume that `painFlag=true` means musculoskeletal pain.

### 2. Current pain location decision input

`SubjectiveInput.painOrInjuryRegionFamilies` is derived only from **today's structured `tissueResponses`** when `painOrInjury=true`.

It is the only region-family input used to contextualize the generic Running fallback.

- absent/empty => current pain location is unknown, fail closed;
- includes `lower_limb_impact` => generic Running fallback remains;
- isolated `lower_limb_strength`, `lumbar_loading`, or `upper_limb_loading` => no generic Running fallback is added;
- mixed families including `lower_limb_impact` => generic Running fallback remains.

### 3. Standing injury policy + provenance

Standing and today-tightened injury constraints still flow through `resolveInjuryPolicy()` into executable restrictions/guardrails/categories.

`injuryPolicyTrace` remains observational/provenance data for versioned knowledge lineage. `rules.ts` does **not** read it to loosen or create the current pain restriction.

## Behaviour matrix

| Current input | Generic Running fallback | Plan ceiling | Notes |
|---|---|---|---|
| Legacy aggregate clinical flag only | Restrict | Mobility | Fail closed; source/location unknown |
| Pain/injury, location unknown | Restrict | Mobility | Fail closed |
| Pain/injury + current lower-limb-impact family | Restrict | Mobility | E.g. knee/Achilles/ankle/calf family |
| Pain/injury + isolated upper-limb family | Do not add | Mobility | Standing/explicit restrictions remain additive |
| Pain/injury + isolated lumbar family | Do not add | Mobility | Not a medical clearance |
| Pain/injury + isolated lower-limb-strength family | Do not add | Mobility | Not a medical clearance |
| Non-allergy illness only | Do not add | Mobility | Systemic symptom handling, not an anatomy-derived restriction |
| Already trained today + current clinical symptoms | As above | Rest | Existing already-trained override remains stricter |
| Explicit/standing Running restriction | Restrict | Independent | Never removed by SEP-C1 |

**Important:** "do not add generic Running fallback" is not the same as "Running is medically safe." The recommendation engine still applies standing constraints, today-derived tissue restrictions, other hard guardrails, availability, readiness and plan gates. The product does not diagnose or provide clinical return-to-sport clearance.

## Evidence boundary

The code change is primarily a **semantic and safety architecture correction**, not a claim that illness makes Running safe or that a body-region label is sufficient for return-to-sport clearance.

Relevant external evidence supports the boundary:

- The IOC consensus on acute respiratory illness in athletes treats respiratory illness assessment and return-to-sport as a dedicated clinical pathway rather than a musculoskeletal injury rule: Schwellnus M, et al. *International Olympic Committee (IOC) consensus statement on acute respiratory illness in athletes part 1: acute respiratory infections.* Br J Sports Med. 2022. PMID 35863871. https://pubmed.ncbi.nlm.nih.gov/35863871/
- A systematic review of acute respiratory illness in athletes found substantial heterogeneity and limited return-to-sport evidence; it does not establish an anatomy-specific Running prohibition from illness alone: *Acute respiratory illness and return to sport in athletes: a systematic review and meta-analysis.* PMID 34789459. https://pubmed.ncbi.nlm.nih.gov/34789459/
- Return-to-sport consensus frameworks emphasize criteria-based, multifactorial and contextual decision-making rather than a single pain boolean or body-region lookup: Ardern CL, et al. *Panther Symposium ACL Injury Return to Sport Consensus Group.* PMID 32647735. https://pubmed.ncbi.nlm.nih.gov/32647735/
- The injury/pain knowledge pack therefore continues to represent exact restriction mappings as `product_policy`, while external evidence supplies the clinical-boundary/limitations layer.

## Knowledge-lineage change

The old product-policy claim `policy.injury.generic_clinical_envelope_v1` is retained as **deprecated** so historical persisted lineage can still be interpreted.

Current decisions consume `policy.injury.contextual_clinical_envelope_v2`, which records the SEP-C1 split:

- current pain/injury and non-allergy illness both keep the conservative current-symptom ceiling;
- only the current pain/injury branch can add the generic Running fallback;
- current pain location comes from today's structured tissue responses;
- provenance trace cannot control that decision.

This intentionally causes old v1 lineage to appear drifted/deprecated rather than silently changing the meaning of a historical claim.

## Regression coverage

Dedicated tests pin the following invariants:

1. legacy/unlocated pain remains fail-closed;
2. isolated current upper-limb/lumbar/lower-limb-strength context does not invent a Running ban;
3. lower-limb-impact and mixed-impact current pain keep the Running fallback;
4. illness-only keeps the Mobility ceiling without an anatomy-specific Running ban;
5. explicit/standing Running restrictions remain additive;
6. an unrelated standing upper-limb trace cannot explain away unlocated current pain;
7. a standing lower-limb-impact trace cannot fabricate a Running ban for current isolated shoulder pain;
8. adapter normalization ignores stale tissue detail when `painOrInjury=false` and never creates pain location from illness-only input;
9. knowledge registry and policy descriptors remain versioned and reviewable.

## Non-goals

SEP-C1 does not:

- diagnose illness or injury;
- determine whether an athlete is clinically fit to run;
- replace red-flag assessment, examination, condition-specific rehabilitation or return-to-sport criteria;
- weaken explicit athlete restrictions or standing injury constraints;
- change the allergy-aware source normalization introduced by ADR-0032;
- make `injuryPolicyTrace` a policy input.

## Review invariant

Future changes should preserve this one-way dependency:

> **current check-in -> normalized current decision inputs -> executable safety policy**
>
> **standing/today injury evaluation -> executable restrictions + provenance trace -> knowledge lineage**

The second arrow must never be reversed by reading provenance back into the executable current-symptom decision.