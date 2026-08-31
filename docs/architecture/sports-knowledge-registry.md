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
- optional URL/publication date/notes;
- optional stable external identifiers (`PMID`, `PMCID`, `DOI`, `PROSPERO`, `ISBN`);
- optional review-level synthesis methods (`meta_analysis`, `network_meta_analysis`, `narrative_synthesis`).

A source is not itself a claim. Consumers should not cite a source ID as a substitute for defining what proposition they rely on.

`product_policy` is a legitimate source type. It exists so a product default can be auditable **without pretending to be scientific evidence**.

Source type is descriptive metadata, not an automatic certainty score. A systematic review can still be indirect, inconsistent or imprecise for a particular claim, while lower-level evidence can sometimes be more probative for a different question. `evidenceCertainty` remains an explicit human-reviewed claim-level judgment.

### Systematic reviews, meta-analyses and PubMed

Systematic reviews and meta-analyses are valuable first-class evidence sources, especially for sports-performance questions where no authoritative guideline directly answers the product claim. They must be represented without turning the evidence hierarchy into a scalar truth score.

The registry deliberately separates **review design** from **synthesis method**:

```ts
const source: KnowledgeSource = {
  id: 'EXAMPLE-REVIEW',
  title: 'Example systematic review',
  sourceType: 'systematic_review',
  citation: '...',
  externalIds: [
    { type: 'pmid', value: '12345678' },
    { type: 'doi', value: '10.1000/example' },
    { type: 'prospero', value: 'CRD420261234567' },
  ],
  synthesisMethods: ['meta_analysis'],
};
```

This matters because **meta-analysis is a statistical synthesis method, not a study design or certainty rating**. A systematic review can legitimately use narrative synthesis when pooling is inappropriate, while a pooled estimate can still be misleading when studies differ materially in population, intervention, outcome definition, risk of bias or direction of effect.

`umbrella_review` represents a systematic review of systematic reviews/meta-analyses. It is useful when multiple syntheses exist, but it also does not automatically receive higher claim certainty because overlap among included reviews, duplicated primary studies and heterogeneous review quality can distort an apparently large evidence base.

**PubMed is an index/discovery system, not an evidence-authority class.** A PMID is therefore stored as a stable external identifier on the actual journal source. Being indexed by PubMed does not by itself increase certainty. The same applies to DOI and PROSPERO: they improve identity, deduplication and auditability, not epistemic weight.

For an important systematic review/meta-analysis, scientific review should consider at least:

- match between the review question and registered claim/population/outcome/horizon;
- risk of bias in the review process and included studies;
- whether pooling was clinically/methodologically defensible;
- heterogeneity/inconsistency and, where useful, prediction intervals;
- imprecision and event/sample counts;
- publication/selective-reporting bias;
- sensitivity to model/specification choices;
- duplicate cohorts or overlapping primary studies across reviews;
- prespecified versus post-hoc subgroup/meta-regression findings;
- recency relative to newer primary studies or competing reviews.

ROBIS and AMSTAR 2 are appropriate critical-appraisal aids for systematic reviews when a claim warrants formal review. AMSTAR 2 explicitly should not be collapsed into a numeric score. PRISMA is primarily a **reporting** guideline, so PRISMA compliance is not equivalent to low risk of bias or high certainty. GRADE-style certainty remains a claim/outcome/body-of-evidence judgment rather than a property copied from a publication label.

### Guidelines versus underlying reviews

When a trustworthy, current guideline directly states the recommendation the product uses, the guideline can remain the direct source for that recommendation. The registry should not mechanically duplicate every underlying systematic review merely to increase source count.

Add underlying or independent reviews when they materially improve the registered claim, for example when:

- the feature depends on an effect estimate or subgroup not represented in the guideline recommendation;
- the guideline is older and a newer review may change certainty/applicability;
- sport-performance applicability differs from the guideline's public-health population;
- conflicting evidence needs to be represented explicitly;
- the product is making a performance claim for which no guideline recommendation exists.

Multiple sources are a **body of evidence**, not votes. Ten overlapping reviews do not automatically outweigh one better, more direct synthesis.

## Multi-axis interpretation

Do not infer one dimension from another.

Examples:

