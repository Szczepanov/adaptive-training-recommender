# SEP-A evidence appraisal — subjective readiness

**Date:** 2026-09-01
**Scope:** `readiness.subjective_mode_thresholds` only. This review covers the live current-day subjective classifier in `rules.ts` `evaluateReadinessAndSafetyEnvelope`. It does not cover generic pain/illness handling, structured injury policy, or ADR-0020's default-off subjective-drift estimator.
**Decision:** retain the behavior without a threshold change; migrate coverage to **partial / P0**, not covered. The scientific boundary and product policy are registered separately, and normal decision lineage records both. Exact calibration and partial-check-in participation remain open P0 work.

## Questions and method

The review asked four atomic questions before source selection:

1. Can repeated athlete self-reports provide useful context about recent training response?
2. What measurement-property limitations apply to common single-item wellness ratings?
3. Does evidence validate the product's equal-weight five-item score, exact mode cut-points, combinations, or neutral defaults?
4. Does the evidence justify changing the current conservative classifier now?

Searches were run on 2026-09-01 in PubMed using combinations of `athlete self-report wellness training response systematic review`, `single-item wellness training load systematic review`, `athlete-reported outcome measurement properties COSMIN`, and `wellness predictive capacity training load`. Reference trails from the selected reviews were used only to identify the item-specific elite-soccer cohort below. Selection prioritized systematic reviews, then a large multi-sport cohort and an item-specific athlete cohort that answer a stated limitation. No included study tested this application's wording, scales, missing-data handling, candidate alternatives, or train/modify/recover outcomes.

## Selected evidence and appraisal

