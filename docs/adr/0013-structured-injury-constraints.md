# ADR-0013: Structured Injury Constraints Are the Canonical Safety Input

* **Status:** Accepted
* **Decision date:** 2026-08-08
* **Recorded retroactively:** 2026-08-16
* **Deciders:** Core Engineering Team / repository owner
* **Source:** [Phase 1 — Live defects, work item 1.1](../plans/phase-1-live-defects.md)

> **Retroactive record.** The decision was explicitly taken and implemented in Phase 1,
> but the reserved ADR-0013 was never written. This ADR records that existing decision; it
> does not introduce a new injury policy or change current behavior.

## Context

The original engine had two incompatible injury channels:

* working manual template guardrails such as `avoid_high_impact`; and
* a free-text `UserContext.constraints.injuries: string[]` path that was effectively dead
  in production even though `rules.ts` and the optimizer appeared to use it.

That created a safety contradiction: simulations could exercise an injury filter that the
production context constructor never populated, while the persisted recommendation audit
could report a safety-restriction count of zero because the restriction source was not
actually wired.

Consolidating entirely onto manual guardrails would have removed the dead path, but it
would also have made several safety concepts inexpressible. A guardrail cannot directly
represent an unavailable modality such as Running, cannot carry an expiry/review date,
and cannot distinguish an acute injury constraint from a standing exercise preference.

Phase 1 therefore chose the structured model rather than deleting injury semantics.

## Decision

### D-INJ-CANON — `TrainingSettings.injuries` is the canonical persisted injury authority

Persist injury information as structured `InjuryConstraint[]` on `TrainingSettings`.
A constraint carries:

* optional `region: BodyRegion`;
* `severity: 'monitor' | 'limit' | 'exclude'`;
* optional `reviewBy` local ISO date;
* optional explicit `restrictedModalities` where the aggravating modality is known but a
  precise anatomical region is not;
* optional note for athlete-facing context.

There is no parallel persisted free-text injury source of truth. Engine-facing context
consumes **resolved restrictions**, not a second mutable copy of the original injury list.

### D-INJ-RESOLVE — one pure resolver owns structural restrictions

`injuryPolicy.ts` `resolveInjuryRestrictions` is the authority that converts active
`InjuryConstraint[]` into exact engine restrictions:

```ts
{
  restrictedModalities,
  impliedGuardrails,
  restrictedCategories,
}
```

Expired constraints (`reviewBy < today`) do not contribute restrictions.

`monitor` is observational and does not itself create a structural exclusion. `limit` and
`exclude` map through the repository-owned region policy, with `exclude` able to add harder
modality/category exclusions where defined.

The resolver is pure: no Firestore reads, UI state, or recommendation history is allowed to
change what the same injury input means for the same date.

### D-INJ-SEPARATION — injury is safety state, not preference

An injury restriction and an athlete dislike are different authorities.

* Injury-derived modality/category/guardrail restrictions participate in hard safety and
  eligibility filtering.
* `UserPreferences` modality likes/dislikes remain preference/ranking inputs and cannot
  remove an injury restriction.

Changing a preference must therefore never unlock a session that is excluded by the active
injury policy.

### D-INJ-MAP — region mappings are conservative engineering policy, not diagnosis

The repository maps structured regions to conservative restrictions. Current examples
include:

* knee / Achilles / ankle / calf -> high-impact guardrail; `exclude` also blocks Running;
* hamstring / quadriceps / adductor-groin / hip -> heavy-lower-body guardrail; `exclude`
  also blocks lower-/full-body strength categories;
* lower back -> heavy-spinal-loading guardrail, with stronger lower-body restriction at
  `exclude`;
* shoulder / elbow / wrist -> overhead-pressing guardrail; `exclude` also blocks the
  upper-body strength category.

These mappings are **product safety policy**, deliberately conservative and reviewable.
They are not a medical diagnosis, rehabilitation protocol, prognosis, or statement that
all injuries in one anatomical region require identical management. Clinical advice or an
explicit clinician-authored restriction remains higher authority than a generic mapping.

A future change to the meaning of these mappings is a safety-policy decision and should be
reviewed as such rather than hidden inside a refactor.

### D-INJ-LEGACY — legacy free text migrates in the safe direction

Legacy injury strings are converted one way into structured constraints by
`migrateLegacyInjuries`.

Direct anatomical tokens (`knee`, `achilles`, `ankle`) map to their corresponding regions.
Ambiguous legacy tokens that previously implied a Running restriction preserve at least
that restriction rather than inventing anatomical certainty:

* `leg` keeps an explicit Running restriction while using a conservative lower-limb region
  placeholder for migration visibility;
* `run` keeps the Running restriction without fabricating a body region.

Migration may conservatively over-restrict until the athlete clarifies the record; it must
not silently under-restrict relative to the legacy behavior.

### D-INJ-TISSUE — observed tissue response may tighten, never clear, a standing constraint

Later Phase 5 tissue-response work composes with this ADR rather than replacing it.
`resolveEffectiveInjuryConstraints` may derive a stricter **read-time** severity from the
athlete's observed tissue response for the current decision, but it is preserve-or-tighten:

* a good observation cannot clear an active standing `limit`/`exclude` constraint;
* an observed worse response may tighten the effective constraint;
* the derived result is not written back as the persisted injury authority.

Only an explicit owner action changes the standing persisted constraint.

## Consequences

### Positive

* Production and simulation use the same structured injury authority.
* Safety restrictions can express modality exclusions, category exclusions, guardrails,
  and review/expiry semantics without parsing prose at decision time.
* Injury state cannot be accidentally weakened by preference edits.
* Legacy ambiguous restrictions preserve their safety effect during migration.
* Tissue observations can make today's decision more conservative without becoming a
  second persisted injury source of truth.

### Negative

* The repository owns a conservative region-to-restriction table that needs deliberate
  review as the catalog and sports supported by the engine expand.
* Generic anatomical mappings can over-restrict an individual athlete; they cannot replace
  individualized clinical assessment.
* Structured migration cannot recover anatomical detail that was never present in legacy
  free text.

## References

* [`app/src/engine/injuryPolicy.ts`](../../app/src/engine/injuryPolicy.ts) — canonical
  restriction resolver, legacy migration, and preserve-or-tighten tissue composition.
* [`app/src/engine/models.ts`](../../app/src/engine/models.ts) — `InjuryConstraint`,
  `BodyRegion`, and related safety types.
* [`app/src/engine/eligibility.ts`](../../app/src/engine/eligibility.ts) — hard candidate
  eligibility consuming resolved safety restrictions/guardrails.
* [`app/src/engine/rules.ts`](../../app/src/engine/rules.ts) — daily readiness/safety
  envelope.
* [`docs/plans/phase-1-live-defects.md`](../plans/phase-1-live-defects.md) — original
  decision rationale and migration acceptance criteria.
