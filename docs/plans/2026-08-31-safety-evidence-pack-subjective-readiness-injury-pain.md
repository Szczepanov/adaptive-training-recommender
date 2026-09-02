# Safety Evidence Pack — Subjective Readiness + Injury/Pain

**Date:** 2026-08-31
**Status:** Implemented — SEP-A, SEP-B, and SEP-C1–C4 (clinical envelope decoupling & running-restriction contextualization, subjective-mode thresholds, tissue-response latency, fail-closed clinical escalation) are all merged on `main`.
**Blocked by:** None. SKR1 (PR #312), SEP-A (PR #317), SEP-B (PR #318), SEP-C1 (PR #319), and SEP-C2–C4 (PR #320) are all on `main`.
**Unlocks:** (historical) SEP-C behavior remediation and versioned policy releases — both delivered.
**Priority:** P0 / high-safety debt.
**Execution cutline:** SEP-B was behavior-identical lineage. Executable policy changes are delivered via versioned SEP-C PRs.

> **SEP-B execution plan:** Use
> [`2026-09-01-safety-evidence-pack-injury-pain-sep-b.md`](./2026-09-01-safety-evidence-pack-injury-pain-sep-b.md)
> for current scope, reconciled behavior, claim boundaries, coverage migration,
> pull-request sequencing, and exit criteria. It takes precedence over older SEP-B
> shorthand in this parent plan.

## 1. Executive summary

The current Sports Knowledge Registry has intentionally left four high-safety policy families unresolved:

1. `readiness.subjective_mode_thresholds`;
2. `injury.tissue_response_severity`;
3. `injury.region_restriction_mapping`;
4. `injury.pain_envelope_mapping`.

They should not be solved by finding one paper that appears adjacent to the existing logic. The four families encode different kinds of authority:

- athlete self-report measurement and interpretation;
- translation of symptom response into restriction severity;
- translation of body region into permitted/forbidden loading;
- translation of a generic pain flag into a whole-day plan envelope.

The implementation must therefore preserve the same epistemic boundary used by the earlier evidence packs:

```text
scientific / clinical evidence
        ↓ establishes supported boundary
explicit product safety policy
        ↓ owns exact thresholds and conservative mappings
runtime material-use lineage
        ↓ freezes {claimId, version} in recommendation audit
historical recommendation
```

The evidence pack itself should be behavior-preserving. If the review finds that a live rule is unsupported, over-broad, or likely to be harmful, the pack should record that conclusion and create a separate behavior-changing remediation PR. It must not quietly rewrite safety behavior while simultaneously changing the evidence model.

The recommended execution is two reviewable evidence migrations under one umbrella pack:

- **SEP-A — Subjective readiness**: athlete self-report evidence, psychometric/measurement boundary, exact product threshold registration, coverage migration, and runtime lineage on the existing SKR1 contract.
- **SEP-B — Injury/pain safety**: return-to-sport/load-management boundary, tissue-response semantics, region mapping decomposition, generic pain-envelope review, product-policy registration, coverage migration, and runtime lineage on the existing SKR1 contract.

Any actual threshold or restriction change becomes **SEP-C — Safety policy remediation**, split further by policy family if needed.

### 1.1 SEP-A readiness review against current `main` (2026-09-01)

The original plan predated the merged SKR1 runtime. The current repository now has:

- schema-v4 `RecommendationAudit.knowledgeLineage` with central `{claimId, version}` snapshotting in `provenance.ts` `buildRecommendationAudit`;
- `knowledgeLineage.ts` `readinessKnowledgeRefs`, which deliberately excludes subjective claims while the coverage family remains unresolved;
- a valid 47-family coverage inventory with `readiness.subjective_mode_thresholds` still `uncovered / P0 / high decision impact / high safety impact`;
- the production subjective-drift selector still default-off under ADR-0020;
- cause-aware symptom mapping in `adapters.ts` `mapCheckinToSubjectiveInput` under ADR-0032.

SEP-A therefore does not need a schema or persistence migration. It needs one bounded evidence migration: review and register the current-day absolute subjective classifier, decide coverage honestly, and add material-use IDs through the existing v4 lineage path.

Two scope corrections are required:

1. `painFlag` is not part of the SEP-A subjective-threshold policy claim. It is a separate injury/illness safety input whose exact action belongs to `injury.pain_envelope_mapping` and SEP-B. SEP-A must preserve its behavior, but must not use subjective-readiness evidence to justify it.
2. The default-off subjective-drift estimator is outside SEP-A. ADR-0020 and Phase 9 own its estimator, evidence and production activation. SEP-A covers only the live absolute current-day score/combination thresholds.

---

## 2. Current repository state

### 2.1 `readiness.subjective_mode_thresholds`

Current policy in `engine/rules.ts`:

- five-item adverse-state average:
  - `fatigue`
  - `soreness`
  - inverted `readiness`
  - inverted `sleepQuality`
  - inverted `motivation`
- average `> 5` can force `modify`;
- average `> 7` can force `recover`;
- `fatigue > 8`, `soreness > 8`, or `painFlag` can force recovery;
- severe combinations include:
  - `fatigue >= 8 && readiness <= 4`;
  - `readiness <= 3 && stress >= 8`;
  - `fatigue >= 8 && stress >= 8`;
- acute modify combinations include:
  - `fatigue >= 8`;
  - `readiness <= 3`;
  - `stress >= 9`;
  - `readiness <= 4 && fatigue >= 6`;
- `soreness > 6` can independently force `modify`.

SEP-A outcome: **partial / P0 / high decision impact / high safety impact**. Analysis: `docs/analysis/2026-09-01-evidence-pack-subjective-readiness.md`.

The exact numerical cut-points are product-authored. Earlier HRV/sleep evidence must not be used to legitimize these subjective thresholds by proximity.

`painFlag` appears in the same live function but remains a separate policy family. It must be locked by behavior-preservation tests during SEP-A and receive no SEP-A claim attribution.

### 2.2 `injury.tissue_response_severity`

Current policy in `engine/injuryPolicy.ts` observes, per body region:

- morning state;
- pain during training;
- after-training state;
- next-morning reaction.

The worst observation is translated as:

```text
severe   -> exclude
moderate -> limit
mild     -> monitor
normal   -> no added restriction
```

Observed tissue response is **preserve-or-tighten only** relative to a standing injury constraint.

Coverage today: **uncovered / P0 / high decision impact / high safety impact**.

There are two separate questions hidden in this family and they must not be conflated:

1. Is longitudinal / during-after-next-day symptom response a useful loading signal for some rehabilitation contexts?
2. Do the product's four semantic labels justify the exact `monitor/limit/exclude` translation for every tissue and condition?

### 2.3 `injury.region_restriction_mapping`

Current policy in `engine/injuryPolicy.ts` maps region to restrictions:

- knee / Achilles / ankle / calf -> `avoid_high_impact`; `exclude` additionally blocks Running;
- hamstring / quadriceps / adductor-groin / hip -> `avoid_heavy_lower_body`; `exclude` additionally removes Lower-body Strength and Full-body Strength;
- lower back -> `avoid_heavy_spinal_loading`; `exclude` additionally adds `avoid_heavy_lower_body`;
- shoulder / elbow / wrist -> `avoid_overhead_pressing`; `exclude` additionally removes Upper-body Strength.

Coverage today: **uncovered / P0 / high decision impact / high safety impact**.

The current family is too broad for a single clinical claim. A body-region label is not a diagnosis, and different injuries in the same region can have different loading tolerances and return-to-sport criteria.

### 2.4 `injury.pain_envelope_mapping`

Current generic `painFlag` policy in `engine/rules.ts:evaluateEnvelopes`:

- activates the clinical envelope;
- adds Running to restricted modalities;
- caps the plan at Mobility.

Coverage today: **uncovered / P0 / high decision impact / high safety impact**.

This rule intentionally fails conservative, but it has no location, diagnosis, severity, function, mechanism, or structured tissue-response context. The evidence review must therefore ask whether scientific evidence can support the current generic action at all, rather than treating "pain matters" as proof that "any pain means no running and Mobility only".

---

## 3. Safety and epistemic design principles

### D-SEP-01 — No evidence laundering

A source about athlete wellness does not validate a specific 1–10 readiness threshold. A source about Achilles tendinopathy does not validate every knee, calf, ankle, or hamstring restriction. A return-to-sport consensus does not validate an exact `monitor/limit/exclude` lookup table.

Each claim must be no broader than the evidence directly supports.

### D-SEP-02 — Separate measurement value from action authority

For each signal, explicitly distinguish:

1. **measurement/monitoring value** — is the signal informative?
2. **directional action authority** — can adverse movement reasonably justify more conservative training?
3. **numeric action authority** — is an exact cut-point validated?

A signal can have moderate evidence for monitoring while exact action thresholds remain product calibration.

### D-SEP-03 — Do not force a universal pain threshold

Pain and soreness are context-dependent. The review must preserve the possibility that selected conditions can be safely loaded with tolerable symptoms under a structured rehabilitation protocol, while other presentations require restriction or clinical escalation.

The evidence pack must not invent a universal `0–10` pain threshold if the literature does not support one.

### D-SEP-04 — Body region is a routing hint, not a diagnosis

The product may use region as a conservative routing signal, but the registry must not claim that region alone identifies pathology or defines optimal loading.

### D-SEP-05 — Keep safety invariants distinct from scientific claims

Examples that may remain product safety invariants rather than scientific claims:

- missing critical safety data fails closed;
- a same-day observed worsening cannot automatically clear a stricter standing injury constraint;
- explicit clinician/user-authored restrictions outrank inferred permissive signals.

These invariants can be defensible engineering contracts without pretending they are physiological laws.

### D-SEP-06 — Evidence migration is behavior-preserving

The evidence-pack PRs may add:

- sources;
- claims;
- limitations;
- coverage references;
- policy-alignment tests;
- runtime provenance/knowledge refs through the existing SKR1 mechanism.

They must not change:

- readiness numeric thresholds;
- pain-mode decisions;
- region-to-restriction mappings;
- tissue severity transitions;
- injury expiration semantics;
- candidate eligibility.

If evidence requires a change, create a separate remediation PR with a `POLICY_VERSION` decision, simulations, regression review, and explicit rollout notes.

### D-SEP-07 — Coverage is an audit outcome, not a KPI

The goal is not to turn all four P0 rows green. A high-safety family may correctly remain `partial` or `uncovered` if the review shows that the product policy is under-specified or lacks direct support.

---

## 4. Definition of done

The Safety Evidence Pack is complete when all four P0 families have:

1. an explicit evidence question;
2. a reproducible search/appraisal record;
3. selected primary/guideline/synthesis sources with stable identifiers where available;
4. atomic scientific/clinical claims no broader than those sources support;
5. explicit product-policy claims for exact live thresholds/mappings that are not scientific constants;
6. documented contested and unsupported conclusions;
7. updated coverage state with a rationale that explains any remaining gap;
8. policy-alignment tests proving the registered product policy still matches the executable rule;
9. runtime claim attribution through the existing SKR1 path only when the corresponding policy is evaluated with applicable input;
10. no recommendation behavior delta in the evidence migration itself.

The pack is **not** complete merely because a policy has citations.

---

## 5. Evidence search and appraisal protocol

### 5.1 Source hierarchy

Prefer, in order appropriate to the question:

1. clinical practice guidelines from recognized professional bodies;
2. consensus statements specifically addressing return to sport, rehabilitation, or athlete monitoring;
3. Cochrane reviews and high-quality systematic reviews/meta-analyses;
4. prospective/RCT evidence for symptom-guided loading or return-to-sport interventions;
5. longitudinal athlete cohorts for monitoring questions;
6. validation/psychometric studies for athlete self-report instruments;
7. primary studies when syntheses do not answer the exact question.

Do not treat publication type alone as certainty. Appraise directness, population, condition specificity, measurement quality, bias, heterogeneity, precision, and whether the source actually tested a training-action rule.

### 5.2 Required appraisal fields per source

For every selected source record, capture in the analysis document:

- population and sport/clinical context;
- design and sample size;
- condition/body region where applicable;
- signal or intervention measured;
- comparator;
- outcome relevant to the claim;
- directness to recommendation authority;
- whether any numeric threshold was prospectively validated;
- major limitations;
- funding/device affiliation where material;
- external identifiers (`PMID`, `PMCID`, `DOI`, `PROSPERO`) where available.

### 5.3 Search windows

- Start with the most recent guideline/systematic-review layer.
- Backfill landmark primary studies that define models still used in current practice.
- Do not exclude older foundational evidence solely by age if a later guideline still relies on it.
- For rapidly evolving self-report/wearable methodology, prefer current syntheses where they materially update interpretation.

### 5.4 Search families

#### Subjective readiness

Representative query concepts:

```text
athlete AND (self-report OR wellness OR readiness) AND
(fatigue OR soreness OR stress OR motivation OR sleep) AND
(systematic review OR monitoring OR psychometric OR validity)
```

```text
athlete self-report measure AND training response
Hooper index athlete monitoring
RESTQ-Sport validity athlete
Acute Recovery and Stress Scale athlete
Short Recovery and Stress Scale athlete
single-item wellness athlete validity
```

Key questions:

- Are subjective self-reports responsive to acute/chronic training stress?
- Which dimensions show useful construct validity or sensitivity?
- Are single-item 1–10 ratings valid enough for repeated practical monitoring?
- Is within-athlete trend more defensible than population-absolute cut-points?
- Are fatigue, soreness, stress, motivation, sleep quality and readiness interchangeable enough to average equally?
- Is any `>5`, `>7`, `>=8`, `<=3`, etc. action threshold externally validated?
- Does evidence support using subjective deterioration to reduce training intensity/volume, or only to trigger review/context gathering?

#### Tissue-response / pain-guided loading

Representative query concepts:

```text
sports injury rehabilitation AND symptom-guided loading
pain monitoring model AND return to sport
next-day pain response AND exercise progression
24 hour response AND tendon rehabilitation
criteria based return to sport AND pain
```

Key questions:

- In which conditions is monitored loading with tolerable symptoms supported?
- Is next-day symptom response used as a load-progression criterion, and for which tissues?
- Do `mild/moderate/severe` labels have validated cross-condition semantics?
- Is "worst signal wins" a validated clinical rule or a conservative product strategy?
- What red-flag or functional findings should be out of scope for an automated training recommender and instead trigger clinical evaluation?

#### Region-to-restriction mapping

Search separately by region/condition cluster rather than one global query:

- knee: ligament/patellofemoral/tendon/other common athletic presentations;
- Achilles/ankle/calf: tendinopathy, ankle sprain/instability, calf muscle injury;
- hamstring/quadriceps/adductor/hip: muscle injury and groin/hip return-to-sport guidance;
- lumbar: athletic low-back pain and loading guidance;
- shoulder/elbow/wrist: upper-extremity sports rehabilitation/return-to-sport guidance.

Key questions:

- Does the guideline recommend avoiding a load class, or graded exposure to it?
- Is the recommendation diagnosis-specific rather than region-specific?
- Is impact, heavy loading, spinal loading, or overhead loading inherently contraindicated, or conditionally progressed?
- What functional criteria matter before return?

#### Generic pain envelope

Representative query concepts:

```text
athlete pain training modification return to sport consensus
musculoskeletal pain exercise continue activity guideline athlete
pain alone return to sport decision criterion
```

Key questions:

- Is pain presence alone sufficient to mandate rest/Mobility-only behavior?
- Does the evidence distinguish pain intensity, irritability, function, swelling, instability, neurological symptoms, traumatic mechanism, and location?
- Is a generic ban on Running defensible when pain could be in the wrist/shoulder?
- Should the current boolean `painFlag` remain only a fail-closed signal until structured context is available?

---

## 6. Initial source reconnaissance — search anchors, not final claim decisions

These sources are useful starting anchors for the implementation review. Their presence in this plan does **not** pre-approve a claim or coverage migration.

### 6.1 Athlete self-report monitoring

**Saw, Main & Gastin, 2016 — systematic review**
PMID `26423706`; PMCID `PMC4789708`; DOI `10.1136/bjsports-2015-094758`.

Useful because the review directly compares athlete subjective and objective monitoring measures and reports that subjective well-being measures were responsive to acute and chronic training load. It supports researching subjective monitoring as legitimate evidence, but it does not by itself validate the app's exact composite or cut-points.

**Saw et al., 2017 — athlete self-report measure implementation/psychometric considerations**
PMID `27834546`; DOI `10.1123/ijspp.2016-0395`.

Useful for the measurement-quality boundary: construct validity, reliability, responsiveness, administration consistency and practical implementation must be considered before treating a score as decision authority.

**Duignan et al., 2020 — single-item team-sport wellbeing systematic review**
PMID `32991706`; PMCID `PMC7534939`; DOI `10.4085/1062-6050-0528.19`.

Required for SEP-A because it directly reviews the kind of single-item wellness components used by the app. It found heterogeneous instruments, scoring methods and associations with training load, and did not establish clinically meaningful traffic-light action cut-points. Its team-sport population also limits direct transfer to a general multisport product.

**Jeffries et al., 2020 — COSMIN review of athlete-reported outcome measures**
PMID `32957081`; DOI `10.1123/ijspp.2020-0386`.

Required for the measurement-validity boundary. The review found that commonly used single-item athlete-reported measures lacked adequate validation evidence, while even multi-item measures had content-validity and measurement-error limitations. This is direct evidence against treating the app's bespoke six-item input surface or five-item equal-weight composite as a validated instrument.

**Campbell et al., 2021 — predictive capacity of wellness measures**
PMID `33404378`; DOI `10.1080/02640414.2020.1870303`.

Useful contested evidence: across a large multisport observation set, wellness items explained little variance in load measures. It does not prove that wellness is useless, because training load is not the same outcome as readiness, safety or successful session completion, but it prevents the pack from presenting responsiveness findings as settled predictive action authority.

The implementation review must also reconcile the more recent item-specific studies already summarized in ADR-0020 and verify whether a newer guideline or systematic review supersedes these anchors. The PR #314 evidence note is prior reconnaissance, not a completed SEP-A appraisal; its PMID `32991706` attribution must be corrected from Jeffries to Duignan when that note is next touched.

### 6.2 Return to sport as risk management

**Ardern et al., 2016 — Bern return-to-sport consensus**
PMID `27226389`; DOI `10.1136/bjsports-2016-096278`.

Useful for the broad architecture: return to sport is a continuum and a multifactorial risk-management decision rather than a single end-stage pain or time threshold. The consensus itself states that research supporting many return-to-sport decisions is limited, so it should not be inflated into numeric product cut-points.

**Panther Symposium ACL Return-to-Sport Consensus, 2020**
PMID `32647735`.

Useful as a condition-specific example of criteria-based progression incorporating physical examination, functional testing, psychological readiness and contextual factors instead of purely time-based clearance. It must not be generalized to all body regions as an exact rule.

### 6.3 Symptom-guided loading

**Silbernagel et al., 2007 — Achilles tendinopathy RCT**
PMID `17307888`; DOI `10.1177/0363546506298279`.

Useful because continued tendon-loading activity under a pain-monitoring model was prospectively evaluated during Achilles rehabilitation. It is strong evidence against a simplistic universal assumption that any musculoskeletal pain requires complete avoidance of the provoking modality. It remains Achilles-tendinopathy-specific and cannot validate the app's generic pain envelope or every region mapping.

### 6.4 Region-specific guidance

**Martin et al., 2021 — lateral ankle sprain clinical practice guideline**
PMID `33789434`; DOI `10.2519/jospt.2021.0302`.

Useful as a model for how a region-specific restriction should be evaluated: diagnosis/context, impairments, interventions and return criteria are more specific than the app's single `ankle` label.

The final evidence pack should add the best current guideline/synthesis sources for the remaining region clusters before making coverage decisions.

---

## 7. Workstream SEP-A — Subjective readiness

### 7.1 Research target

Determine what the literature supports about repeated athlete self-report monitoring and what it does **not** support about the current absolute action thresholds.

The primary risk is false precision: a strong evidence base for subjective monitoring could be misrepresented as validation of a specific arithmetic average and a series of hard cut-points.

The review must answer four questions separately:

1. **Measurement validity:** are the app's individual 1-10 items sufficiently defined, repeatable and responsive for repeated use?
2. **Composite validity:** is equal weighting of fatigue, soreness, inverted readiness, inverted sleep quality and inverted motivation defensible, while stress remains outside that average?
3. **Action validity:** does acting on adverse scores improve safety, adherence, health or performance compared with monitoring/context gathering alone?
4. **Threshold validity:** has any source prospectively validated the app's exact operators and cut-points (`>5`, `>7`, `>8`, `>6`, `>=6`, `>=8`, `<=3`, `<=4`, `>=9`) for the same action and population?

The analysis must include a reproducible search log: databases, search date, exact queries, result counts, duplicate handling, full-text inclusion/exclusion reasons and the final selected-source set. A narrative claim that a "full review" was performed is not sufficient.

### 7.2 Candidate claim slots

Final wording must be written only after appraisal. Candidate IDs/namespaces to reserve conceptually:

#### Scientific / clinical boundary candidates

- `readiness.subjective.self_report_contextual_monitoring`
  - possible boundary: repeated subjective athlete-reported well-being can contribute useful information about training response/recovery when interpreted longitudinally and contextually.
- `readiness.subjective.measurement_quality_context`
  - possible boundary: interpretation depends on construct validity, reliability/responsiveness and consistent administration; values from different instruments/scales are not automatically interchangeable.
- `readiness.subjective.multidimensional_not_single_construct`
  - possible boundary: fatigue, soreness, stress, motivation, sleep quality and perceived readiness represent related but non-identical constructs; evidence for one does not automatically justify equal weighting in a composite.
- `readiness.subjective.absolute_cutpoint_limits`
  - a negative/boundary claim if supported: literature does not establish universal athlete-independent 1–10 cut-points equivalent to the product's current `modify/recover` thresholds.

#### Product-policy claim

- `policy.readiness.subjective_mode_thresholds_v1`

This claim should record the exact live product behavior, including:

- five-item average construction;
- `>5` / `>7` transitions;
- independent soreness/fatigue thresholds, preserving every strict (`>`) versus inclusive (`>=`/`<=`) boundary;
- stress/readiness/fatigue combinations;
- terminal readiness overrides that are explicitly outside the claim, including `alreadyTrainedToday` and objective `today_training`.

Its scientific certainty should be `not_applicable` if it remains product calibration. It should explicitly cite the scientific boundary claims as context rather than pretending the numbers were validated externally.

Do not include `painFlag`, illness interpretation, subjective drift or generic injury behavior in this product claim. Their proximity in `evaluateReadinessAndSafetyEnvelope` does not make them one epistemic family.

### 7.3 Required conclusions in the analysis document

The final analysis must contain separate sections for:

- **supported** — what athlete self-report evidence can legitimately justify;
- **contested / heterogeneous** — constructs/instruments with inconsistent or population-dependent evidence;
- **unsupported** — exact current thresholds or equal-weight arithmetic if no direct validation exists;
- **product decision** — why the current rule is retained unchanged in the evidence PR, if retained;
- **calibration debt** — what athlete-outcome data would be required to tune thresholds later.

### 7.4 Calibration follow-up design

Literature is unlikely to determine the product's exact `3/4/5/6/7/8/9` cut-points. If so, register them honestly as product policy and create a later calibration design based on observed outcomes rather than citation count.

Candidate calibration outcomes:

- whether the planned session was started/completed;
- user-reported session quality / inability to complete target;
- next-day adverse subjective change;
- tissue-response worsening where relevant;
- unexpected switch to rest/recovery;
- acute illness/injury interruption;
- clinician/user override of recommendation;
- false-conservative burden: repeated unnecessary recovery recommendations under stable outcomes.

Do not optimize solely for "more training completed". Safety-sensitive thresholds require asymmetric error costs.

### 7.5 Implementation files — expected

After evidence review:

- add `app/src/knowledge/subjectiveReadinessKnowledge.ts`;
- add `app/src/knowledge/subjectiveReadinessKnowledge.test.ts`;
- add `app/src/knowledge/subjectiveReadinessPolicyAlignment.test.ts`;
- aggregate sources/claims in `sportsKnowledgeRegistry.ts`;
- add IDs to the canonical `KNOWLEDGE_CLAIM_IDS` surface following current registry convention;
- update `knowledgeCoverage.ts` for `readiness.subjective_mode_thresholds`;
- update `knowledgeCoverage.test.ts`;
- add the evidence analysis document under `docs/analysis/`;
- extend the existing SKR1 runtime lineage attribution for the subjective policy without changing the v4 audit schema.

### 7.6 Policy-alignment test requirements

The test must fail if registered `policy.readiness.subjective_mode_thresholds_v1` stops matching executable policy.

Do not merely test that the claim exists. Add a normalized policy descriptor in the SEP-A knowledge module and drive executable boundary cases against `rules.ts` `evaluateReadinessAndSafetyEnvelope`. The table must cover the exact equality boundary on both sides of every strict/inclusive operator and isolate each severe/acute combination.

Do not refactor the inline thresholds into named constants during SEP-A. The current policy-drift guard only exempts comment/whitespace-only changes in `rules.ts`; an executable refactor would require a global `POLICY_VERSION` change even if intended to be behavior-identical. If robust alignment cannot be achieved through the descriptor-driven boundary matrix, stop and move the refactor to a separately reviewed provenance/policy PR.

The alignment suite must also prove scope separation:

- `stress` participates in independent combinations but not the five-item average;
- `painFlag` behavior remains unchanged but is absent from the SEP-A product claim;
- default-off subjective drift neither changes these boundaries nor receives SEP-A threshold authority;
- a provisional safety recommendation created without the ordinary evaluator receives no SEP-A lineage.

---

## 8. Workstream SEP-B — Injury and pain safety

**Execution note:** This section preserves the original decomposition and review
history. The focused
[`SEP-B implementation plan`](./2026-09-01-safety-evidence-pack-injury-pain-sep-b.md)
corrects the combined pain/injury/illness flag semantics, separates product policy
from safety invariants, removes aggregate-region double counting, and defines the
behavior-equivalence gate for runtime lineage.

### 8.1 Split `injury.tissue_response_severity` into evidence boundary + product translation

The pack should evaluate two layers:

#### Layer A — symptom/tissue response as monitoring information

Potential scientific claims may cover, where evidence supports them:

- symptom response during loading can be clinically relevant;
- immediate and delayed/next-day response can inform progression in selected rehabilitation contexts;
- graded loading may be appropriate in selected conditions even when symptoms are not zero.

Each claim must specify the tissue/condition scope. A tendon-loading study cannot become a universal muscle/ligament/joint claim.

#### Layer B — exact product severity translation

Register the live translation as something like:

- `policy.injury.tissue_response_severity_v1`.

It should state that `normal/mild/moderate/severe` are product semantic categories and that the exact `monitor/limit/exclude` mapping is conservative product policy unless directly validated.

#### Preserve-or-tighten rule

Review separately whether `preserve-or-tighten` should remain:

- a product safety invariant (`not_applicable` to scientific certainty), or
- part of a clinical claim.

Default recommendation for implementation planning: keep it as a safety invariant unless strong evidence directly establishes the same state machine. The product should not need a paper to justify "today's inferred good state does not silently revoke a standing explicit injury restriction."

### 8.2 Refactor `injury.region_restriction_mapping` coverage into auditable sub-families

The existing single family bundles clinically heterogeneous regions. The evidence pack should split the **coverage inventory**, without changing executable behavior, into at least:

1. `injury.region_restriction_lower_leg_impact`
   - knee / Achilles / ankle / calf -> impact and Running restrictions;
2. `injury.region_restriction_lower_limb_strength`
   - hamstring / quadriceps / adductor-groin / hip -> heavy lower-body and strength-category restrictions;
3. `injury.region_restriction_lumbar_loading`
   - lower back -> heavy spinal/loading restrictions;
4. `injury.region_restriction_upper_extremity_loading`
   - shoulder / elbow / wrist -> overhead / upper-strength restrictions.

The old stable audit ID should not simply disappear without migration documentation. Options:

- keep `injury.region_restriction_mapping` as a parent/umbrella item marked `partial`, referencing child families; or
- replace it with explicit child rows and document the audit-ID migration in the evidence analysis.

Preferred: retain the parent as an umbrella until downstream reports/tests are migrated, then deprecate it deliberately in a later inventory-maintenance PR.

### 8.3 Region mapping evidence rule

A child family may become `covered` only if its current epistemic status is explicit and honest.

Examples:

- scientific evidence may support that a diagnosed condition benefits from graded exposure rather than blanket avoidance;
- the product may still choose a conservative region-only restriction because diagnosis is unavailable;
- in that case the exact mapping is a **product safety policy**, not a scientific contraindication.

Coverage can be complete when the scientific boundary and exact product policy are both explicit. It must remain `partial` when a material sub-surface has no adequate rationale or when the region grouping itself is too heterogeneous to defend.

### 8.4 Generic pain envelope

This is the highest-risk semantic mismatch in the current bundle because a boolean pain flag has no region.

The review must test these propositions independently:

1. pain is a relevant safety signal;
2. pain alone should cap all training at Mobility;
3. pain alone should restrict Running regardless of pain location;
4. structured injury/tissue context should take precedence over the generic boolean when available.

Possible evidence-pack outcomes:

#### Outcome A — retain as conservative product invariant

If no direct evidence validates the exact mapping but the product intentionally treats missing pain context as fail-closed, register:

- a scientific/clinical boundary claim that pain requires context and is not a diagnosis;
- `policy.injury.generic_pain_envelope_v1` documenting the exact fail-closed product action.

Coverage may become `covered` only if the team explicitly accepts that conservative product policy and documents its usability/false-positive cost.

#### Outcome B — leave `partial` and open remediation

If the review concludes that `painFlag -> restrict Running + Mobility-only` is too anatomically nonspecific to defend even as a generic product mapping, leave the family `partial/uncovered` and create a follow-up behavior PR.

Likely remediation designs to evaluate later, not in this evidence pack:

- require pain location/severity before modality-specific restriction;
- route generic pain into the structured `RegionTissueResponse` / `InjuryConstraint` model;
- make unknown-location pain trigger a clarification/safety check rather than assume Running is the hazardous modality;
- preserve fail-closed behavior for red flags or severe functional limitation;
- distinguish general soreness/DOMS from focal injury pain.

### 8.5 Clinical escalation / red-flag boundary

The adaptive training recommender should not become an automated diagnostic system.

The evidence review should define a narrow boundary for situations where the product should defer to medical evaluation rather than infer a training restriction. Research candidate categories include:

- acute traumatic mechanism with inability to bear weight/use the limb;
- marked swelling/deformity/instability;
- neurological symptoms;
- systemic illness/red-flag symptoms;
- rapidly worsening pain or function;
- persistent symptoms beyond expected recovery without improvement.

Do not encode these into behavior during the evidence PR unless a separate safety feature scope is approved. The evidence document should simply distinguish "training-policy evidence" from "needs clinical assessment".

### 8.6 Candidate claim slots

Final IDs/statements should be chosen after appraisal.

#### Scientific / clinical boundary candidates

- `injury.return_to_sport.criteria_based_risk_management`
- `injury.loading.symptom_guided_condition_specific`
- `injury.tissue_response.temporal_monitoring_context`
- `injury.pain.requires_location_function_context`
- one or more condition/region-specific loading boundary claims where evidence is direct enough.

#### Product policy candidates

- `policy.injury.tissue_response_severity_v1`
- `policy.injury.region_restriction_lower_leg_impact_v1`
- `policy.injury.region_restriction_lower_limb_strength_v1`
- `policy.injury.region_restriction_lumbar_loading_v1`
- `policy.injury.region_restriction_upper_extremity_loading_v1`
- `policy.injury.generic_pain_envelope_v1`

Splitting product claims is preferred over one giant region claim because future evidence/version changes can then affect one mapping without versioning unrelated regions.

### 8.7 Implementation files — expected

- add `app/src/knowledge/injuryPainKnowledge.ts`;
- add `app/src/knowledge/injuryPainKnowledge.test.ts`;
- add `app/src/knowledge/injuryPainPolicyAlignment.test.ts`;
- aggregate in `sportsKnowledgeRegistry.ts`;
- update `knowledgeCoverage.ts` and coverage tests;
- add `docs/analysis/<date>-evidence-pack-subjective-readiness-injury-pain.md` or two linked analysis documents if the source volume becomes unwieldy;
- extend the existing SKR1 material-use lineage for tissue/region/pain policies.

---

## 9. Claim maturity, certainty and recommendation-authority rules

### 9.1 Scientific claims

Use existing registry maturity/status/certainty fields. For high-safety claims:

- do not assign `high` certainty merely because the source is a guideline;
- reduce certainty for indirect population/condition transfer;
- make recommendation authority narrower than evidence certainty when the source only supports monitoring/association;
- explicitly record contradictory findings or limited external validity.

### 9.2 Product-policy claims

Exact product thresholds/mappings should normally be:

- maturity: heuristic/product-policy according to current registry conventions;
- evidence certainty: `not_applicable` for the exact scalar/mapping when not externally validated;
- status: active only while executable behavior matches;
- limitations: explicitly state lack of universal clinical validation.

### 9.3 Negative/boundary claims are valuable

It is acceptable and useful to register a claim whose purpose is to prevent overreach, for example:

- body-region label alone is insufficient to infer diagnosis;
- subjective monitoring evidence does not establish universal 1–10 action thresholds;
- pain presence alone does not identify tissue pathology;
- evidence for a symptom-guided loading model is condition-specific.

These claims prevent future code from inheriting scientific authority it does not have.

---

## 10. Runtime lineage integration on the existing SKR1 contract

PR #312 is merged. Recommendation-level code now carries stable claim IDs and freezes `{claimId, version}` at the audit boundary. The Safety Evidence Pack must use that mechanism rather than invent a second provenance path.

### 10.1 Subjective readiness attribution

Extend `knowledgeLineage.ts` `readinessKnowledgeRefs` rather than importing registry resolution directly into `rules.ts`.

Suggested shape:

```ts
subjectiveReadinessKnowledgeRefs(readiness)
```

or extend:

```ts
readinessKnowledgeRefs(readiness, context)
```

with the newly registered subjective scientific-boundary and product-policy IDs.

Materiality rule:

- include the SEP-A scientific boundary claims and `policy.readiness.subjective_mode_thresholds_v1` whenever the ordinary production readiness classifier evaluates the normalized subjective vector;
- use "evaluated with applicable normalized input", the existing SKR1 meaning, rather than claiming that a ref appears only when the family counterfactually changes the final mode;
- do not add unrelated injury claims merely because `soreness` is present;
- do not attach SEP-A refs to `safetyCheckin.ts` `createProvisionalSafetyRecommendation`, which bypasses the ordinary evaluator and is not persisted as an engine-generated decision;
- do not persist forecast-only lineage: the planner may evaluate synthetic readiness scenarios, but architecture guarantees that nothing beyond today is persisted.

The production boundary needs an explicit test for partial check-ins. `safetyCheckin.ts` permits an ordinary recommendation once the three safety booleans and either fatigue or soreness are supplied; `adapters.ts` then maps any unanswered 1-10 dimensions to neutral `5`. The lineage helper sees only that normalized numeric vector. SEP-A must therefore:

- document neutral-default normalization in the product-policy claim and analysis;
- include the product-policy ref when that normalized classifier runs, even if some components were defaults;
- avoid wording any scientific claim as proof that every component was actually measured on that day;
- record a remediation/calibration question if review concludes that a five-item composite with defaulted components should not authorize an ordinary recommendation.

Changing minimum-safety completeness or neutral-default behavior is a recommendation behavior change and belongs in SEP-C, not SEP-A.

### 10.2 Injury/tissue attribution

Do not use ambient/global collectors. Keep the engine pure.

Preferred design options:

1. return `{restrictions, knowledgeRefs}` from a new pure wrapper around `resolveInjuryRestrictions`; or
2. add a pure helper in `knowledgeLineage.ts` that derives refs from the same structured injury inputs and the restrictions actually applied.

Include a product mapping claim only when the corresponding restriction surface is active.

Examples:

- no injury/tissue context -> no injury mapping lineage;
- active knee `limit` that adds `avoid_high_impact` -> include lower-leg impact mapping policy + directly applicable clinical boundary claims;
- shoulder injury -> do not include Achilles/ankle claims;
- tissue-response escalation from `mild/moderate/severe` -> include tissue-response policy claim;
- standing explicit restriction with no tissue-response input -> do not claim the tissue-response severity policy was used.

### 10.3 Generic pain attribution

When `painFlag` activates the generic pain envelope, include exactly the claims supporting/documenting that rule. Do not include all region-specific injury claims because the pain location is unknown.

### 10.4 Version semantics

- claim versions freeze at `buildRecommendationAudit`, not inside decision code;
- adding a new scientific source without changing claim meaning does not automatically require a new policy version;
- materially changing a claim statement/authority requires a claim version increment under ADR-0033;
- changing executable recommendation behavior requires a separate `POLICY_VERSION` decision;
- additive refs inside the existing v4 lineage schema are identified by their own claim IDs/versions and do not by themselves require a `POLICY_VERSION` bump when no decision-affecting file or executable behavior changes;
- any need to touch `rules.ts`, `adapters.ts`, or another file guarded by `check-policy-drift.mjs` reopens the global version decision and should be split from SEP-A unless it is comment-only.

---

## 11. Coverage migration rules

### 11.1 `readiness.subjective_mode_thresholds`

May become `covered` only when:

- scientific boundary for subjective monitoring is explicit;
- exact product thresholds are registered separately;
- limitations say that exact cut-points are not externally validated unless the review genuinely finds such validation;
- policy-alignment tests prove claim ↔ code consistency.

If the high-safety threshold rationale remains too weak, mark `partial` and retain P0/P1 follow-up rather than using the presence of a product claim alone to close debt.

For SEP-A the default migration decision is `partial / P0` until the review explicitly accepts the safety rationale for both the exact threshold table and neutral-default participation. A product-policy claim proves auditability, not adequacy. Moving directly to `covered` requires a written reviewer decision in the evidence analysis; silence or the mere existence of tests is not acceptance.

### 11.2 `injury.tissue_response_severity`

Likely outcomes:

- scientific monitoring layer can be partially/conditionally supported;
- exact cross-tissue severity mapping remains product policy;
- preserve-or-tighten may be `not_applicable` scientific certainty as an engineering safety invariant.

Coverage should reflect whether the product's semantic severity labels have a sufficiently documented safe boundary.

### 11.3 `injury.region_restriction_mapping`

Do not mark the parent `covered` merely because one region has a good CPG.

Track each child family separately. Parent coverage is the minimum/aggregate of its material subfamilies until the parent row is retired.

### 11.4 `injury.pain_envelope_mapping`

This family should receive special review because the exact rule is anatomically nonspecific.

If retained as an intentional fail-closed product policy, coverage rationale must explicitly acknowledge that the rule is conservative and not a universal clinical contraindication. If that rationale is not accepted, keep the family open and create behavior remediation.

---

## 12. Policy-alignment and regression test plan

### 12.1 Registry tests

Test:

- unique claim/source IDs;
- valid external identifiers;
- active status and versions;
- no duplicate PMID/DOI records across modules;
- limitations present for high-safety claims;
- product-policy claims use appropriate scientific certainty.

### 12.2 Subjective policy-alignment tests

Assert the registered policy representation matches:

- five-item composite dimensions;
- inversion direction for readiness/sleep quality/motivation;
- `>5` and `>7` composite thresholds;
- soreness/fatigue independent thresholds;
- severe distress combinations;
- acute modify combinations;
- strict-versus-inclusive equality boundaries for every operator;
- neutral-default behavior for a minimum-safety but otherwise partial check-in;
- explicit exclusion of pain/illness and default-off subjective drift from the registered SEP-A policy surface.

### 12.3 Injury policy-alignment tests

Assert:

- `normal/mild/moderate/severe` ordering;
- current severity translation;
- preserve-or-tighten monotonicity;
- each region cluster's exact guardrails/modalities/categories;
- stronger `exclude` behavior;
- expired injury handling remains unchanged;
- explicit restricted modalities remain additive.

### 12.4 Generic pain-envelope tests

Assert the evidence pack does not accidentally change:

- `painFlag` clinical-envelope activation;
- Running restriction;
- Mobility tier cap.

If the evidence review recommends changing these, the test should document current behavior and the separate remediation PR should intentionally update it with a policy-version change.

### 12.5 Runtime lineage tests

Add tests proving:

- subjective claim refs are deterministic and deduplicated;
- ordinary normalized subjective classification receives SEP-A refs, including the documented partial-input/default case;
- provisional safety fallback receives no SEP-A refs and no persisted audit;
- pain/illness behavior does not acquire SEP-A authority merely because it is evaluated nearby;
- forecast-only refs are never persisted as a future-day audit;
- tissue severity refs appear only when tissue response is present/used;
- region-specific refs match the active region cluster only;
- generic pain does not claim region-specific evidence;
- inactive/expired injuries do not contribute region lineage;
- version snapshotting remains handled centrally by SKR1;
- unknown/non-active safety claims fail closed before persistence.

### 12.6 Behavior-preservation gate

For the evidence PRs:

- all existing engine/unit/simulation/judge tests must remain semantically unchanged;
- no changes to recommendation distributions should be accepted as an incidental effect of evidence migration;
- if a refactor is needed for alignment/provenance, compare decision outputs on deterministic corpora before/after;
- any non-zero semantic decision diff must block the evidence PR and be moved to remediation scope.

---

## 13. Recommended implementation PR sequence

### PR SEP-A — Subjective readiness evidence and lineage

**Behavior-preserving.**

Deliverables:

- full subjective-readiness literature review;
- selected sources;
- scientific boundary claims;
- exact product-policy claim;
- registry module/tests;
- policy-alignment test;
- coverage migration decision;
- runtime lineage on the existing SKR1 helper;
- analysis doc with supported/contested/unsupported sections.

Reason to land first: the family is one coherent readiness classifier and has fewer condition-specific evidence branches than injury mapping.

### PR SEP-B — Injury/pain evidence, mapping decomposition and lineage

**Behavior-preserving.**

Deliverables:

- return-to-sport/load-management review;
- symptom-guided loading review;
- body-region CPG/guideline matrix;
- tissue severity product claim;
- split region product claims;
- generic pain-envelope product claim or explicit remaining gap;
- coverage parent/child migration;
- runtime lineage;
- analysis doc.

Reason to split from SEP-A: clinical directness and region heterogeneity make this a substantially larger review and a higher-risk code-provenance surface.

### PR SEP-C1+ — Behavior remediation only if evidence justifies it

Possible independent PRs:

- replace generic pain->Running/Mobility mapping with structured pain context (**SEP-C1 — PR #319 merged**);
- recalibrate subjective thresholds (**SEP-C2 — implemented & verified**);
- change tissue severity semantics & lumbar guardrails (**SEP-C3 — implemented & verified**);
- add clinical escalation/red-flag flow (**SEP-C4 — implemented & verified**).

Each behavior PR requires:

- explicit old/new policy table;
- `POLICY_VERSION` decision;
- unit/property tests;
- deterministic simulation comparison;
- safety regression corpus;
- UX impact review;
- recommendation-audit lineage update if different claims become materially consumed.

Do not combine all remediation into one large safety rewrite.

---

## 14. Expected file-level implementation map

### New files

```text
app/src/knowledge/subjectiveReadinessKnowledge.ts
app/src/knowledge/subjectiveReadinessKnowledge.test.ts
app/src/knowledge/subjectiveReadinessPolicyAlignment.test.ts

app/src/knowledge/injuryPainKnowledge.ts
app/src/knowledge/injuryPainKnowledge.test.ts
app/src/knowledge/injuryPainPolicyAlignment.test.ts

docs/analysis/<date>-evidence-pack-subjective-readiness.md
docs/analysis/<date>-evidence-pack-injury-pain.md
```

A single combined analysis doc is acceptable if it stays readable, but separate analysis files are preferred because the evidence methods/populations are different.

For the next SEP-A PR, only the three subjective-readiness files and the subjective-readiness analysis document are in scope. The injury/pain files are reserved for SEP-B.

### Existing files likely changed

```text
app/src/knowledge/sportsKnowledgeRegistry.ts
app/src/knowledge/knowledgeCoverage.ts
app/src/knowledge/knowledgeCoverage.test.ts
app/src/engine/knowledgeLineage.ts
app/src/engine/knowledgeLineage.test.ts
app/src/engine/injuryPolicy.ts              # only behavior-identical provenance/refactor if necessary
docs/plans/sports-knowledge-registry-follow-up.md
```

`rules.ts` and `adapters.ts` are explicitly out of the SEP-A file map. No Firestore schema change is required; new claims flow through the existing v4 `{claimId, version}` lineage mechanism.

---

## 15. Review checklist for every candidate claim

Before an active claim is merged, reviewer must be able to answer yes to all applicable questions:

- Is the statement atomic?
- Is the population/condition scope explicit?
- Does at least one selected source directly support the statement?
- Are indirect sources labeled as indirect?
- Is a guideline recommendation being distinguished from outcome evidence?
- Is a monitoring association being distinguished from a treatment/action rule?
- Are numeric thresholds in the source actually the same thresholds as the product?
- If not, is the product scalar/mapping registered separately as heuristic policy?
- Are contested results documented?
- Are limitations specific enough to prevent adjacent use?
- Would a future engineer know that an Achilles result cannot justify a hamstring or knee rule?
- Would a future engineer know that athlete self-report usefulness does not validate the current five-item equal-weight composite?
- Is the recommendation authority no stronger than the evidence permits?

---

## 16. Risk register

### Risk R1 — false clinical authority from broad consensus

**Failure mode:** a general return-to-sport consensus is cited for an exact body-region restriction.

**Mitigation:** require directness field and condition-specific supporting source for each scientific region claim; otherwise classify exact mapping as product policy.

### Risk R2 — coverage inflation

**Failure mode:** all four P0 families are marked covered because policy claims were added.

**Mitigation:** high-safety coverage requires an explicit scientific boundary, product rationale, limitations, and alignment test. `partial` is an acceptable outcome.

### Risk R3 — universalization of pain-monitoring models

**Failure mode:** Achilles/tendon evidence becomes a generic pain-tolerance rule.

**Mitigation:** condition/tissue applicability in claim, limitations and tests; no cross-region reuse without explicit evidence.

### Risk R4 — self-report threshold overfitting

**Failure mode:** literature-supported usefulness of subjective monitoring is treated as proof of `>5/>7` thresholds.

**Mitigation:** separate scientific monitoring claims from `policy.readiness.subjective_mode_thresholds_v1`; create athlete-outcome calibration follow-up.

### Risk R5 — behavior change hidden inside evidence migration

**Failure mode:** "cleaning up" inline constants or injury routing alters recommendation behavior.

**Mitigation:** deterministic decision-diff gate; move any semantic change to SEP-C.

### Risk R6 — duplicated provenance architecture

**Failure mode:** safety code starts resolving claim versions directly.

**Mitigation:** reuse SKR1 stable IDs in runtime and central version snapshotting at audit boundary.

### Risk R7 — generic pain remains a permanent catch-all

**Failure mode:** conservative boolean rule is documented and then never revisited despite poor specificity.

**Mitigation:** if retained, create explicit calibration/UX debt with review criteria and telemetry needs; do not call it a universal clinical rule.

---

## 17. Acceptance criteria for the implementation PRs

The next SEP-A PR applies these criteria only to `readiness.subjective_mode_thresholds`. It must not alter the other three safety-pack coverage rows or add injury/pain claim lineage. The umbrella pack reaches completion only after SEP-B later satisfies the remaining criteria.

### Evidence quality

- [ ] Search/appraisal method documented.
- [ ] Guidelines/systematic reviews prioritized where applicable.
- [ ] Landmark primary studies included only where they answer a specific gap.
- [ ] Stable source identifiers captured.
- [ ] Supported, contested and unsupported conclusions separated.
- [ ] Directness and generalizability limitations explicit.

### Registry quality

- [ ] Atomic claim IDs and versions.
- [ ] Product-policy claims separated from scientific claims.
- [ ] No claim implies a diagnosis from body region or pain alone.
- [ ] No exact numeric threshold is labeled scientific without direct validation.
- [ ] Global registry validation passes.

### Coverage quality

- [ ] All four current P0 families reviewed.
- [ ] Region mapping decomposed or a written reason explains why not.
- [ ] Coverage states reflect evidence honestly.
- [ ] Any remaining `partial/uncovered` debt retains priority and rationale.

### Runtime lineage

- [ ] Subjective lineage only for subjective readiness policy participation.
- [ ] Tissue-response lineage only when tissue response is used.
- [ ] Region lineage is region-specific.
- [ ] Generic pain lineage never claims a specific region.
- [ ] `{claimId, version}` is still frozen centrally.

### Behavior preservation

- [ ] No threshold changed.
- [ ] No restriction mapping changed.
- [ ] No mode/candidate output changed.
- [ ] Existing simulation/judge gates show no semantic regression attributable to the evidence PR.
- [ ] Any recommended policy changes are explicitly deferred to SEP-C.

---

## 18. Implementation checklist

### Phase 0 — reconcile repository state

- [x] Create the SEP-A worktree from current `main`, which already contains PR #312.
- [x] Re-run `ENGINE_KNOWLEDGE_COVERAGE`: 47 families; 15 covered, 1 partial, 26 uncovered, 5 not applicable; the four safety-pack families remain the four high-safety uncovered rows.
- [x] Re-read live `rules.ts`, `knowledgeLineage.ts`, `adapters.ts`, `safetyCheckin.ts`, ADR-0020 and ADR-0032; the scope corrections are recorded in section 1.1.

### Phase 1 — subjective readiness research

- [x] Define atomic questions before searching.
- [x] Review athlete self-report syntheses.
- [x] Review psychometric/measurement guidance.
- [x] Reconcile Duignan 2020, Jeffries 2020, Campbell 2021 and item-specific athlete evidence.
- [x] Review decision-guidance evidence and record its limitation.
- [x] Search specifically for validated absolute cut-points matching live product thresholds.
- [x] Record the negative result: no direct threshold validation found in the selected review scope.
- [x] Draft scientific boundary claims.
- [x] Draft exact product-policy claim.
- [x] Include partial-check-in neutral-default semantics in the product-policy appraisal.

### Phase 2 — injury/pain research (SEP-B; not part of the SEP-A PR)

- [ ] Review return-to-sport consensus/guidelines.
- [ ] Review symptom-guided loading/pain-monitoring evidence by tissue/condition.
- [ ] Review region-specific CPGs/guidelines for all current mappings.
- [ ] Identify where region-only abstraction loses clinically material information.
- [ ] Review generic pain as a decision signal separately from structured injury data.
- [ ] Document clinical-escalation boundary without implementing diagnosis.

### Phase 3 — claim review

- [ ] Run claim directness checklist.
- [ ] Assign certainty/authority separately.
- [ ] Add limitations preventing cross-condition reuse.
- [ ] Human review every P0/high-safety claim before `active` status.

### Phase 4 — registry and coverage implementation

- [x] Add the SEP-A domain module and sources.
- [x] Aggregate registry.
- [x] Add descriptor-driven SEP-A policy-alignment tests without editing `rules.ts`.
- [x] Update `readiness.subjective_mode_thresholds` with the explicit **partial / P0** reviewer decision.
- [x] Update the SEP-A analysis document and roadmap.
- [ ] Leave region coverage splitting to SEP-B.

### Phase 5 — runtime lineage

- [x] Extend the existing `readinessKnowledgeRefs` path.
- [x] Add materiality tests.
- [x] Verify v4 audit snapshots exact claim versions through the existing SKR1 boundary.
- [x] Verify no unrelated injury/pain claim leakage.

### Phase 6 — validation

- [x] Typecheck/lint.
- [x] Sports Knowledge Registry validation.
- [x] Knowledge Coverage validation.
- [x] Unit tests.
- [x] Policy-alignment tests.
- [x] Policy-drift guard.
- [x] Firestore/replay tests affected by lineage.
- [ ] Simulation semantic diff = no behavior change.
- [x] Deterministic judge gates = no evidence-migration regression.

`npm run simulate:diff` was executed on 2026-09-01 but its committed baseline already differs broadly from current `main`; it cannot certify SEP-A's zero behavior delta. SEP-A changes no decision-affecting engine file, and `check-policy-drift.mjs` against `main` passes. Refreshing or reconciling that baseline is separate simulation-governance work, not an evidence-pack behavior change.

### Phase 7 — remediation decision

For SEP-A, record one of:

- [ ] **retain** — evidence boundary + product policy accepted;
- [ ] **retain + calibrate** — safe enough to keep, exact threshold needs outcome calibration;
- [x] **partial** — evidence insufficient for the exact threshold and neutral-default sub-surfaces; retain P0 calibration debt;
- [ ] **remediate** — separate behavior-changing PR required;
- [ ] **escalate clinically** — product should collect/route context rather than infer a training prescription.

---

## 19. Recommended immediate next action

**SEP-A — Subjective Readiness** is implemented. The evidence boundary,
product-policy claim, coverage migration, runtime lineage, and analysis document are
all merged. SEP-B uses the focused implementation plan's two reviewable workstreams:

1. evidence appraisal, exact product descriptors, coverage-taxonomy repair, and
   implementation-alignment tests;
2. behavior-identical trace and material-use lineage, gated by a decision-equivalence
   corpus.

Move every executable policy change discovered during appraisal to SEP-C.

The most important success criterion is not the number of P0 rows closed. It is that an historical recommendation can say exactly which reviewed evidence boundary and which explicit product safety policy participated, while the registry remains honest about what science does and does not validate.
