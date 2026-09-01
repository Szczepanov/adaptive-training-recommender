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

This is a **targeted evidence appraisal**, not a de-novo PRISMA systematic review. PubMed was searched on 2026-09-01, synthesis/reference trails were checked for directly relevant measurement studies, and the final registry set intentionally favors higher-level/current evidence over keeping every historical cohort. No included study tested this application's wording, scales, missing-data handling, candidate alternatives, or train/modify/recover outcomes.

### Search and screening log

The exact PubMed search strings used were:

- `athlete self-report wellness training response systematic review`
- `single-item wellness training load systematic review`
- `athlete-reported outcome measurement properties COSMIN`
- `wellness predictive capacity training load`
- `football load acute psychophysiological responses meta-analysis`
- `ARSS SRSS psychometric athletes recovery stress`

The first implementation pass did **not** preserve the raw PubMed result-total count displayed for each query. Those totals are mutable and cannot be reconstructed honestly from the retained PR artifacts, so this appraisal does not invent them. That is a reproducibility limitation against the umbrella plan's stricter search-log requirement. What is reproducible from the retained work is the exact query set, the deduplicated candidate set actually appraised, the final inclusion decision, and the reason for each exclusion. Future evidence-pack searches should capture raw result counts at search time.

Nine unique candidate records were appraised in this bounded review. Six are registered as scientific sources; three were excluded from the registry because a newer included source supplied the same authority more directly.

| Record | Screening decision | Reason |
| --- | --- | --- |
| Saw, Main & Gastin 2016 — PMID 26423706 | Include | Broad systematic review of subjective monitoring response. |
| Duignan et al. 2020 — PMID 32991706 | Include | Direct systematic review of single-item team-sport wellbeing measures. |
| Jeffries et al. 2020 — PMID 32957081 | Include | COSMIN measurement-property review; directly informs validity limits. |
| Campbell et al. 2021 — PMID 33404378 | Include | Large observational dataset useful for the predictive-authority boundary. |
| Brauers et al. 2026 — PMID 40159621 | Include | Most current quantitative synthesis found in scope; 62 articles/1,474 participants and explicit GRADE appraisal. |
| Brauers et al. 2024 — PMID 38451830 | Include | Important post-2020 counterexample showing that named ARSS/SRSS instruments can receive instrument-specific psychometric support. |
| Kölling et al. 2019 — PMID 31696778 | Exclude from registry | Earlier ARSS/SRSS English validation; useful context but superseded for this narrow boundary by the 2024 replication/extension. |
| Nässi et al. 2017 — PMID 28463598 | Exclude from registry | Development/initial validation of ARSS/SRSS; historical context already represented by the newer validation study. |
| Thorpe et al. 2016 — PMID 26816390 | Exclude from registry | Small single-team cohort; the 2026 meta-analysis now supplies broader, more current quantitative evidence for the same load-response question and does not create threshold authority. |

No duplicates remain in the registered source IDs or PMID set. The review also checked whether any selected paper prospectively validated the application's exact questionnaire wording, five-item equal weighting, neutral-default handling, or train/modify/recover cut-points; none did. That is a scoped negative finding, not proof that no such study can exist anywhere.

## Selected evidence and appraisal

