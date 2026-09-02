# Sports Knowledge Registry Follow-up

**Status:** In progress

ADR-0033 establishes the first claim registry and migrates Evergreen provenance without changing recommendation behavior. This plan records the next increments so the foundation does not imply complete evidence coverage.

## SKR1 — Persist claim lineage in recommendation audit

**Status:** Complete (2026-08-31)

Implemented as schema-version-4 recommendation audits:

- runtime decision paths emit stable claim IDs only for covered policy families actually evaluated with applicable inputs;
- the composition boundary resolves and persists a deterministic, de-duplicated `{ claimId, version }` set;
- statements, citations and source metadata remain in the Git-backed registry rather than being copied into Firestore;
- unchanged legacy v3 decisions are not backfilled; their historical knowledge lineage remains unavailable rather than reconstructed from current evidence;
- replay reports knowledge-version/status drift separately from policy-version drift and does not mark an otherwise internally reproducible historical decision invalid merely because the evidence contract has since evolved;
- Firestore v4 validation requires the lineage field and audit immutability now compares the complete audit map, protecting claim lineage from same-decision mutation.

Analysis/implementation record: `docs/analysis/2026-08-31-skr1-persisted-knowledge-lineage.md`.

## SKR2 — Add knowledge coverage inventory

**Status:** Complete (2026-08-30)

Implemented by `app/src/knowledge/knowledgeCoverage.ts`, validated in CI, with the baseline audit recorded in `docs/analysis/2026-08-30-engine-knowledge-coverage-inventory.md`.

Initial baseline: 47 policy families — 4 covered, 38 uncovered and 5 deliberately not applicable to sports-science provenance. The research backlog was 16 P0 / 13 P1 / 7 P2 / 2 P3, including 7 uncovered high-safety families.

## SKR3 — Migrate high-impact training policy

**Status:** Complete (W0–W3 complete; W4 deferred)

For each migration, define the atomic claim first and then search the best applicable evidence. Each migration should be behavior-preserving unless the evidence review explicitly justifies a separate policy change and `POLICY_VERSION` bump.

**Current totals (2026-09-02, post SKR3 W0–W3):** 54 families — 33 covered / 14 partial / 1 uncovered / 6 not applicable. P0 / P1 / P2 / P3 = 7 / 6 / 2 / 0. High-impact uncovered = 0, high-safety uncovered = 0. Zero high-impact or high-safety uncovered risk debt remains. The remaining uncovered family is `periodization.post_event_recovery_window` (P1/moderate-impact). Scoping and audit records: [`2026-09-02-skr3-completion-plan.md`](./2026-09-02-skr3-completion-plan.md) and [`2026-09-02-workout-catalog-recovery-metadata-audit.md`](../analysis/2026-09-02-workout-catalog-recovery-metadata-audit.md).

### Evidence Pack 1 — Load + Intensity + Recovery

**Status:** Complete (2026-08-30)

Analysis: `docs/analysis/2026-08-30-evidence-pack-load-intensity-recovery.md`

Migrated internal intensity semantics, rolling hard density, anchor spacing, recent-hard readiness penalty, fatigue half-lives, strength/endurance adjacency and the default hard-lower-body recovery rule. `spacing.hard_lower_body_recovery` remains **partial / P1** because workout-specific recovery metadata still requires catalog-level audit.

Post-pack inventory: 10 covered / 1 partial / 31 uncovered / 5 not applicable. P0 / P1 / P2 / P3 = 10 / 13 / 7 / 2.

### Evidence Pack 2 — Readiness + Sleep + HRV + RHR + Respiration

**Status:** Complete (2026-08-30)

Analysis: `docs/analysis/2026-08-30-evidence-pack-readiness-sleep-hrv.md`

Scientific boundaries added:

- contextual/longitudinal HRV interpretation;
- conditional HRV-guided training authority;
- individualized/contextual resting-HR interpretation;
- sleep-loss/performance relevance;
- consumer wearable sleep-measurement limitations;
- resting/nocturnal respiration as a **moderate-certainty / informational early-anomaly signal**: a personal-baseline rise can precede respiratory infection in athletes, but RR is also sensitive to non-infectious stress and is not a diagnosis or standalone training veto.

Current product policies documented separately:

- live HRV/RHR/sleep/respiration strain weights and variability floors;
- absolute sleep-score / Body Battery floors;
- acute HRV/RHR modify floors;
- composite train/modify/recover score thresholds;
- internal-response HRV/RHR/sleep normalization and fusion model.

