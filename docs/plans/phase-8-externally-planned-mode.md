# Phase 8: Externally-planned mode

* **Status:** In progress
* **Blocked by:** none — ADR-0019 accepted 2026-08-15
* **Unlocks:** context-brief export (the adherence feedback loop); structured performance targets
* **Source analysis:** [2026-08-15 externally-authored plan feasibility](../analysis/2026-08-15-externally-authored-plan-feasibility.md)
* **Contract:** [External plan import schema](../external-plan-schema.md)

## Goal

Add `externally_planned` as a third planning mode: import a plan authored outside the
system, adjudicate each of its sessions against that morning's readiness with the existing
safety pipeline, and repoint the weekly planning machinery from generating the week to
critiquing the imported one.

## Preconditions

* ADR-0019 accepted. Its decisions **D-EXT**, **D-CANDIDATE**, **D-SHIM**, **D-EXTTIER**,
  **D-RELDATE**, **D-IMMUT**, **D-NOTRAVEL**, **D-CRITIQUE**, **D-NOPARSE** are assumed by
  the work items below and must not be re-litigated during implementation.
* ~~The import schema has been exercised at least once end to end.~~ **Done 2026-08-15.**
  A 21-session, 4-week road-race block was generated from the published prompt block and
  validated: zero hard schema errors, and D-RELDATE's relative placement resolved to the
  athlete's real race date exactly. Three contract revisions followed — second-granular
  step durations, two-level repetition, and an explicit instruction not to encode
  autoregulation policy. See
  [the schema's round-trip section](../external-plan-schema.md#round-trip-result-2026-08-15).
  8.1 must build against the revised contract, not the original.

---

## Work items

### 8.1 Import contract, storage, and validation `[x]`

**Current behaviour.** No representation of an externally-authored plan exists.

**Change.** Add `ExternalTrainingPlan`, `ExternalPlanSession`, and `ExternalPlanPlacement`
to `engine/models.ts` per the published schema. Add `validateExternalTrainingPlan` and
`validateExternalPlanPlacement` to `validation.ts`, following the
`validateAuthoredPlanBlock` pattern: closed key sets, enum membership, numeric bounds,
`isValidDate`, and rejection of unrecognised fields.

Add `services/externalPlanService.ts` following `planBlockService.ts` — `DataState` returns,
owner check on every read, `INVALID` on schema failure rather than a silent skip.

Validation must reject an `isEvent` session that is not `flexibility: 'fixed'` with a
`preferredDay`, and must not silently create a `UserEvent` for one whose resolved date has
none — the import surfaces the mismatch for the athlete to link or create (**D-EVENT**).

Storage per ADR-0019:

| Path | Contents |
|---|---|
| `users/{userId}/external_plans/{planId}` | Header, `revision`, `contentHash`, `importedAt`, `supersededFrom`. |
| `users/{userId}/external_plans/{planId}/revisions/{revision}` | The imported document, verbatim and never edited. |
| `users/{userId}/external_plans/{planId}/placement/current` | `{ assignments: [{ sessionId, date, status }], updatedAt }`. |

Extend `firestore.rules` with owner-scoped matches enforcing the same shape independently
of client validation, matching the `hasValidPlanBlock` / `hasValidTrainingIntentProfile`
style. Revisions are create-only: no update, no delete.

`contentHash` is SHA-256 over the canonical JSON of the revision document.

**Done when** a conforming plan round-trips through import, storage, and read; a
non-conforming plan is rejected with a field-level error and stores nothing; a revision
document cannot be updated or deleted through the rules; and `npm run test:rules` covers
owner isolation and the create-only revision constraint.

---

### 8.2 Widen the eligibility gate to a structural session interface `[x]`

**Current behaviour.** `eligibility.ts` `evaluateTemplateEligibility` and
`eligibleTemplates` take `SessionTemplate` and read `durationMin`/`durationMax`,
`requiredEquipment`, `environment`, and `safetyTags`.

**Change.** Extract a `GateableSession` interface carrying exactly those fields plus
`modality`, `category`, and `systemicCost`, and widen both functions to it. `SessionTemplate`
satisfies it structurally with no change at any existing call site.

This is the highest-leverage change in the plan and should land before 8.3. Keep it a pure
widening — **no behaviour change, no new gate, no reordering**. `npm run simulate:diff`
must report no semantic change.

**Done when** both functions accept `GateableSession`, every existing caller compiles
unchanged, and `simulate:diff` reports no changed baseline scenario.

---

### 8.3 Session adjudication `[x]`

**Current behaviour.** Selection and adjudication are entangled in
`rules.ts` `evaluateTrainingWithIntent`: candidates are filtered, then ranked, then the
winner is dosed.

**Change.** Add `engine/externalSession.ts` exporting:

```ts
adjudicateExternalSession(
  session: ExternalPlanSession,
  readiness: DailyReadiness,
  context: UserContext,
  envelopeState: ReturnType<typeof evaluateReadinessAndSafetyEnvelope>,
  plannedDose: PlannedDose,
  date: string,
): ExternalSessionVerdict
```

`ExternalSessionVerdict` carries
`{ decision: 'proceed' | 'scale' | 'defer' | 'skip' | 'advisory', executionDose?, scaledSummary?, fallbackSuggestion?, gateFailures: EligibilityReason[], rationale }`.

Ordering follows the authority ordering in
[`architecture/recommendation-engine.md`](../architecture/recommendation-engine.md) and adds
nothing to it:

1. clinical / safety gates → `skip` with the failing reason
2. feasibility (`evaluateTemplateEligibility` via 8.2) → `skip`; copy
   `scaling.fallback` to `fallbackSuggestion` when present, but keep it advisory only
3. readiness mode ceiling → `recover` mode yields `defer` or `skip`; `modify` yields `scale`
   when the session exceeds `MODIFY_MAX_SYSTEMIC_COST`
4. dose → `resolveExecutionDose` intersects planned dose with the clinical ceiling; when the
   result falls below `scaling.minimumUsefulDurationMin`, escalate `scale` → `defer`

An `isEvent: true` session short-circuits this ladder entirely (ADR-0019 **D-EVENT**): it
returns `advisory` with the failing gates named and never `skip`/`defer`/`scale`. A
session with `scaling.reducible === false` skips step 4's scaling branch and escalates
straight to `defer` (**D-IRREDUCIBLE**) — `reducedSummary` is not consulted.

`scaling.fallback` is deliberately free text in the import contract, so it is **not a
GateableSession and can never become an actionable substitute by itself**. If the product
shows an alternative session after an external session is excluded, 8.6 obtains that
alternative through the existing ranked recommendation path, which subjects it to the
normal safety and feasibility gates and labels it as a fallback. The author text may be
shown alongside the skip as intent/context, not as an instruction to execute.

Reuse `evaluateReadinessAndSafetyEnvelope` and `resolveExecutionDose` **unchanged**. The
function is pure and synchronous; it must not read Firestore.

The `scale` decision uses the session's own authored `scaling.reducedSummary` rather than a
duration multiplier — this is the external equivalent of the catalog's `DoseVariation`.

**Done when** each of the five decisions is reachable and unit-tested at its boundary, the
function performs no I/O, a session failing a hard gate can never return `proceed`, a
free-text fallback can never be returned as an actionable recommendation, an `isEvent`
session can never return `skip` or `defer` under any readiness, and a `reducible: false`
session can never return `scale`.

---

### 8.4 Cost, stimulus, and the synthetic template shim `[x]`

**Current behaviour.** `completedTraining.ts` derives cost and stimulus for unmatched
sessions via `DEFAULT_COST_BY_MODALITY` / `DEFAULT_STIMULUS_BY_MODALITY`, discounted through
`CONFIDENCE_CREDIT_WEIGHT` by `EvidenceTier`.

**Change.** Add an `authoredExternal` rung to `EvidenceTier` between
`exactPrescribedMatch` and `durationIntensity`, with its `stimulusConfidenceForTier` mapping
(`'inferred'`). Add `deriveExternalSessionProfiles` producing `systemicCost`, `costProfile`,
and `stimulusProfile` from `modality` × `intensity` × duration through the existing
fallbacks — **no new estimation model, and no accepted cost input** (D-EXTTIER).

Add `toSyntheticTemplate(session, planId, revision): SessionTemplate` in the reserved id
namespace `ext:{planId}:{revision}:{sessionId}`, and an `externalPrescription` field on
`Recommendation` carrying the imported `prescription` block for display.

`prescription.ts` `resolveWorkoutPrescription` returns `null` for a synthetic id today and
must continue to — the UI reads `externalPrescription` instead. Do **not** teach
`workoutForTemplate` about synthetic ids.

**Done when** a synthetic template passes `validate:workouts`-equivalent shape checks in a
unit test, credit derived for an imported session is strictly below the same session's
credit as an exact catalog match, and no synthetic id reaches the `WORKOUTS` catalog.

---

### 8.5 Placement resolution and rescheduling `[x]`

**Current behaviour.** No placement layer exists.

**Change.** Add `engine/externalPlacement.ts`:

* `resolvePlacement(plan, overlay, weekStart)` — maps sessions to dates from `startDate`,
  `placement.week`, `preferredDay`, and `flexibility`, with the overlay winning on conflict.
* `proposeReplacement(plan, overlay, missedSessionId, date)` — applies the session's own
  `ifMissed` (`drop` / `reschedule_within_week` / `carry_forward`) and `priority`, returning
  a **proposal**, never a committed write.

Placement respects `FixedActivity` occupancy and the athlete's availability profile. It does
not re-rank, re-select, or substitute sessions — placement moves a session in time and does
nothing else (D-EXT keeps selection with the external author).

The app proposes; the athlete confirms. No silent re-placement, consistent with the
fallback-labelling posture everywhere else in the engine.

**Done when** a `fixed` session never moves off its `preferredDay`; a `drop` session is not
proposed for re-placement; `carry_forward` can cross a week boundary while
`reschedule_within_week` cannot; and no code path writes the overlay without an explicit
confirmation argument.

---

### 8.6 Planning-mode wiring `[x]`

**Current behaviour.** `planningMode.ts` `resolvePlanningContext` resolves `evergreen` or
`event_directed`. `rules.ts` `evaluateTrainingWithIntent` always ranks candidates.

**Change.** Extend the `PlanningMode` union and `validateTrainingIntentProfile`'s accepted
values (and the matching `firestore.rules` enum). Teach `resolvePlanningContext` to return
`externally_planned` only when the profile selects it **and** a placed session exists for
the date.

In `evaluateTrainingWithIntent`, branch after intent resolution: in external mode, adjudicate
via 8.3 instead of calling `rankCandidates`. **Intent still resolves fully** — periodization,
microcycle, and fatigue are consumed by 8.7.

When the mode is selected but no session is placed for the date, fall back to the normal
ranked pick and mark the recommendation as a fallback in its rationale. Never silent.
When a placed external session is excluded and the UI needs an actionable alternative,
invoke that same normal ranked path as a **separate labelled fallback**. Never promote the
external plan's free-text `scaling.fallback` into a recommendation; the ranked alternative
must survive the usual gates independently.

**Done when** an athlete with no external plan is bit-identical to today (`simulate:diff`
clean), a placed session produces an adjudicated recommendation, an unplaced date produces
a labelled fallback, and an excluded external session can only surface an actionable
replacement that has passed the normal recommendation pipeline.

---

### 8.7 Weekly critique layer `[ ]`

**Current behaviour.** `microcycle.ts`, `coverage.ts`, and `planner.ts` generate and
forward-project the week.

**Change.** Add `engine/externalCritique.ts` producing non-blocking findings over the placed
week, reusing existing evaluators rather than reimplementing them:

| Finding | Source |
|---|---|
| Unmet weekly objective | `microcycle.ts` ledger + `getUnresolvedObjectivesV2` |
| Projected fatigue exceeds tier ceiling | `planner.ts` `evaluateProjectedDate` |
| Quality-spacing / hard-lower-body violation | `optimizer.ts` recovery constraints |
| Weekly session count outside commitment | `TrainingIntentProfile.weeklyCommitment` |

Each finding names the date and session and states the rule. Advisory only: it must not
alter a verdict (D-CRITIQUE).

This is the item that keeps Phases 2–7 load-bearing in this mode. It is core scope, not
polish, and should not be deferred to make room for UI work.

**Done when** each finding type is produced by a scenario fixture that triggers it, and no
critique path can change an `ExternalSessionVerdict`.

---

### 8.8 Provenance and replay `[ ]`

**Current behaviour.** `RecommendationAudit` records `policyVersion`, envelope summary,
doses, and `candidateScores`. `replay.ts` verifies a persisted decision against it.

**Change.** Add `externalPlan?: { planId, revision, sessionId, contentHash }` to
`RecommendationAudit` and populate it in `provenance.ts` `buildRecommendationAudit`. Teach
`replay.ts` to verify an external decision against the referenced revision and to fail
loudly on a `contentHash` mismatch — a plan re-imported under the same revision must not
replay as if unchanged.

Bump `POLICY_VERSION` and move the outgoing value into `HISTORICAL_POLICY_VERSIONS`.

**Done when** an external recommendation replays reproducibly, a mutated revision fails
replay with a distinct hash-mismatch reason, and `check-policy-drift.mjs` passes.

---

### 8.9 UI `[ ]`

**Current behaviour.** `Home.tsx` renders the engine's pick and its prescription;
`AdherencePrompt.tsx` captures adherence.

**Change.**

* **Import screen** — paste JSON → validate → preview (weeks, sessions, gate conflicts
  against current settings) → confirm. On re-import of an existing `planId`, show a diff
  (added / removed / moved) before accepting supersession.
* **Home** — today's imported session, its verdict banner (`proceed` / `scale` / `defer` /
  `skip`), the failing gate in plain language when excluded, and the
  `externalPrescription` detail. A free-text fallback suggestion is visually advisory;
  any actionable engine fallback is displayed separately and labelled as such.