| Source | Design / directness | What it supports | Material limitation |
| --- | --- | --- | --- |
| [Saw, Main & Gastin 2016](https://pubmed.ncbi.nlm.nih.gov/26423706/) — PMID 26423706, PMCID PMC4789708, DOI 10.1136/bjsports-2015-094758 | Systematic review; direct for repeated subjective monitoring | Across 56 original studies, subjective measures generally tracked acute/chronic training-load changes with greater sensitivity and consistency than the objective measures assessed. | Does not validate one instrument, action threshold, diagnosis, or session prescription. |
| [Duignan et al. 2020](https://pubmed.ncbi.nlm.nih.gov/32991706/) — PMID 32991706, PMCID PMC7534939, DOI 10.4085/1062-6050-0528.19 | Systematic review; direct for adult field/court team-sport single-item wellness | Fatigue, soreness and sleep-quality self-reports are commonly collected, but instruments and analyses vary; relationships with training load range from none to very large and are mostly trivial-to-moderate in larger-observation studies. | Training-load association is not a clinical or readiness outcome; no common score or clinically meaningful action boundary follows. |
| [Jeffries et al. 2020](https://pubmed.ncbi.nlm.nih.gov/32957081/) — PMID 32957081, DOI 10.1123/ijspp.2020-0386 | COSMIN systematic review; direct for measurement-property boundary | Frequent single-item athlete-reported measures had little validity evidence in the review; multiple-item instruments also had content-validity and measurement-error concerns. | A 2020 snapshot does not show every item is invalid or rule out subsequent instrument-specific validation. |
| [Brauers et al. 2024](https://pubmed.ncbi.nlm.nih.gov/38451830/) — PMID 38451830, DOI 10.1080/02640414.2024.2325783 | Cross-sectional psychometric study in 385 athletes; partially direct | Replicated ARSS/SRSS models showed satisfactory internal consistency and construct-validity support for these named instruments. | Validity is instrument-specific; it does not transfer to the app's bespoke single items, equal-weight composite, defaults, or thresholds. |
| [Brauers et al. 2026](https://pubmed.ncbi.nlm.nih.gov/40159621/) — PMID 40159621, DOI 10.1080/24733938.2025.2476474 | Meta-analysis of 62 articles / 1,474 football-code athletes; direct for short-term load-response associations | Significant but modest associations were reported for overall wellbeing, soreness, fatigue, sleep quality and stress. | High risk of bias, wide prediction intervals and imprecision led the authors to rate certainty **very low** with GRADE. This supports contextual monitoring, not prescriptive thresholds. |
| [Campbell et al. 2021](https://pubmed.ncbi.nlm.nih.gov/33404378/) — PMID 33404378, DOI 10.1080/02640414.2020.1870303 | 14,109-observation cohort in cricket, rugby league and football; indirect | Wellness questionnaires had limited predictive capacity for load measures, reinforcing caution about assigning standalone predictive authority. | Load prediction is not readiness, injury safety, illness, performance, or the value of a recommended session. |

## Supported boundary

- Repeated athlete self-reports can add contextual information about recent training response. This is a monitoring input, not a diagnostic or clearance instrument.
- The newest quantitative synthesis found in scope supports short-term associations between load and several subjective responses, but its GRADE certainty is very low. Accordingly, `readiness.subjective.contextual_monitoring` is deliberately **low-certainty informational authority**, not a prescription rule.
- The current evidence does not make fatigue, soreness, sleep quality, stress, readiness and motivation interchangeable measurements of one validated latent construct.
- Common single-item wellness ratings and modified questionnaires have heterogeneous and incompletely established measurement properties. Later ARSS/SRSS work also shows that named instruments can be psychometrically supported; this strengthens the rule that validation is **instrument-specific**, not transferable by similarity.

These conclusions are captured by `readiness.subjective.contextual_monitoring` and `readiness.subjective.measurement_quality_limits`. Their authority is informational, not a direct command to change an athlete's session.

## Contested or bounded conclusions

- Subjective reports can be sensitive to load changes, while larger-observation work also finds limited load-prediction capacity. These are not contradictory questions: sensitivity or correlation with recent load does not establish accurate prediction of readiness, injury, or response to an alternative session.
- The 2026 meta-analysis gives quantitative effect estimates but also explicitly grades certainty very low. The registry therefore does not treat recency or meta-analysis status as a reason to inflate certainty.
- Jeffries 2020 found major validation gaps for frequent single-item AROMs, while later ARSS/SRSS studies demonstrate psychometric support for specific named instruments. The correct inference is not “self-report is unvalidated”; it is “validity must be established for the actual instrument and use.”
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

`painFlag`, illness mapping, and subjective drift are explicitly excluded from this SEP-A authority. `alreadyTrainedToday` and objective `today_training` are terminal recommendation overrides adjacent to the classifier rather than evidence-backed subjective threshold conditions. Their behavior is preserved and tested, but they are not justified by the SEP-A scientific claims.

Runtime lineage in v4 means **policy/evidence evaluated on the ordinary normalized readiness path**, not a causal attribution that every referenced family determined the final mode. This distinction is material on days where another override (for example pain or already-trained state) ultimately dominates the recommendation; SEP-B/SEP-C can add more granular causal/materiality provenance if that becomes necessary.

## Coverage and follow-up

`readiness.subjective_mode_thresholds` is now **partial / P0**. The registry and runtime lineage make the evidence boundary and current product calibration reviewable, but the direct action threshold, neutral-default participation, and outcome calibration remain insufficiently supported for `covered`.

The next review should prospectively evaluate, by athlete and check-in completeness:

- calibration and decision distribution at each threshold and combination;
- adverse-event, symptom, adherence and completed-session outcomes;
- difference between fully answered and neutral-default partial check-ins;
- whether a personal baseline/change model or a different safety gate improves outcomes;
- whether lineage needs evaluated-policy versus causal-decision role labels before more safety families are migrated;
- clear escalation criteria for pain, illness, and other clinical red flags under SEP-B/SEP-C.

No executable recommendation rule changed in SEP-A. Claim versions are frozen by `provenance.ts` `buildRecommendationAudit` through the existing v4 knowledge-lineage boundary; no global `POLICY_VERSION` change is required.
