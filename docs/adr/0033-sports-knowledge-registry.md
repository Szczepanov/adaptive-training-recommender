# ADR-0033: Versioned Sports Knowledge Registry and Claim-Level Evidence Lineage

* **Status:** Accepted
* **Date:** 2026-08-30
* **Deciders:** Core Engineering Team

## Context

The recommendation engine increasingly contains training-science assumptions alongside athlete-specific observations, safety policy and product heuristics. Those concepts have different epistemic roles but have historically been easy to collapse into the same word: "evidence".

Two existing patterns make the boundary visible:

1. `decisionEvidence.ts` describes evidence available **about the athlete and today's decision** (HRV, sleep, soreness, safety gates, data confidence).
2. `evergreenStrategy.ts` embeds **knowledge provenance for a training policy** (`sourceId`, population, outcome, confidence, applicability, authority, review date).

The second pattern is valuable but local. A scientific source can be interpreted differently by different features, product defaults can accidentally inherit the authority of an external guideline, and a future feature change can introduce a sports-science assumption without a stable reference that reviewers or CI can inspect.

A single scalar evidence tier is not sufficient. GRADE-style evidence assessment distinguishes certainty of evidence from strength of recommendation, and the Oxford CEBM levels explicitly vary the likely best evidence by the question being asked. The application also needs dimensions that neither framework is intended to encode directly, such as product maturity, status, applicability to a sport/population/horizon, and the safety consequence of being wrong.

The repository therefore needs a small knowledge control plane, not a bibliography and not a universal sports ontology.

## Decision

### D-SKR-CLAIM — the unit of reusable knowledge is an atomic claim

The canonical reusable unit SHALL be a `KnowledgeClaim`, not a paper, guideline or free-text code comment.

A source may support several claims, and a claim may accumulate support from several sources. Consumers SHALL reference stable claim IDs rather than re-encoding source metadata locally.

Each claim records at least:

- stable `id` and integer `version`;
- explicit `statement`;
- `claimType`;
- `maturity`;
- `status`;
- `evidenceCertainty`;
- `recommendationStrength`;
- `safetyImpact`;
- structured applicability (`contexts`, sports, populations, outcomes, horizon);
- source links with `directness`;
- limitations;
- `reviewedOn`.

### D-SKR-MULTIAXIS — do not collapse epistemic state into one 1–5 score

The registry SHALL keep the following concepts separate:

- **maturity** — how developers should treat the claim in product development (`foundational | established | supported | emerging | heuristic`);
- **status** — lifecycle/acceptance (`active | contested | deprecated | rejected`);
- **evidence certainty** — confidence in the underlying scientific evidence (`high | moderate | low | very_low | not_applicable`);
- **recommendation strength** — how strongly a policy may act (`strong | conditional | informational`);
- **directness** — whether a source directly answers the registered claim (`direct | partially_direct | indirect`);
- **safety impact** — consequence of being wrong (`low | moderate | high`).

`deprecated`, `rejected` and `contested` are statuses, not weak evidence tiers.

A product heuristic SHALL NOT be assigned scientific certainty merely to fit the schema. It uses `maturity=heuristic` and `evidenceCertainty=not_applicable`, with an explicit product-policy source.

### D-SKR-BOUNDARIES — scientific knowledge, decision evidence and athlete evidence are distinct

The codebase SHALL use three separate concepts:

1. **Sports knowledge** — generalizable claims and product priors used to justify rules.
2. **Decision evidence** — runtime observations available for a specific recommendation.
3. **Athlete-specific evidence** — repeated observations learned about one athlete.

General sports knowledge is a prior. Athlete-specific evidence may narrow or override how a general policy applies to that athlete without rewriting the general claim as false.

This ADR does not yet create the athlete-specific evidence store; it reserves the conceptual boundary so later work does not place personal observations in the global registry.

### D-SKR-SOURCES — source metadata is normalized separately from claims

`KnowledgeSource` SHALL identify the supporting guideline, review, trial, consensus statement, product policy or other source.

The initial source types are intentionally bounded. The registry is not a citation manager. Source records exist because a claim depends on them.

A `product_policy` source is first-class and deliberately lower in scientific authority than an external source; this prevents product defaults from masquerading as research findings.

### D-SKR-DEMAND — populate knowledge on demand

The registry SHALL be demand-driven:

> A claim belongs in the registry when application behavior, validation or explanation depends on it.

The project SHALL NOT attempt to preload every sport, exercise, physiological mechanism or paper.

### D-SKR-GIT — Git is the v1 knowledge store

The initial registry SHALL live as typed source-controlled code under `app/src/knowledge/`.

No database, vector store, embedding index, RDF/OWL ontology or remote knowledge service is introduced by this decision.

Git provides the properties currently required: reviewable diffs, history, attribution, branching, stable application builds and deterministic replay of old code.

### D-SKR-CONSUMPTION — active policy references claims by stable ID

Policy code SHALL reference claim IDs through checked-in constants and resolve those references through the registry.

Active policy MUST NOT implicitly consume a `contested`, `deprecated` or `rejected` claim. `getActiveKnowledgeClaim` fails closed for non-active claims.

For the first migration, `evergreenStrategy.ts` exposes `knowledgeRefs` on each dose requirement and derives its existing `EvidenceProvenance` compatibility object from the primary claim. The legacy `confidence` field is preserved for current consumers; `evidenceCertainty`, maturity, status and claim version are additive and have their stricter meanings from this ADR.