* **Week-ahead strip** — placed sessions plus 8.7 findings.
* **Missed session** — the 8.5 proposal, with accept / choose another day / drop.
* **Post-import prompt** — invite confirmation of derived `objectives` tags for sessions
  that omitted them (ADR-0019 resolved-questions table).

Adherence is unchanged: `DailyRecommendation` already carries what the prompt needs once
the synthetic template id is persisted.

**Done when** a plan can be imported, reviewed, and adjudicated daily without leaving the
app, an excluded session always shows which gate excluded it, and no free-text fallback is
rendered as an executable session.

---

## Tests to add

| Area | Behaviour asserted |
|---|---|
| `validation` | Unknown field, bad enum, `startDate` not a Monday, `weekCount`/`sessions` over bounds, `durationMin > durationMax` all rejected with field-level errors. |
| `firestore.rules` (emulator) | Cross-user read/write denied; revision documents create-only; placement writes keep ownership. |
| `eligibility` | `GateableSession` widening is behaviour-neutral for every existing template. |
| `externalSession` | Each of the five verdicts at its boundary; hard-gate failure can never yield `proceed`; below `minimumUsefulDurationMin` escalates to `defer`; free-text fallback remains advisory. |
| `externalSession` (property) | For **any** readiness input, an `isEvent` session returns `advisory` — never `skip`, `defer` or `scale` (D-EVENT). |
| `externalSession` (property) | For **any** readiness input, a `reducible: false` session never returns `scale`, and its `reducedSummary` is never read (D-IRREDUCIBLE). |
| `externalSession` | Injury constraint and `painFlag` exclude an imported session exactly as they exclude a catalog template. |
| `completedTraining` | `authoredExternal` credit is strictly below `exactPrescribedMatch` for the same session. |
| `externalPlacement` | `fixed` never moves; `drop` never re-proposed; `carry_forward` crosses a week, `reschedule_within_week` does not; no write without confirmation. |
| `planningMode` | External mode resolves only with a placed session; unplaced or excluded dates use only a separately gated, labelled fallback when one is shown. |
| `externalCritique` | Each finding type triggers on a fixture; no critique alters a verdict. |
| `replay` | External decision replays reproducibly; mutated revision fails with hash mismatch. |
| `architecture` | No production import of `externalSession.ts` from `optimizer.ts` or `planner.ts` — adjudication must not become a second ranking path. |
| `simulate:diff` | No semantic change for athletes without an external plan. |