The pack contains six scientific claims and five explicit product-policy claims. It does **not** treat HRV or RHR as standalone readiness truth, consumer sleep estimates as polysomnography, proprietary Body Battery/sleep scores as independently validated physiological cut-points, or respiration as a specific illness detector. Exact app weights and thresholds remain product heuristics with `not_applicable` scientific certainty.

RHR evidence is sufficiently direct for **moderate / conditional** contextual monitoring authority. Respiration now has **moderate evidence certainty for the prognostic/anomaly claim but informational direct action authority**. The expanded evidence includes a small NCAA Division I athlete cohort with RR elevation three days before a positive COVID-19 test, a systematic review identifying RR among recurring presymptomatic wearable signals, a 525-person cohort linking +1 breath/min nightly RR with about 23% higher odds of moderate/high perceived stress, prospective infection validation showing important nonspecific false alerts, and an athlete overload study supporting individualized multivariate monitoring rather than RR-only prescription.

That evidence supports the app allowing RR to contribute to readiness context. It does **not** directly validate "RR rises, therefore reduce training" as a universal rule. Any conservative schedule influence remains conditional product policy and should ideally require persistence and/or corroboration from symptoms, RHR, HRV, sleep or recent load.

The RHR/respiration extension enriches lineage rather than increasing the coverage count. The same five readiness families were already marked covered; they now reference evidence specific to every live objective signal instead of allowing adjacent HRV/sleep evidence to stand in for RHR/respiration.

`readiness.subjective_mode_thresholds` remains **uncovered / P0** because objective-biomarker evidence must not be used to legitimize subjective cut-points by proximity.

Post-pack inventory remains 15 covered / 1 partial / 26 uncovered / 5 not applicable. P0 / P1 / P2 / P3 = 5 / 13 / 7 / 2. High-impact uncovered = 13 and high-safety uncovered = 4.

No numeric recommendation behavior changes were made, so this pack does not bump the global recommendation `POLICY_VERSION`. The stale `rules.ts` respiration comment was corrected as a syntax-identical documentation change; the policy-drift gate now proves comment/whitespace-only decision-file edits by comparing normalized TypeScript syntax with comments removed. A future persistence/corroboration escalation policy for RR would be a separate behavior-changing PR with simulation and athlete-outcome calibration.

### Safety Evidence Pack — Subjective Readiness + Injury/Pain Safety

**Status:** Implemented — SEP-A, SEP-B, and SEP-C1 merged on `main`; SEP-C2, SEP-C3, and SEP-C4 implemented; focused regression tests added.

Umbrella plan: [`2026-08-31-safety-evidence-pack-subjective-readiness-injury-pain.md`](./2026-08-31-safety-evidence-pack-subjective-readiness-injury-pain.md). Focused SEP-B plan: [`2026-09-01-safety-evidence-pack-injury-pain-sep-b.md`](./2026-09-01-safety-evidence-pack-injury-pain-sep-b.md). SKR1 is complete. SEP-A covered the absolute subjective classifier, SEP-B covered injury/clinical lineage without behavior change, and SEP-C implements behavioral policy remediations.

Priority families:

1. `readiness.subjective_mode_thresholds`;
2. `injury.tissue_response_severity`;
3. four independently counted `injury.region_mapping.*` product-policy families;
4. `injury.pain_envelope_mapping`.

SEP-A analysis: `docs/analysis/2026-09-01-evidence-pack-subjective-readiness.md`.

SEP-A adds a contextual self-report monitoring boundary, measurement-quality limitation, explicit no-cutpoint-validation boundary, and a separate current product-policy record. It extends normal readiness audit lineage through SKR1 without changing recommendation behavior. `readiness.subjective_mode_thresholds` is **partial / P0**, not covered: the five-item equal-weight score, exact comparisons, and partial-check-in neutral defaults remain unvalidated calibration debt.

SEP-B delivered SEP-B1 (evidence, product descriptors, coverage migration, alignment tests) and SEP-B2 (behavior-identical trace and material-use lineage) in one stacked review branch. Its three semantic families remain high-safety and deliberately partial/P0: the current `painFlag` combines pain/injury with non-allergy illness, structured tissue input stacks with that generic branch, and region labels are not diagnoses. The evidence review is recorded in [`2026-09-01-evidence-pack-injury-pain.md`](../analysis/2026-09-01-evidence-pack-injury-pain.md); the implementation does not make these mappings clinically validated or covered.

