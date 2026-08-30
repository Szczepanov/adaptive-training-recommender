# Sports Knowledge Registry Follow-up

**Status:** Planned

ADR-0033 establishes the first claim registry and migrates Evergreen provenance without changing recommendation behavior. This plan records the next increments so the foundation does not imply complete evidence coverage.

## SKR1 — Persist claim lineage in recommendation audit

**Status:** Planned

- Extend the recommendation audit with the materially consumed `{ claimId, version }` set.
- Keep the audit compact; do not copy claim statements or source metadata into Firestore.
- Update replay to distinguish policy-version drift from knowledge-version drift.
- Review Firestore schema/rules implications under ADR-0010 before implementation.

## SKR2 — Add knowledge coverage inventory

**Status:** Planned

- Inventory decision-affecting numeric thresholds and training-policy assumptions.
- Classify each as scientific claim, product heuristic, athlete-specific rule, safety invariant or pure implementation constant.
- Report uncovered decision-affecting assumptions without requiring immediate migration of low-impact display-only logic.

## SKR3 — Migrate high-impact training policy

**Status:** Planned

Prioritize claims that can materially change training load or recovery decisions:

1. hard-session density and spacing;
2. progression/load-management rules;
3. readiness/HRV/RHR/sleep interpretation;
4. tapering and event-preparation rules;
5. strength prescriptions used for sport performance;
6. fueling/recovery recommendations;
7. injury/safety constraints whose behavior depends on general sports/rehab knowledge.

For each migration, define the atomic claim first and then search the best applicable evidence. Performance claims should explicitly consider current systematic reviews/meta-analyses and relevant primary studies rather than relying on a generic hierarchy label.

Each migration should be behavior-preserving unless the evidence review explicitly justifies a separate policy change and `POLICY_VERSION` bump.

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