| Source | Design / directness | What it supports | Material limitation |
| --- | --- | --- | --- |
| [Saw, Main & Gastin 2016](https://pubmed.ncbi.nlm.nih.gov/26423706/) — PMID 26423706, PMCID PMC4789708, DOI 10.1136/bjsports-2015-094758 | Systematic review; direct for repeated subjective monitoring | Across 56 original studies, subjective measures generally tracked acute/chronic training-load changes with greater sensitivity and consistency than the objective measures assessed. | Does not validate one instrument, action threshold, diagnosis, or session prescription. |
| [Duignan et al. 2020](https://pubmed.ncbi.nlm.nih.gov/32991706/) — PMID 32991706, PMCID PMC7534939, DOI 10.4085/1062-6050-0528.19 | Systematic review; direct for adult field/court team-sport single-item wellness | Fatigue, soreness and sleep-quality self-reports are commonly collected, but instruments and analyses vary; relationships with training load range from none to very large and are mostly trivial-to-moderate in larger-observation studies. | Training-load association is not a clinical or readiness outcome; no common score or clinically meaningful action boundary follows. |
| [Jeffries et al. 2020](https://pubmed.ncbi.nlm.nih.gov/32957081/) — PMID 32957081, DOI 10.1123/ijspp.2020-0386 | COSMIN systematic review; direct for measurement-property boundary | Frequent single-item athlete-reported measures had little validity evidence in the review; multiple-item instruments also had content-validity and measurement-error concerns. | A 2020 snapshot does not show every item is invalid or rule out subsequent instrument-specific validation. |
| [Thorpe et al. 2016](https://pubmed.ncbi.nlm.nih.gov/26816390/) — PMID 26816390, DOI 10.1123/ijspp.2015-0490 | Small elite-soccer cohort; partially direct | Morning fatigue, sleep quality and soreness changed with an in-season weekly load pattern more clearly than measured HR-derived indices. | One team, short observation window; no readiness/motivation/stress validation and no decision-threshold test. |
| [Campbell et al. 2021](https://pubmed.ncbi.nlm.nih.gov/33404378/) — PMID 33404378, DOI 10.1080/02640414.2020.1870303 | 14,109-observation cohort in cricket, rugby league and football; indirect | Wellness questionnaires had limited predictive capacity for load measures, reinforcing caution about assigning standalone predictive authority. | Load prediction is not readiness, injury safety, illness, performance, or the value of a recommended session. |

## Supported boundary

- Repeated athlete self-reports can add contextual information about training response. This is a monitoring input, not a diagnostic or clearance instrument.
- The current evidence does not make fatigue, soreness, sleep quality, stress, readiness and motivation interchangeable measurements of one validated latent construct.
- Common single-item wellness ratings and modified questionnaires have heterogeneous and incompletely established measurement properties. Within-person, consistent-instrument interpretation is safer than treating a score as a universal physiological scale.

These conclusions are captured by `readiness.subjective.contextual_monitoring` and `readiness.subjective.measurement_quality_limits`. Their authority is informational, not a direct command to change an athlete's session.

## Contested or bounded conclusions

- Subjective reports can be sensitive to load changes, while larger-observation work also finds limited load-prediction capacity. These are not contradictory questions: sensitivity to change does not establish accurate prediction of external load, readiness, injury, or response to an alternative session.
- The most directly relevant work is concentrated in team-sport settings. Generalization to all supported sports, recreational users, chronic disease, injuries, and consumer self-administration is limited.
- Item direction, wording, response anchor, timing, coach context, response bias, and missingness are potentially material. The selected evidence does not identify a uniform best composite.

## Unsupported by the selected evidence

The review found no direct validation for any of the following live policy features:

- the equal weighting of fatigue, soreness, inverted readiness, inverted sleep quality and inverted motivation;
- the composite `> 5` modify and `> 7` recover boundaries;
- the independent `> 6`/`> 8` and combination `3`/`4`/`6`/`8`/`9` comparisons;
- a neutral value of 5 being equivalent to a response when a complete minimum-safety check-in omits other scale dimensions;
- a single-day mode output improving safety, health, performance, or adherence compared with other actions.

That negative result is intentionally captured by `readiness.subjective.exact_cutpoint_limits`; it does not prove the existing policy is ineffective, nor identify a safe replacement threshold.

## Product-policy and safety decision

`policy.readiness.subjective_mode_thresholds_v1` records the current classifier exactly: five equal-weight dimensions, inversion directions, strict composite operators, independent/combination triggers, and neutral midpoint normalization after `safetyCheckin.ts` `getMinimumSafetyCheckinStatus` permits a normal recommendation. It is a heuristic with `not_applicable` scientific certainty and conditional authority.

The neutral-default detail is material. A check-in with answered pain/injury, illness and already-trained flags plus either fatigue or soreness can pass minimum safety; `adapters.ts` `mapCheckinToSubjectiveInput` normalizes omitted scale fields to 5, so a normal classifier and audit can be produced even though not all five dimensions were measured. SEP-A documents this rather than silently treating all fields as observed. It does not change the minimum-safety gate or defaults; any change belongs in SEP-C.

`painFlag`, illness mapping, and subjective drift are explicitly excluded from this SEP-A authority. They remain separate policy surfaces, with no use of subjective-readiness science to justify their action.

## Coverage and follow-up

`readiness.subjective_mode_thresholds` is now **partial / P0**. The registry and runtime lineage make the evidence boundary and current product calibration reviewable, but the direct action threshold, neutral-default participation, and outcome calibration remain insufficiently supported for `covered`.

The next review should prospectively evaluate, by athlete and check-in completeness:

- calibration and decision distribution at each threshold and combination;
- adverse-event, symptom, adherence and completed-session outcomes;
- difference between fully answered and neutral-default partial check-ins;
- whether a personal baseline/change model or a different safety gate improves outcomes;
- clear escalation criteria for pain, illness, and other clinical red flags under SEP-B/SEP-C.

No executable recommendation rule changed in SEP-A. Claim versions are frozen by `provenance.ts` `buildRecommendationAudit` through the existing v4 knowledge-lineage boundary; no global `POLICY_VERSION` change is required.