- `maturity=established` does not automatically imply `recommendationStrength=strong`.
- `status=active` means the claim may be consumed; it does not mean certainty is high.
- `evidenceCertainty=moderate` can still accompany a strong guideline recommendation.
- `maturity=heuristic` must use `evidenceCertainty=not_applicable` in the current registry.
- a source can be high quality but only `indirect` for the registered population/sport/horizon.
- `synthesisMethods=['meta_analysis']` says how a review combined data; it does not imply `evidenceCertainty=high`.

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
- stable external-identifier shape and duplicate PMID/PMCID/DOI/PROSPERO/ISBN identity across sources;
- review synthesis metadata is used only on systematic/umbrella reviews;
- duplicate synthesis methods;
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

The source-authority rules are intentionally narrow. They do **not** infer certainty from a source's study design or synthesis method, and a heuristic may still cite external research as contextual/indirect support. Their purpose is only to prevent an internal product policy from being the sole basis for a scientific-certainty label and to keep the product decision itself explicitly auditable.

These are structural/governance checks, not automated peer review. CI cannot determine whether a paper was interpreted correctly, whether a meta-analysis was appropriately pooled, or whether all relevant literature was found.

## Authoring workflow

When a feature introduces or changes a sports-science-dependent rule:

1. Write the **atomic claim** the rule requires before choosing a source.
2. Check whether an existing active claim already matches the same population, outcome and horizon.
3. Search for the best applicable evidence. Prefer trustworthy current guidelines for direct recommendations; for performance/effect claims, prioritize high-quality systematic reviews/meta-analyses while still reviewing their methods and applicability.
4. Add/update normalized sources only when needed. Record PMID/DOI/PROSPERO identifiers where available and model meta-analysis as a synthesis method on the review.
5. Record certainty, directness, applicability and limitations conservatively. Do not infer certainty from PubMed indexing, journal prestige, source type or the presence of a meta-analysis.
6. If the number is a product default rather than supported by the source, register it as a product heuristic instead of extending the scientific claim.
7. Reference the claim ID from policy code.
8. Run `npm run validate:knowledge` and the relevant policy tests.
9. If the rule can change persisted recommendations, follow ADR-0010 and bump the decision `POLICY_VERSION` as required.

## Versioning guidance

Increment a claim version when the meaning materially changes, including:

- statement wording changes that alter the proposition;
- evidence body/certainty changes;
- applicability changes;
- limitation changes that affect valid consumption;
- lifecycle or authority changes.

Pure spelling/formatting corrections do not need a claim-version bump if the proposition and interpretation remain identical.

A claim version is not a decision-policy version. Recommendation schema v4 persists the exact materially consumed `{ claimId, version }` set alongside `POLICY_VERSION`, so replay can distinguish decision-logic drift from knowledge-contract drift.

The current registry still resolves only the checked-in version of a stable claim ID. Older versions remain reconstructable from Git/build history; runtime replay compares persisted identity/version against the current registry but does not pretend the current build can execute or reconstruct an old claim body.

## Persisted recommendation lineage

New recommendation audits freeze only compact claim identity:

```ts
knowledgeLineage: Array<{ claimId: string; version: number }>;
```

Runtime policy carries stable IDs while evaluating a decision. `buildRecommendationAudit` resolves active registry versions once, de-duplicates and sorts them, and stores the snapshot. Historical v3 recommendations are deliberately not backfilled from today's coverage map because doing so would manufacture provenance that the old build never recorded. Knowledge drift is a replay diagnostic, not by itself evidence that the historical decision record is internally inconsistent.

`supersedes` is replacement lineage between claim IDs, not a substitute for the integer version of the same stable claim ID. Cycles are invalid and fail validation.

## Current limitations

The registry is intentionally small. It does not yet provide:

- complete coverage of all sports-science assumptions in the engine;
- athlete-specific learned evidence;
- automatic PubMed/Crossref/Cochrane literature ingestion or freshness monitoring;
- structured ROBIS/AMSTAR 2 appraisal records;
- formal GRADE assessments;
- overlap detection across systematic reviews/umbrella reviews;
- a knowledge graph or semantic search layer.

Those capabilities should be added only when a concrete consumer requires them.
