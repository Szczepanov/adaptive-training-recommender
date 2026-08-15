# ADR-0019: Externally-Authored Plans and Session Adjudication

* **Status:** Proposed
* **Date:** 2026-08-15
* **Deciders:** Repository owner
* **Source analysis:** [2026-08-15 externally-authored plan feasibility](../analysis/2026-08-15-externally-authored-plan-feasibility.md) (verified against `bfda040`)
* **Contract:** [External plan import schema](../external-plan-schema.md)

## Context

The athlete authors training plans with a general-purpose AI and prefers those plans to the
ones this engine generates. That preference is specific and defensible: an external AI is
better at macro structure, session variety, and natural-language specificity than a
27-entry `TEMPLATES` catalog ranked by `optimizer.ts` can be. It is not a rejection of the
engine — it is a rejection of one of the engine's two jobs.

The engine has two jobs, and they are already separate modules:

* **Selection** — `optimizer.ts` `rankCandidates`, `microcycle.ts`, `planSchedule.ts`,
  `weeklyAllocation.ts`, `evergreenPlanning.ts`. Chooses *which* session.
* **Adjudication** — `rules.ts` `evaluateReadinessAndSafetyEnvelope`, `eligibility.ts`,
  `injuryPolicy.ts`, `dose.ts` `resolveExecutionDose`, `fatigue.ts`. Decides whether a
  session is safe today and at what dose.

Adjudication takes `DailyReadiness` and `UserContext`. It has no plan parameter and no
knowledge of where a candidate came from. It is already source-agnostic, and it is the half
the athlete wants to keep.

The obstacle is not the readiness pipeline. It is that `Recommendation.template` is a
non-optional `SessionTemplate` and the identity of that template is load-bearing
downstream: `DailyRecommendation` persists `templateId`, `RecommendationAudit.candidateScores[]`
is keyed by it, `replay.ts` verifies against it, and `prescription.ts`
`resolveWorkoutPrescription` opens with `workoutForTemplate(recommendation.template.id)`,
returning `null` for anything absent from the `WORKOUTS` catalog. An imported session has
no catalog entry, so without intervention it produces no prescription and no replayable
audit.

A second obstacle is estimation. `systemicCost` gates the `modify` mode ceiling,
`costProfile` feeds fatigue projection, and `stimulusProfile` feeds objective credit. None
of the three exists on an imported session.

## Decision

### D-EXT — an external plan is a third planning mode, not a bypass

`PlanningMode` becomes `'evergreen' | 'event_directed' | 'externally_planned'`.
`planningMode.ts` `resolvePlanningContext` remains the single authority that resolves it,
and resolves `externally_planned` only when the profile selects it **and** a placed session
exists for the evaluation date. Otherwise the effective mode falls back to the athlete's
underlying mode, and the resulting recommendation is **labelled as a fallback**.

`evergreen` and `event_directed` are not removed, deprecated, or degraded. If the imported
experience proves better in practice the generated planner quietly becomes the fallback
path, which is a far cheaper way to learn that than a fork.

### D-CANDIDATE — an imported session is a candidate, never a prescription

Every imported session passes `evaluateTemplateEligibility`, the safety envelope, the
readiness mode ceiling, and the injury gate on exactly the terms a catalog template does.
When a gate excludes it, the app states which gate and offers the scaled or substituted
alternative. It never displays an unvetted session.

This is the property that distinguishes the application from reading the plan off a phone,
and it is not negotiable for the convenience of the import path.

### D-SHIM — imported sessions reach the engine through a synthetic template shim

Each imported session is adapted to a `SessionTemplate`-shaped record in a reserved id
namespace (`ext:{planId}:{revision}:{sessionId}`), with derived `systemicCost`,
`costProfile`, and `stimulusProfile`, and with the human-readable detail carried in a
parallel `externalPrescription` field on `Recommendation`.

The alternative — widening `Recommendation.template` to a union of catalog and external
sessions — is more honest in the type system and touches persistence, provenance, replay,
adherence, the planner, and the UI. The shim confines the change to one adapter and keeps
`POLICY_VERSION` replay coherent.

This is a deliberate trade of type-system purity for blast radius, recorded here so it is
not later mistaken for an oversight. Should a second consumer of non-catalog sessions ever
appear, the union becomes the correct answer and this decision should be revisited.

### D-EXTTIER — imported sessions join the existing evidence ladder

`completedTraining.ts` already ranks evidence quality with `EvidenceTier` and discounts
derived credit through `stimulus.ts` `CONFIDENCE_CREDIT_WEIGHT`, precisely for sessions
whose true content is uncertain. An imported session is the upstream twin of an unmatched
Garmin activity: structured, but not authored against this catalog.

A new `authoredExternal` rung is added to the ladder rather than a new estimation model.
Cost and stimulus are derived from `modality` × `intensity` × duration through the existing
`DEFAULT_COST_BY_MODALITY` / `DEFAULT_STIMULUS_BY_MODALITY` fallbacks.

**The schema deliberately does not accept a `systemicCost` input.** An AI asked for a
calibrated 0–1 load figure will supply a confident one, and it would silently move the
`modify`-mode ceiling. Derivation is conservative and auditable; supplied numbers are
neither.

### D-RELDATE — placement is relative, and the plan owns *what*, not *when*

Imported sessions carry a week index and a day *preference*. The plan header carries one
absolute date (`startDate`). The app resolves calendar placement.

