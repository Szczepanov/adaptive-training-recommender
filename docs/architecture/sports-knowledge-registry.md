# Sports Knowledge Registry

This document describes the **current implementation** of the versioned sports knowledge layer introduced by [ADR-0033](../adr/0033-sports-knowledge-registry.md).

## Purpose

The registry answers:

> Which reviewed knowledge claim justifies this training rule, what supports that claim, where does it apply, and how certain/direct is that support?

It does **not** contain the athlete's current measurements. Runtime HRV, sleep, soreness, history quality and safety gates remain decision evidence in the engine. It also does not yet contain athlete-specific learned responses.

## Data flow

```text
KnowledgeSource(s)
       ↓
KnowledgeClaim (stable id + version)
       ↓ knowledgeRefs
training policy / rule
       ↓
recommendation decision
       ↓
decision explanation / future audit lineage

athlete observations ──→ decision evidence ──┘
```

The two inputs meet at policy evaluation but keep independent provenance.

## Code ownership

| Path | Responsibility |
|---|---|
| `app/src/knowledge/sportsKnowledge.ts` | Types, checked-in sources/claims, lookup API and structural validator |
| `app/src/knowledge/sportsKnowledge.test.ts` | Registry invariants and epistemic-boundary tests |
| `app/scripts/validate-sports-knowledge.ts` | CI/CLI validation entry point |
| `app/src/engine/evergreenStrategy.ts` | First policy consumer; references stable claim IDs and exposes claim-backed provenance |

`npm run check` executes `validate:knowledge`, so registry integrity is part of the normal pre-flight gate.

## Claim model

A `KnowledgeClaim` is intentionally atomic. Important fields are:

| Field | Meaning |
|---|---|
| `id` | Stable semantic identifier used by policy code |
| `version` | Revision of the claim/evidence/applicability contract |
| `statement` | The exact proposition the application is relying on |
| `claimType` | Definition/descriptive/causal/intervention/prognostic/safety/heuristic |
| `maturity` | Product-development maturity, not scientific certainty |
| `status` | Active/contested/deprecated/rejected lifecycle |
| `evidenceCertainty` | Scientific certainty; `not_applicable` for product heuristics |
| `recommendationStrength` | Strong/conditional/informational authority to act |
| `safetyImpact` | Consequence of a wrong interpretation |
| `applicability` | Contexts, sports, populations, outcomes and acute/chronic horizon |
| `evidence[]` | Supporting source IDs plus directness |
| `limitations[]` | Known boundaries and non-claims |
| `reviewedOn` | Last substantive scientific/product review date |

## Source model

`KnowledgeSource` normalizes only information required to identify and classify a supporting source:

- stable source ID;
- title;
- source type;
- citation;
- optional URL/publication date/notes.

A source is not itself a claim. Consumers should not cite a source ID as a substitute for defining what proposition they rely on.

`product_policy` is a legitimate source type. It exists so a product default can be auditable **without pretending to be scientific evidence**.

Source type is descriptive metadata, not an automatic certainty score. A systematic review can still be indirect, inconsistent or imprecise for a particular claim, while lower-level evidence can sometimes be more probative for a different question. `evidenceCertainty` remains an explicit human-reviewed claim-level judgment.

## Multi-axis interpretation

Do not infer one dimension from another.

Examples:

- `maturity=established` does not automatically imply `recommendationStrength=strong`.
- `status=active` means the claim may be consumed; it does not mean certainty is high.
- `evidenceCertainty=moderate` can still accompany a strong guideline recommendation.
- `maturity=heuristic` must use `evidenceCertainty=not_applicable` in the current registry.
- a source can be high quality but only `indirect` for the registered population/sport/horizon.

This separation is deliberate and follows the repository rule that uncertainty must not be converted into a different kind of negative evidence.

## Consumer contract

Policy code should import stable IDs from `KNOWLEDGE_CLAIM_IDS` and resolve through `getActiveKnowledgeClaim` rather than hard-coding duplicated source metadata.

Example pattern:

```ts
const claimId = KNOWLEDGE_CLAIM_IDS.adultAerobicHealthVolume;
const claim = getActiveKnowledgeClaim(claimId);

return {
  ...policyFields,
  knowledgeRefs: [claimId],
  evidence: projectCompatibilityProvenance(claim),
};
```