### Evidence Pack 4 — Strength + Concurrent Training

**Status:** Complete (2026-08-30)

Analysis: `docs/analysis/2026-08-30-evidence-pack-strength-concurrent-training.md`

Added two focused scientific claims with deliberately different evidence boundaries:

- supplemental strength training can improve endurance performance and economy/efficiency in trained runners and cyclists without reliably increasing VO2max; the cross-sport claim is **low-certainty / conditional** because cycling certainty is low, running evidence ranges from very low to moderate, and the umbrella review reports low or critically low confidence for most included reviews;
- concurrent endurance and resistance training can develop both domains; for chronic adaptation, resistance-before-endurance is the better-supported order when lower-body strength or hypertrophy is the primary target, while sequence appears less important for aerobic development. The evidence does not establish one universal order or a full-calendar-day separation requirement.

The concurrent claim is explicitly **chronic**. Acute residual fatigue and the quality of a subsequent key cycling/running session are separate questions and are not treated as directly quantified by the umbrella/sequence syntheses. The pack also links the existing elite-athlete consensus as partially direct support for individualized same-day multimodal programming without converting consensus into a fixed recovery interval.

The pack preserves the existing scientific/product boundary. It does **not** relabel the product's three-session strength upper target, 0–1-day heavy-strength/key-cycling exclusion, systemic-cost thresholds, or workout recovery metadata as scientific constants.

This is a lineage-deepening pack rather than a coverage-inflation pack. `spacing.hard_lower_body_recovery` remains **partial / P1** because workout-specific recovery metadata still requires catalog-level audit, and `optimizer.stimulus_benefit_weights` remains **uncovered / P2** because pooled strength-training effects are not optimizer utility coefficients.

Post-pack inventory therefore remains 15 covered / 1 partial / 26 uncovered / 5 not applicable. No executable recommendation behavior changes are made and `POLICY_VERSION` remains unchanged.

### Evidence Pack 5 — Taper + Fueling

**Status:** Complete (2026-08-30)

Analysis: `docs/analysis/2026-08-30-evidence-pack-taper-fueling.md`

Taper work separates direct scientific support for a pre-event volume-reduction taper from the app's exact scheduling, restriction windows and sharpening values. The bundled `periodization.taper_windows_volume` family intentionally remains uncovered because it also contains an independently calibrated three-day post-event recovery rule that taper meta-analysis does not justify.

Fueling work establishes reusable claims for carbohydrate efficacy, event-scaled carbohydrate intake and hydration/overdrinking safety without pretending that the current recommendation engine already has fueling decision authority. The dose boundary now includes contemporary 2026 evidence: >90 g/h can be physiologically plausible for selected trained endurance athletes, but performance superiority is not sufficiently established to make 120 g/h a universal recommendation.

No executable recommendation behavior changes are made and `POLICY_VERSION` remains unchanged.

### Evidence Pack 6 — Periodization Objectives + Sport/Event Demand