This removes date arithmetic from the authoring AI, which is where LLM-generated plans most
reliably fail — an off-by-one weekday in a later week survives review and corrupts every
date after it. It also makes rescheduling a placement concern rather than a plan edit.

### D-IMMUT — the imported artifact is immutable; placement is a separate overlay

A stored plan revision is never edited in place. It is content-hashed, and the hash is
persisted on `RecommendationAudit` so a decision can be replayed against the exact bytes it
was made from (ADR-0010). Missed sessions and moves are written to a separate placement
overlay; AI adjustments arrive as a new revision that supersedes the previous one from a
chosen date forward.

Days already adjudicated keep their `daily_recommendations` documents and audits unchanged.
History is never rewritten by a re-import.

### D-NOTRAVEL — travel stays where it already is

Travel is excluded from the import schema. It remains an `AuthoredPlanBlock` at
`users/{userId}/plan_blocks/{blockId}`, applied by `applyPlanningOverlays` regardless of
plan source, with day-wide venue restriction handled by
`FixedActivity.availabilityContextOverride`.

Travel is the athlete's calendar, not the AI's plan. Keeping it separate means an AI
revision cannot overwrite trip dates, and a trip change does not require re-importing.
The authoring prompt correspondingly instructs the AI **not** to plan around travel —
otherwise its deload and the travel block's `volumeScale` would both apply, reducing dose
twice.

### D-CRITIQUE — the planning machinery is repointed, not retired

`microcycle.ts`'s objective ledger, `coverage.ts` `buildCoverageState`, `fatigue.ts`'s
projection, and the planner's spacing constraints stop *generating* the week in this mode
and start *reviewing* the imported one: unmet weekly objectives, hard sessions stacked too
closely, projected fatigue exceeding the tier ceiling, hard-lower-body spacing violations.
Advisory and non-blocking.

An external AI cannot produce this critique — it holds no fatigue state and no
adherence-reconciled history. This is the capability that makes the hybrid better than
either half, and it is the reason Phases 2–7 remain assets rather than dead weight in this
mode.

### D-NOPARSE — JSON only; no in-app model call in this phase

The import path accepts schema-conforming JSON. Parsing free-text plans with a model inside
the application is deferred: it requires a server-side proxy for the key, carries recurring
cost, and places a non-deterministic transform at the persistence boundary, which conflicts
with ADR-0010's replay contract. If built later it must parse *to* this schema and present
the result for confirmation, never write directly.

### Resolved schema questions

Settled to unblock implementation; each is cheap to revisit.

| Question | Decision | Reason |
|---|---|---|
| Week boundaries | Monday-based | Gives the authoring/import contract deterministic conventional training weeks. The engine's current microcycle is a rolling lookback anchored on the evaluation date, so the placement/critique adapter must translate between the two rather than treating them as the same window. |
| `objectives` tagging | Optional, with coarse derivation when absent, and a post-import prompt inviting confirmation | Requiring it hurts import reliability; omitting it degrades the D-CRITIQUE layer to a guess, so the app should ask rather than demand. |
| Performance targets | Free text (`"100–105% FTP"`) in this phase | Structured zones resolved against `AthletePerformanceProfile` are more useful downstream and materially less reliable to import. Revisit once the loop works. |
| Plan bounds | `weekCount ≤ 26`, `sessions ≤ 120` | Keeps the placement overlay a single small read. |
| Default supersession date | The evaluation date (today) | A revision the athlete just accepted should take effect now; deferring to next week makes mid-block corrections useless. |

## Consequences

**Positive.** The adjudication half of the engine is reused unchanged. Travel, fixed
activities, adherence capture, completed-training reconciliation, and the Python ingestion
pipeline are untouched. The generated planner remains available and becomes a labelled
fallback rather than being deleted. The critique layer is a capability neither the external
AI nor the previous system had.

**Negative.** The synthetic-template shim means `Recommendation.template` no longer always
refers to a real catalog entry, and any future reader must know that. Imported sessions
receive discounted objective credit by construction (D-EXTTIER), which is correct but will
make an imported week look less "covered" than an equivalent catalog week. A static plan
goes stale against adherence drift; nothing closes that loop automatically in this phase —
the context-brief export is the intended answer and is sequenced as follow-up work.

**Neutral.** `POLICY_VERSION` must be bumped; `check-policy-drift.mjs` enforces it.

## Alternatives considered

**Widen `Recommendation` to a union type.** Correct in the type system; rejected for blast
radius under D-SHIM. Revisit if a second non-catalog session source appears.

**Import into the existing catalog as user-authored `WorkoutDefinition`s.** Would reuse
`resolveWorkoutPrescription` unchanged. Rejected: `WORKOUTS` is validated by
`validate:workouts` as a curated, reviewed library with authored stimulus and cost profiles,
and admitting unvalidated per-athlete records into it would destroy the property that makes
the catalog trustworthy.

**Let the external plan bypass the gates.** Rejected under D-CANDIDATE. It would remove the
only thing the application does that reading the plan on a phone does not.

**Auto-adapt the imported plan when sessions are missed.** Rejected: it rebuilds the
planner this mode exists to replace. The declared per-session `ifMissed` intent plus athlete
confirmation is the bounded version of the same goal.

**Replace the generated planner entirely.** Rejected. Retaining both modes costs one union
member and preserves the ability to compare them on real use.