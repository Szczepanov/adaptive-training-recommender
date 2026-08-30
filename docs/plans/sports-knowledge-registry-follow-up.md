# Sports Knowledge Registry Follow-up

**Status:** In progress

ADR-0033 establishes the first claim registry and migrates Evergreen provenance without changing recommendation behavior. This plan records the next increments so the foundation does not imply complete evidence coverage.

## SKR1 — Persist claim lineage in recommendation audit

**Status:** Planned

- Extend the recommendation audit with the materially consumed `{ claimId, version }` set.
- Keep the audit compact; do not copy claim statements or source metadata into Firestore.
- Update replay to distinguish policy-version drift from knowledge-version drift.
- Review Firestore schema/rules implications under ADR-0010 before implementation.

## SKR2 — Add knowledge coverage inventory

**Status:** Complete (2026-08-30)

- Inventory decision-affecting numeric thresholds and training-policy assumptions.
- Classify each as scientific claim, product heuristic, athlete-specific rule, safety invariant or pure implementation constant.
- Report uncovered decision-affecting assumptions without requiring immediate migration of low-impact display-only logic.

Implemented by `app/src/knowledge/knowledgeCoverage.ts`, validated in CI, with the baseline audit recorded in `docs/analysis/2026-08-30-engine-knowledge-coverage-inventory.md`.

Initial baseline: 47 policy families — 4 covered, 38 uncovered and 5 deliberately not applicable to sports-science provenance. The research backlog was 16 P0 / 13 P1 / 7 P2 / 2 P3, including 7 uncovered high-safety families. Shadow/observability-only models are explicitly separated from live decision authority so provisional thresholds do not inflate coverage debt.

## SKR3 — Migrate high-impact training policy

**Status:** In progress

For each migration, define the atomic claim first and then search the best applicable evidence. Performance claims should explicitly consider current systematic reviews/meta-analyses and relevant primary studies rather than relying on a generic hierarchy label.

Each migration should be behavior-preserving unless the evidence review explicitly justifies a separate policy change and `POLICY_VERSION` bump.

### Evidence Pack 1 — Load + Intensity + Recovery

**Status:** Complete (2026-08-30)

Analysis: `docs/analysis/2026-08-30-evidence-pack-load-intensity-recovery.md`

Migrated:

- internal hard/moderate intensity classification semantics;
- rolling hard-session density cap;
- next-day anchor/quality spacing;
- recent-hard-session readiness penalty;
- dimensional fatigue half-life model;
- heavy lower-body strength vs key-cycling adjacency;
- default hard-lower-body recovery rule (partial coverage only).

The pack deliberately uses dual lineage where evidence supports the general training/recovery principle but not the exact internal product scalar. Exact `systemicCost` thresholds, count windows and fatigue half-lives remain explicit product heuristics rather than inheriting scientific certainty.

`spacing.hard_lower_body_recovery` remains **partial / P1** because active workout-specific `recoveryHours` and `minimumDaysAfterHardLowerBody` values can override the default and still require a catalog-by-catalog audit.

Post-pack inventory: 10 covered / 1 partial / 31 uncovered / 5 not applicable. P0 / P1 / P2 / P3 = 10 / 13 / 7 / 2. High-impact uncovered falls from 25 to 18; high-safety uncovered from 7 to 5.

No recommendation behavior changes were made, so this pack does not bump the global recommendation `POLICY_VERSION`.

### Evidence Pack 2 — Readiness + HRV/RHR/Sleep + Internal Fatigue

**Status:** Next

Priority families:

1. `readiness.physiological_strain_model`;
2. `readiness.subjective_mode_thresholds`;
3. `readiness.absolute_device_floors`;
4. `readiness.acute_biometric_floors`;
5. `readiness.mode_score_thresholds`;
6. `fatigue.internal_response_model`.

The key epistemic question is expected to be whether research supports within-athlete interpretation while exact device-score/biomarker cut-points remain product calibration or need athlete-specific evidence.

### Later SKR3 packs

After Pack 2, prioritize:

1. tapering and event-preparation rules;
2. injury/pain safety constraints whose behavior depends on general sports/rehab knowledge;
3. periodization objectives and sport/event demand profiles;
4. stimulus-credit and optimizer calibration;
5. fueling/recovery recommendations as those features gain decision authority.

## SKR4 — Athlete-specific evidence boundary

**Status:** Planned

Design an identity-scoped athlete evidence model for repeated personal response patterns. It must remain separate from global Sports Knowledge Registry claims and from raw decision evidence.

Candidate lineage:

```text
general KnowledgeClaim (prior)
        +
athlete-specific repeated observations
        -> athlete-specific policy refinement
```

Do not store personal measurements in the global registry.

## SKR5 — Freshness governance

**Status:** Planned

Add review-frequency metadata only after enough claims exist to justify the operational cost. Candidate rules:

- high-safety or rapidly evolving claims reviewed more frequently;
- stable guideline definitions reviewed less frequently;
- stale review dates create warnings first, not automatic scientific invalidation;
- automated literature discovery may suggest review work but may not silently rewrite claim status/certainty.

## SKR6 — Evidence-synthesis review workflow

**Status:** Planned after the coverage inventory creates enough demand.

Build a lightweight review workflow around claims rather than bulk literature ingestion:

- search PubMed and appropriate domain sources (for example Cochrane, society guidelines and journal databases) for candidate systematic reviews/meta-analyses;
- retain stable source identity using PMID/PMCID/DOI/PROSPERO where available;
- record review design separately from synthesis method (`systematic_review` + `meta_analysis`, rather than treating meta-analysis as an evidence tier);
- record whether the source directly, partially or indirectly answers the registered claim;
- for decision-important syntheses, capture a concise human-reviewed appraisal covering relevance, review risk of bias, heterogeneity, imprecision, publication/reporting bias, pooling appropriateness and important sensitivity analyses;
- detect obvious duplicate source identity and, later if needed, overlapping primary studies across reviews;
- treat ROBIS/AMSTAR 2/PRISMA/GRADE as complementary tools with different purposes, not interchangeable scores;
- allow automated discovery to open a review candidate/task, but require human review before adding/changing active claim certainty, status or recommendation authority.

Do not build this as a citation warehouse. The output of the workflow is still a reviewed `KnowledgeClaim` with a bounded set of materially relevant sources.

## Explicitly deferred

- vector database / embeddings;
- automatic paper ingestion into active claims;
- automatic certainty upgrades from PubMed indexing, publication type or meta-analysis;
- RDF/OWL knowledge graph;
- formal GRADE certification workflow;
- universal sports ontology;
- LLM-authored claim changes without human review.
