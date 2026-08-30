# 2026-08-30 Sports Knowledge Registry Analysis

## Question

Should the application maintain tiers of verified/known sports knowledge so feature work can reference a stable evidence basis?

## Finding

Yes, but a single tier or confidence score is too lossy. The reusable unit should be an atomic, versioned claim with separate dimensions for scientific certainty, product maturity, lifecycle status, source directness, applicability, recommendation strength and safety impact.

This analysis led to ADR-0033 and the initial `app/src/knowledge/sportsKnowledge.ts` registry.

## Repository evidence

Before this change the codebase already contained two distinct evidence concepts:

- `decisionEvidence.ts` represented runtime evidence about the athlete and a specific morning decision;
- `evergreenStrategy.ts` embedded source/population/outcome/confidence/applicability provenance directly inside one policy module.

The second pattern showed the right intent but did not provide reusable claim IDs, lifecycle/versioning or cross-feature validation.

## External evidence-model research

### WHO/GRADE distinction

WHO's guideline-development process uses GRADE to separate certainty of evidence from recommendation strength. The WHO 2020 physical-activity guideline demonstrates why the product should preserve that separation: the adult aerobic-volume and muscle-strengthening recommendations are **strong recommendations based on moderate-certainty evidence**.

That means a field such as `confidence=high` cannot safely serve as both "strong recommendation" and "high scientific certainty".

GRADE also makes an important implementation point for this registry: certainty is a judgment about a **body of evidence for a question/outcome**, not a value that can be mechanically inferred from a source's study-design label. A source type such as `systematic_review` or `randomized_trial` is therefore metadata; it must not automatically set `evidenceCertainty`.

Sources:

- https://www.who.int/publications/i/item/9789240015128
- https://www.who.int/publications/i/item/9789241548960
- https://www.ncbi.nlm.nih.gov/books/NBK566046/

### Oxford CEBM distinction

The Oxford Centre for Evidence-Based Medicine explicitly varies the likely best evidence according to the question (intervention benefit, prognosis, diagnosis, harms, etc.) and warns that evidence levels are a search/decision heuristic rather than a definitive recommendation engine.

This supports keeping `claimType` separate from source type and scientific certainty. It also argues against implementing a universal numeric "evidence tier" that would rank every sports-science proposition the same way regardless of the question being asked.

Source:

- https://www.cebm.ox.ac.uk/resources/levels-of-evidence/levels-of-evidence-introductory-document

## Concrete provenance defect discovered during migration

The previous Evergreen strength provenance attached WHO guidance to the full target `{ minimum: 2, target: 2, maximum: 3 }`.

WHO directly supports muscle-strengthening activity on **2 or more days per week** for adults. It does not establish three sessions as a scientific maximum or optimum. The migration therefore separates:

- the WHO-backed >=2-day health-frequency claim; and
- the product's `maximum: 3` allocation default as an explicit `product_policy` heuristic.

The numeric training behavior is unchanged; only the knowledge lineage becomes more honest.

## Review hardening findings

The first implementation review identified three structural failure modes that would weaken the knowledge-control boundary even if the checked-in seed data were valid:

1. **Circular replacement lineage.** Referential integrity alone allows `A.supersedes=B` and `B.supersedes=A`. The validator now traverses replacement lineage and rejects cycles.
2. **Shape-valid but impossible dates.** A regular expression alone accepts values such as `2026-02-30`. Review/publication dates now require an actual Gregorian calendar date while remaining timezone-independent.
3. **Internal policy masquerading as scientific support.** A claim could previously carry `moderate`/`high` scientific certainty while all linked sources were `product_policy`. Scientific certainty now requires at least one non-product-policy source, while `maturity=heuristic` requires an explicit product-policy source for the product decision itself.

The third guard is deliberately asymmetric. It does **not** infer certainty from study design and it does not prevent a product heuristic from also citing external research as indirect/contextual support. It only prevents an internal policy document from being the sole basis for a scientific-certainty label.

These are structural integrity rules, not automatic evidence appraisal. Human review is still responsible for whether sources actually support the registered statement, whether directness is classified correctly, and whether the evidence body was searched adequately.

## Architectural conclusion

Use a demand-driven Git-backed Sports Knowledge Registry:

```text
KnowledgeSource(s)
      -> KnowledgeClaim (stable id + version)
      -> policy/rule knowledgeRefs
      -> recommendation

athlete measurements/history
      -> decision evidence
      -> policy/rule
```

Do not preload a universal sports ontology. Add a claim when application behavior, validation or explanation depends on it.

## Initial scope

The first migration covers only existing Evergreen assumptions:

1. adult aerobic weekly health volume — WHO 2020;
2. adult strength weekly health frequency — WHO 2020;
3. three-session strength upper target — explicit product heuristic;
4. conditional one-to-two high-intensity weekly prior — explicit product heuristic.

Future high-value migrations should target readiness interpretation, hard-session density, progression/load management, tapering, fueling, strength-performance prescriptions and injury/safety rules.