`getActiveKnowledgeClaim` throws when an existing claim is not `active`. A contested/deprecated/rejected claim therefore cannot silently continue authorizing production policy through the normal path.

## Evergreen migration

The Evergreen strategy is the first migrated consumer.

The numeric behavior is unchanged:

| Requirement | Existing behavior | Knowledge lineage |
|---|---|---|
| Aerobic health volume | 150 min floor; 150–300 min target range | WHO adult aerobic recommendation |
| Strength health frequency | 2-session floor/target | WHO adult muscle-strengthening recommendation |
| Strength upper target | max 3 sessions | explicit Evergreen product heuristic |
| Conditional high intensity | target 1; max/hard cap 2 when history qualifies | explicit Evergreen product heuristic |

The strength split is important: WHO recommends muscle strengthening on two or more days, but does not establish three as a scientific maximum. The registry prevents that product cap from inheriting WHO authority by proximity.

`AdaptationDoseRequirement.evidence` remains as a compatibility projection for existing consumers. It now also carries:

- `knowledgeClaimId`;
- `knowledgeClaimVersion`;
- all `sourceIds`;
- `evidenceCertainty`;
- `maturity`;
- `status`.

Its pre-existing coarse `confidence` remains for compatibility and should not be treated as a synonym for scientific certainty.

## Validation rules

`validateSportsKnowledgeRegistry` currently checks:

- source/claim ID format and uniqueness;
- source title/citation and valid Gregorian publication/review dates in `YYYY-MM-DD` form;
- claim version shape;
- at least one source link per claim;
- source/supersedes referential integrity;
- circular `supersedes` lineage;
- duplicate source links;
- heuristic-vs-scientific-certainty category errors;
- an explicit `product_policy` source for product heuristics;
- at least one non-product-policy source before a claim can carry scientific certainty;
- invalid strong authority from deprecated/rejected claims;
- insufficient basis for high-safety strong policy;
- governance warnings for contested claims or missing limitations.

The source-authority rules are intentionally narrow. They do **not** infer certainty from a source's study design, and a heuristic may still cite external research as contextual/indirect support. Their purpose is only to prevent an internal product policy from being the sole basis for a scientific-certainty label and to keep the product decision itself explicitly auditable.

These are structural/governance checks, not automated peer review. CI cannot determine whether a paper was interpreted correctly or whether all relevant literature was found.

## Authoring workflow

When a feature introduces or changes a sports-science-dependent rule:

1. Write the **atomic claim** the rule requires before choosing a source.
2. Check whether an existing active claim already matches the same population, outcome and horizon.
3. Add/update normalized sources only when needed.
4. Record certainty, directness, applicability and limitations conservatively.
5. If the number is a product default rather than supported by the source, register it as a product heuristic instead of extending the scientific claim.
6. Reference the claim ID from policy code.
7. Run `npm run validate:knowledge` and the relevant policy tests.
8. If the rule can change persisted recommendations, follow ADR-0010 and bump the decision `POLICY_VERSION` as required.

## Versioning guidance

Increment a claim version when the meaning materially changes, including:

- statement wording changes that alter the proposition;
- evidence body/certainty changes;
- applicability changes;
- limitation changes that affect valid consumption;
- lifecycle or authority changes.

Pure spelling/formatting corrections do not need a claim-version bump if the proposition and interpretation remain identical.

A claim version is not a decision-policy version. Historical recommendation replay still uses the engine `POLICY_VERSION`; persisted knowledge-version lineage is a follow-up to ADR-0033.

The current registry resolves only the checked-in version of a stable claim ID. Older versions remain reconstructable from Git/build history, but the current runtime does not expose a historical `getKnowledgeClaim(id, version)` API. Persisted `{ claimId, version }` audit lineage and historical resolution are intentionally deferred together so the storage/replay contract is designed once.

`supersedes` is replacement lineage between claim IDs, not a substitute for the integer version of the same stable claim ID. Cycles are invalid and fail validation.

## Current limitations

The registry is intentionally small. It does not yet provide:

- complete coverage of all sports-science assumptions in the engine;
- persisted claim/version lineage in `RecommendationAudit`;
- athlete-specific learned evidence;
- automatic literature ingestion or freshness monitoring;
- formal GRADE assessments;
- a knowledge graph or semantic search layer.

Those capabilities should be added only when a concrete consumer requires them.