## Acceptance criteria

- [ ] `npm run check` and `npm run test:rules` pass.
- [ ] `npm run simulate:diff` reports no changed pre-existing baseline scenario.
- [ ] A plan generated by the athlete's own AI from the published prompt block imports without hand-editing.
- [ ] An imported session that fails a hard gate is never displayed as actionable, and names its failing gate.
- [ ] A free-text imported fallback is never displayed as actionable; any actionable replacement has independently passed the normal gates.
- [ ] An imported session receives strictly less objective credit than the same session as an exact catalog match.
- [ ] A missed session produces a proposal, never a silent re-placement.
- [ ] A re-import supersedes forward only; a previously adjudicated day's persisted recommendation and audit are byte-identical after it.
- [ ] An external recommendation replays reproducibly; a mutated revision fails replay with a hash-mismatch reason.
- [ ] `check-policy-drift.mjs` passes with the bumped `POLICY_VERSION`.
- [ ] Travel dose reduction is applied exactly once (by the `AuthoredPlanBlock`), verified on a fixture where a travel block overlaps imported sessions.

## Risks & rollback

| Risk | Mitigation |
|---|---|
| The schema does not survive contact with a real generated plan. | The precondition requires one before 8.1. Expect schema revision; the `schema` version tag exists for it. |
| The synthetic shim leaks into the catalog and corrupts `validate:workouts`. | Reserved `ext:` namespace, an architecture test asserting no synthetic id reaches `WORKOUTS`, and `workoutForTemplate` deliberately left unaware of it (8.4). |
| Adjudication drifts into a second ranking path. | Architecture test in the table above; `externalSession.ts` is pure and does no I/O. |
| A free-text fallback bypasses eligibility/safety because it looks like a substitute. | It is advisory-only by contract; actionable replacements come from the separately gated normal recommendation path. |
| Derived cost under-states a hard imported session, weakening the `modify` ceiling. | Derivation is conservative by construction; the fixture set must include a hard imported session on a `modify` day. |
| The imported plan goes stale against adherence drift. | Accepted for this phase (ADR-0019 consequences). The context-brief export is the sequenced follow-up and should not be dropped. |