### D-SKR-NO-OVERCLAIM — policy-only numbers get product claims

A scientific source SHALL justify only the part of a rule it actually supports.

The initial migration makes this concrete for adult strength training:

- WHO supports muscle-strengthening activity on **two or more days per week** (strong recommendation, moderate-certainty evidence).
- WHO does **not** establish the application's default `maximum: 3` as a scientific maximum.
- the registry therefore records the three-session upper target separately as a product heuristic.

The same principle applies to future thresholds, caps, progression rates and readiness cut-offs.

### D-SKR-VALIDATION — knowledge integrity is part of `npm run check`

`validateSportsKnowledgeRegistry` and `scripts/validate-sports-knowledge.ts` SHALL fail CI for structural integrity violations, including:

- duplicate or unsafe IDs;
- missing source links;
- references to unknown sources or superseded claims;
- malformed versions/review dates;
- heuristic claims presented with scientific certainty;
- deprecated/rejected claims authorizing strong recommendations;
- high-safety strong policy resting on emerging/heuristic or low-certainty evidence.

Warnings may be used for governance debt that should not yet block builds, such as missing limitations or contested claims present in the registry.

This validator does not certify that a paper was interpreted correctly. Human review remains required for scientific interpretation.

### D-SKR-VERSIONING — claim version and policy version answer different questions

A knowledge claim version identifies the reviewed statement/evidence/applicability contract.

`POLICY_VERSION` continues to identify decision logic under ADR-0010. Changing a claim without changing behavior may increment only the claim version. Changing decision behavior still follows the repository's existing `POLICY_VERSION` discipline.

This foundation PR does not alter recommendation behavior, so it does not increment the decision `POLICY_VERSION`.

### D-SKR-AUDIT-FUTURE — persisted recommendation lineage is a follow-up

A future change SHOULD persist the knowledge claim IDs and versions materially used by a recommendation audit so historical decisions can answer both:

- which policy version decided; and
- which reviewed knowledge version justified that policy.

That change affects persisted audit/schema contracts and SHALL be reviewed separately rather than being smuggled into this foundation migration.

## Initial registry scope

The first checked-in claims are intentionally small and map existing Evergreen behavior:

1. adult aerobic weekly health volume (WHO 2020);
2. adult muscle-strengthening frequency (WHO 2020);
3. the product's three-session default upper strength target (explicit heuristic);
4. the product's conditional one-to-two high-intensity weekly prior (explicit heuristic).

No new sport-performance prescription is introduced by this ADR.

## Consequences

### Positive

- Feature changes can reference stable knowledge claims instead of copying citations/comments.
- Scientific certainty is no longer conflated with product confidence or recommendation strength.
- Guidelines cannot silently lend authority to product-only caps and defaults.
- Claims expose directness, applicability and limitations, making cross-sport/population extrapolation reviewable.
- CI detects broken knowledge lineage and several unsafe category errors.
- Future decision audit can add scientific lineage without redesigning the knowledge model.
- The registry can grow incrementally as features need it.

### Negative / cost

- Adding or changing an evidence-based rule now requires maintaining a claim and source record.
- Multi-axis semantics are more verbose than a single tier badge.
- The checked-in classifications still depend on human scientific judgment.
- Some existing rules will initially remain undocumented until migrated; this ADR does not claim complete knowledge coverage.
- Claim versioning creates maintenance discipline that must be followed consistently to be useful.

## Rejected alternatives

### One evidence score or tier from 1 to 5

Rejected because evidence certainty, applicability, recommendation strength, lifecycle status and safety consequence are independent dimensions. A single score would hide the exact distinction the registry is intended to preserve.

### Store only papers and let features interpret them

Rejected because the same paper can directly support one statement while only indirectly supporting another. The reusable object must be the claim.

### Treat every non-scientific default as low-certainty science

Rejected because product heuristics are not failed science. They are a different authority class and use `not_applicable` scientific certainty.

### Put athlete-specific observations in the global knowledge registry

Rejected because personal evidence has low external generalizability but can be highly relevant to one athlete. It requires a separate identity-scoped evidence model.

### Build a full knowledge graph/vector database now

Rejected because current requirements are deterministic references, validation, review and versioning. Git-backed typed records solve those needs with far less operational complexity.

### Apply GRADE or OCEBM mechanically as the product schema

Rejected. Those frameworks inform important distinctions, but the application must also represent product maturity, sport/population applicability, lifecycle status and safety impact. The registry borrows principles rather than claiming formal GRADE certification.

## References

- World Health Organization. *WHO guidelines on physical activity and sedentary behaviour*. 2020. https://www.who.int/publications/i/item/9789240015128
- World Health Organization. *WHO handbook for guideline development, 2nd edition*. 2014. https://www.who.int/publications/i/item/9789241548960
- Oxford Centre for Evidence-Based Medicine. *Levels of Evidence: An introduction*. https://www.cebm.ox.ac.uk/resources/levels-of-evidence/levels-of-evidence-introductory-document
- ADR-0010: [`decision provenance and audit replay`](./0010-decision-provenance-and-audit-replay.md)
- ADR-0017: [`training intent profile and planning modes`](./0017-training-intent-profile-and-planning-modes.md)
