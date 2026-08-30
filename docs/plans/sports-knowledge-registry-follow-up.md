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

Implemented by `app/src/knowledge/knowledgeCoverage.ts`, validated in CI, with the baseline audit recorded in `docs/analysis/2026-08-30-engine-knowledge-coverage-inventory.md`.

Initial baseline: 47 policy families — 4 covered, 38 uncovered and 5 deliberately not applicable to sports-science provenance. The research backlog was 16 P0 / 13 P1 / 7 P2 / 2 P3, including 7 uncovered high-safety families.

## SKR3 — Migrate high-impact training policy

**Status:** In progress

For each migration, define the atomic claim first and then search the best applicable evidence. Each migration should be behavior-preserving unless the evidence review explicitly justifies a separate policy change and `POLICY_VERSION` bump.

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
- resting/nocturnal respiration as a low-certainty contextual anomaly signal rather than a specific illness/readiness marker.

Current product policies documented separately:

- live HRV/RHR/sleep/respiration strain weights and variability floors;
- absolute sleep-score / Body Battery floors;
- acute HRV/RHR modify floors;
- composite train/modify/recover score thresholds;
- internal-response HRV/RHR/sleep normalization and fusion model.

The pack contains six scientific claims and five explicit product-policy claims. It does **not** treat HRV or RHR as standalone readiness truth, consumer sleep estimates as polysomnography, proprietary Body Battery/sleep scores as independently validated physiological cut-points, or respiration as a specific illness detector. Exact app weights and thresholds remain product heuristics with `not_applicable` scientific certainty.

RHR evidence is sufficiently direct for **moderate / conditional** contextual monitoring authority. Respiration evidence is materially less direct to athlete readiness: the selected literature mainly supports measurement, within-person longitudinal stability and multivariate infection/anomaly context, so its claim is intentionally **low / informational**.

The RHR/respiration extension enriches lineage rather than increasing the coverage count. The same five readiness families were already marked covered; they now reference evidence specific to every live objective signal instead of allowing adjacent HRV/sleep evidence to stand in for RHR/respiration.

`readiness.subjective_mode_thresholds` remains **uncovered / P0** because objective-biomarker evidence must not be used to legitimize subjective cut-points by proximity.

Post-pack inventory remains 15 covered / 1 partial / 26 uncovered / 5 not applicable. P0 / P1 / P2 / P3 = 5 / 13 / 7 / 2. High-impact uncovered = 13 and high-safety uncovered = 4.

No recommendation behavior changes were made, so this pack does not bump the global recommendation `POLICY_VERSION`.

### Evidence Pack 3 — Subjective Readiness + Injury/Pain Safety

**Status:** Next

Priority families:

1. `readiness.subjective_mode_thresholds`;
2. `injury.tissue_response_severity`;
3. `injury.region_restriction_mapping`;
4. `injury.pain_envelope_mapping`.

This pack should separate validated symptom/return-to-sport principles from conservative product action mappings. Because three families are high-safety, it should prefer guideline/consensus/rehabilitation evidence and preserve explicit uncertainty rather than manufacturing universal pain thresholds.

### Evidence Pack 4 — Taper + Event Preparation

**Status:** Planned

Start with `periodization.taper_windows_volume` (remaining non-injury P0), then reconcile pre-event strength/hard/exhaustive restrictions and taper sharpening targets against event type and training status.

### Later SKR3 packs

- periodization objectives and sport/event demand profiles;
- stimulus-credit and optimizer calibration;
- workout-specific recovery metadata audit;
- fueling/recovery recommendations as those features gain decision authority.

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