**Status:** Complete (2026-09-02; reviewed and strengthened on PR #332)

Analysis: [`2026-09-02-evidence-pack-periodization-event-demand.md`](../analysis/2026-09-02-evidence-pack-periodization-event-demand.md)

Registers a **low-certainty, mixed-evidence periodization boundary** rather than a block-superiority claim. Mølmen 2019 provides a favorable pooled signal for block periodization but explicitly flags a small, generally low-quality evidence base; Galán-Rioja 2023 finds no evidence favoring a specific 8–12-week periodization model in trained road cyclists; and the load-matched randomized Almquist 2022 cyclist trial finds no between-group performance advantage after 12 weeks. Issurin 2010 remains conceptual framework evidence. The resulting authority is: block periodization is a viable tool, not a uniquely optimal sequence.

The moderate-certainty event-demand boundary uses Joyner & Coyle 2008 for broad endurance determinants, Sanders & van Erp 2021 for cycling stage/race morphology, **Ebert et al. 2006 for direct criterium/flat/hilly field-power data**, and Sharma & Périard 2020 for triathlon-distance demands. Review corrected an over-direct first-draft summary of Sanders that had attributed a specific TT-versus-criterium distinction not established by the published review; the product's exact TT/criterium vectors remain product calibration.

Four product-policy claims record the exact phase boundaries/scales, objective-inclusion thresholds, multi-event contribution/taper-delegation rules and the **19 authored event-preset demand vectors**. The count is regression-guarded in both claim and product-policy source prose so the stale 22-row wording found during review cannot recur silently.

All five families land **partial**, none covered: the boundaries are real but generic, while every scalar the engine uses stays uncalibrated. `event.demand_presets` is reclassified from `scientific_claim` to `product_heuristic` — an authored 0-1 vector table is an encoding, not a measured constant.

Two families in this pack (`periodization.objective_thresholds`, `periodization.multi_event_contribution`) receive **product-policy claims only**: the first gates on the product's own normalized 0-1 scale, and the second is deterministic scheduling conflict-resolution. Neither has a researchable physiological question, so no scientific claim is attached rather than citing adjacent evidence by proximity.

Post-pack inventory: 54 families — 18 covered / 14 partial / 16 uncovered / 6 not applicable. High-impact uncovered falls from 7 to 4; the research backlog is deliberately unchanged (P0/P1/P2/P3 = 7/13/8/2), because these families moved from "no provenance" to "provenance recorded, calibration still owed". No executable recommendation behavior changed and `POLICY_VERSION` remains unchanged.

### Later SKR3 packs (Completed Workstreams)

The completion workstreams scoped in [`2026-09-02-skr3-completion-plan.md`](./2026-09-02-skr3-completion-plan.md) are complete:

- **W2a — Optimizer Scoring Heuristics (4 families)**: **Complete**. Product-policy claims registered in `app/src/knowledge/optimizerScoringKnowledge.ts` with alignment tests in `optimizerScoringPolicyAlignment.test.ts` pinning fatigue-cost weights, recovery streak heuristics, stimulus benefit weights, and event priority multipliers.
- **W2b — Stimulus Credit & Remaining Heuristics (11 families)**: **Complete**. Product-policy claims registered in `app/src/knowledge/stimulusHeuristicsKnowledge.ts` with alignment tests in `stimulusHeuristicsPolicyAlignment.test.ts` pinning stimulus confidence discounting, race-specific credit formulas, stimulus coverage thresholds, legacy keyword credit, fatigue max fusion, ambient step surge scaling, plan-tier cost caps, post-recover buffer, training history qualification, default commitment priors, and session spacing tie-breaks.
- **W3 — Workout-Specific Recovery Metadata Audit (1 family)**: **Complete**. Audit recorded in [`2026-09-02-workout-catalog-recovery-metadata-audit.md`](../analysis/2026-09-02-workout-catalog-recovery-metadata-audit.md), bounds validation added to `app/src/workouts/validation.ts`, and test assertions added in `app/src/workouts/workoutRecoveryMetadata.test.ts`. `spacing.hard_lower_body_recovery` stays partial at P1 because 10 workouts with lowerBodyCost >=0.6 declare 1-day spacing overrides that require separate behavior remediation.
- **W4 — Fueling/recovery policy migration**: Deferred until fueling gains live decision authority.

## SKR4 — Athlete-specific evidence boundary

**Status:** Planned

Design an identity-scoped athlete evidence model for repeated personal response patterns. It must remain separate from global Sports Knowledge Registry claims and from raw decision evidence.

```text
general KnowledgeClaim (prior)
        +
athlete-specific repeated observations
        -> athlete-specific policy refinement
```

Do not store personal measurements in the global registry.

## SKR5 — Freshness governance

**Status:** Planned

- high-safety or rapidly evolving claims reviewed more frequently;
- stable guideline definitions reviewed less frequently;
- stale review dates create warnings first, not automatic scientific invalidation;
- automated literature discovery may suggest review work but may not silently rewrite claim status/certainty.

## SKR6 — Evidence-synthesis review workflow

**Status:** Planned after the registry creates enough demand.

Build a lightweight review workflow around claims rather than bulk literature ingestion:

- search PubMed and appropriate domain sources for candidate guidelines/reviews;
- retain stable source identity using PMID/PMCID/DOI/PROSPERO where available;
- record review design separately from synthesis method;
- record directness to the actual claim;
- for decision-important syntheses, capture a concise human-reviewed appraisal of relevance, bias, heterogeneity, imprecision and reporting bias;
- require human review before changing active claim certainty/status/recommendation authority.

Do not build this as a citation warehouse.

## Explicitly deferred

- vector database / embeddings;
- automatic paper ingestion into active claims;
- automatic certainty upgrades from PubMed indexing, publication type or meta-analysis;
- RDF/OWL knowledge graph;
- formal GRADE certification workflow;
- universal sports ontology;
- LLM-authored claim changes without human review.