**Rollback.** The mode is additive. Setting `planningMode` back to `evergreen` or
`event_directed` restores previous behaviour completely; stored plans become inert data. No
migration is required, and no existing document shape changes — only `RecommendationAudit`
gains an optional field.

## Out of scope

* In-app LLM parsing of free-text plans (D-NOPARSE).
* Imported sessions participating in `weeklyAllocation.ts` role reservation or
  `sequenceSearch.ts`.
* A plan-authoring UI beyond import, accept/reject, dose adjustment, and re-placement.
* Garmin workout export for imported sessions.
* Automatic adaptation of an imported plan (ADR-0019 alternatives).
* Structured performance targets resolved against `AthletePerformanceProfile` — deferred by
  the ADR's resolved-questions table.
* The context-brief export. Sequenced immediately after this phase; it is what turns the
  hybrid into a loop.

## Docs to update

* [ ] ADR-0019 → `Accepted` once the design is agreed.
* [ ] `architecture/recommendation-engine.md` — a third planning mode and the adjudication
      path; the authority ordering gains no new step but now has a second entry point.
* [ ] `external-plan-schema.md` — drop the proposal banner; record any schema change forced
      by the precondition round-trip.
* [ ] `docs/README.md` and `plans/README.md` — index rows and decision-register entries.
* [ ] `AGENTS.md` — `engine/` package map gains `externalSession.ts`, `externalPlacement.ts`,
      `externalCritique.ts`.

---

## Task board

| # | Task | Status | Blocked by |
|---|---|:--:|---|
| 8.1 | Import contract, storage, validation | `[x]` | — |
| 8.2 | Widen eligibility to `GateableSession` | `[x]` | — |
| 8.3 | Session adjudication | `[x]` | — |
| 8.4 | Cost, stimulus, synthetic shim | `[x]` | — |
| 8.5 | Placement and rescheduling | `[x]` | — |
| 8.6 | Planning-mode wiring | `[x]` | — |
| 8.7 | Weekly critique layer | `[ ]` | 8.6 |
| 8.8 | Provenance and replay | `[ ]` | 8.6 |
| 8.9 | UI | `[ ]` | 8.6 (import screen may start after 8.1) |

8.2 is startable immediately once the ADR is accepted and is deliberately independent of
the schema — it is a pure widening with no external-plan dependency.