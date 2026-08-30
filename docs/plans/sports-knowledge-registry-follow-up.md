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

## Explicitly deferred

- vector database / embeddings;
- automatic paper ingestion;
- RDF/OWL knowledge graph;
- formal GRADE certification workflow;
- universal sports ontology;
- LLM-authored claim changes without human review.
