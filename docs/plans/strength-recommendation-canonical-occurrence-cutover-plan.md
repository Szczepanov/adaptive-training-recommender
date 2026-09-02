# Canonical strength occurrence -> recommendation credit cutover

**Status:** In Progress (PR 1 & PR 2 implemented)
**Motivating incident:** 2026-09-01 strength session followed by a 2026-09-02 duplicate full-body-strength recommendation
**Depends on:** ADR-0016, ADR-0023, ADR-0034; PR #321 and PR #324

## Goal

Make performed-training evidence used by the recommender consistent with the canonical Activities/history model, so a strength session logged in the app and/or Garmin:

- is represented once;
- affects next-session spacing even when its exact catalog identity is uncertain;
- earns exact weekly `primary_strength` credit only when semantics justify it;
- preserves app-side sets/reps/load/RPE/rest when available;
- uses Garmin telemetry as enrichment rather than a second dose;
- updates recommendations after late-arriving performed-training evidence.

The first production target is the reported case:

> A 77-minute `strength_training` activity on 2026-09-01, with richer app-side strength logging for the same physical session, must prevent the 2026-09-02 recommender from choosing another full-body strength session merely because weekly full-body coverage appears unfilled.

---

## Non-goals

This work should **not**:

- treat every Garmin `strength_training` activity as the exact catalog workout `strength_full_body_maintenance_01`;
- infer reliable hard-set count or tonnage from sparse Garmin exercise-set timing;
- reinterpret Garmin Training Effect or Garmin training load as resistance-training volume;
- replace ADR-0034 with a new strength-specific matcher;
- weaken source-link uniqueness or sticky manual reconciliation decisions;
- require destructive bulk migration of all historical legacy strength documents;
- redesign the structured-strength UI introduced by #321;
- introduce a general ML exercise classifier as a prerequisite for fixing this incident.

---

# Target architecture

## Current live path

```text
Garmin activities ---------------------> completedTraining.ts -----> recommendation facts
                                                ^
DailyRecommendation.adherence ----------|

SessionExecution / legacy StrengthSession -----X
PerformedTrainingOccurrence ------------------X
```

`reconcileCompletedTrainingEvents()` performs a second, recommendation-specific date/modality/duration reconciliation independent of ADR-0034.

## Target path

```text
legacy StrengthSession --legacy adapter--\
SessionExecution -------------------------> ADR-0034 source reconciliation
Garmin/provider activity ----------------/             |
                                                       v
                                           PerformedTrainingOccurrence
                                                       |
                                  +--------------------+-------------------+
                                  |                                        |
                                  v                                        v
                         exposure / spacing facts                  weekly role credit
                                  |                                        |
                                  +--------------------+-------------------+
                                                       v
                                                recommendation engine
```

The canonical occurrence answers **which source records describe the same physical workout**. A recommendation-specific fact builder then answers **what programming facts can safely be derived from that occurrence**.

---

# Core design decisions

## D1. Separate recency from role fulfillment

Create two independent derived concepts.

### 1. `PerformedExposureFact`

Broad fact used for spacing/recovery and recent-history reasoning.

Suggested minimum type:

```ts
export interface PerformedExposureFact {
  performedOccurrenceId: string;
  localDate: string;
  startedAt?: string;
  endedAt?: string;
  modality: SessionTemplate['modality'] | 'Unknown';
  confidence: 'exact' | 'high' | 'inferred' | 'unknown';
  sourceKinds: Array<'structured_execution' | 'provider_activity' | 'legacy_strength'>;
  evidenceTier: EvidenceTier;
}
```

For strength, a canonical occurrence whose trusted source says `strength_training`/Strength is enough to emit a recent strength exposure. Exact catalog identity is not required.

### 2. `CoverageCreditFact`

Narrow fact used by weekly role accounting.

Suggested shape:

```ts
export interface CoverageCreditFact {
  performedOccurrenceId: string;
  coverageSetId: CoverageSetId;
  coverageKey: PlanCoverageKey;
  workoutId?: string;
  creditKind: 'exact' | 'semantic_confident' | 'none';
  confidence: number;
  reasonCode:
    | 'exact_workout_identity'
    | 'semantic_classifier'
    | 'generic_modality_only'
    | 'insufficient_detail'
    | 'conflicting_semantics';
  sourceKinds: string[];
}
```

Initial rollout should grant `primary_strength` only for exact known workout identities already declared in the relevant coverage set. `semantic_confident` can remain disabled until an explicit policy is authored.

**Why:** an unclassified strength workout can be recent enough to make another full-body session undesirable while still not being semantically equivalent to the planner's exact full-body role.

---

## D2. Canonical occurrence is the only deduplication identity consumed downstream

Recommendation code must not rematch Garmin to adherence/session execution using a separate heuristic after ADR-0034 has already linked sources.

The legacy `reconcileCompletedTrainingEvents()` function can temporarily remain behind a dual-read/parity path, but the canonical side must never invoke its date/modality/duration matcher.

This preserves:

- one physical workout -> one occurrence;
- Garmin re-sync idempotency;
- multiple true same-day sessions;
- manual link/unlink decisions;
- merge audit history.

---

## D3. Reuse `legacyStrengthAdapter.ts`; do not invent another migration model

For pre-#321 strength records, reuse:

```ts
adaptStrengthSessionToNormalizedExecution(session)
```

That adapter already preserves the historical app detail needed for strength semantics.

Implementation must add/read legacy strength records through the occurrence/fact hydration path without destructively rewriting all history.

Important limitation: the adapter emits a generic `legacy_strength` session source. Therefore it proves execution detail, but it does not automatically prove `strength_full_body_maintenance_01` identity.

Exact role identity should be recovered only from durable evidence already present elsewhere, for example:

- an explicit `SessionExecution.sessionSource` workout id;
- a `sessionOccurrenceId` / prescription link;
- recommendation/adherence metadata that names the exact workout;
- another deterministic persisted relation defined by an ADR/test.

If no such link exists, preserve `workoutId = undefined` and still emit recent-strength exposure.

---

## D4. Field-level source precedence

Use this policy in recommendation hydration/fact derivation.

| Domain field | Authority / precedence |
|---|---|
| physical occurrence identity | ADR-0034 canonical occurrence |
| prescribed workout/template identity | structured execution / persisted recommendation link |
| exercise identity | structured/app entry first |
| sets/reps/load | structured/app entry first |
| session/set RPE, rest events | structured/app first |
| completion state | structured execution when available; otherwise trustworthy provider completion evidence |
| canonical modality | structured execution first, provider fallback |
| elapsed start/end/duration | structured timeline for session-of-record; provider telemetry available as enrichment |
| HR/device/sensor metrics | Garmin/provider |
| Garmin exercise sets | diagnostic fallback; never override structured app detail |
| weekly exact role credit | semantic identity policy, not provider modality alone |
| recent strength exposure | canonical occurrence + trustworthy modality |

This matches the direction already encoded by `projectionBuilder.ts` and `activitiesReadModelService.ts`.

---

## D5. Sparse Garmin strength means “strength happened,” not “we know its full dose”

For the production fixture:

```text
type = strength_training
duration = 77 min
TE aerobic = 0.2
TE anaerobic = 0
activityTrainingLoad ~= 2.9
15 sparse exercise-set rows
```

Policy:

- map modality to Strength;
- emit recent-strength exposure with provider provenance;
- retain elapsed duration as observed duration;
- do not derive hard-set count from row count;
- do not use Garmin TE/load to reduce the occurrence to “negligible strength”;
- do not infer `primary_strength` solely from modality;
- if matching app detail exists, use app detail for semantic/dose derivation.

---

## D6. Recommendation invalidation is part of correctness

A canonical occurrence change inside the active recommendation history horizon must invalidate affected derived facts/recommendation snapshots.

Events that require invalidation:

- new occurrence created;
- provider source attached;
- structured source attached;
- two occurrences merged;
- manual unlink/keep-separate;
- app execution materially edited/completed;
- legacy strength record appears/changes;
- source deletion/tombstone if supported;
- occurrence local performed date/modality changes after reconciliation.

Use the athlete-local performed date/time to determine the affected window, never `syncedAt`.

A simple initial implementation can store/compare a `trainingHistoryRevision` or occurrence `updatedAt` watermark in the recommendation fact snapshot. If the latest relevant occurrence revision exceeds the snapshot watermark, recompute before returning a cached recommendation.

---

# Proposed implementation sequence

The work is intentionally split so the lowest-risk correctness improvement lands first.

## PR 1 — Canonical exposure facts + dual-read diagnostics

### Purpose

Make canonical occurrences consumable by recommendation code without yet changing weekly role credit.

### Code targets

Add a focused module, e.g.:

- `app/src/engine/performedTrainingFacts.ts`
- `app/src/engine/performedTrainingFacts.test.ts`

It should depend on:

- `app/src/training-occurrence/repository.ts` / canonical range query;
- `app/src/training-occurrence/models.ts`;
- `app/src/services/sessionExecutionService.ts` where structured hydration is needed;
- existing Garmin/activity service only to hydrate provider metrics by **attached activity id**, not to rematch;
- `app/src/sessions/legacyStrengthAdapter.ts` for historical app strength detail where the current storage path requires read-through.

### API

Prefer one range-oriented API so all recommendation consumers see one consistent snapshot:

```ts
getPerformedTrainingFactsInRange(userId, fromLocalDate, toLocalDateExclusive)
  -> {
       exposures: PerformedExposureFact[];
       coverageCredits: CoverageCreditFact[];
       revision: string;
     }
```

### Behavior

- one fact set per active canonical occurrence;
- provider sources are hydrated by their explicit sourceRefs;
- structured execution semantics win;
- generic provider strength creates broad Strength exposure;
- no change to production selection yet;
- compare canonical exposure counts/modality/date/identity with the legacy completed-training output;
- emit structured mismatch counters, not noisy per-session logs by default.

### Required tests

- Garmin-only strength -> one Strength exposure;
- structured strength + Garmin -> one exposure, not two;
- re-sync same Garmin id -> unchanged exposure count;
- two same-day real sessions -> two exposures;
- occurrence manual keep-separate -> remains two;
- merged occurrence -> only survivor produces live facts;
- local date / midnight boundary.

---

## PR 2 — Cut recent-load/spacing to canonical exposure facts

### Purpose

Fix the reported next-day duplicate-strength risk without changing exact weekly-role semantics.

### Changes

Find all recommendation eligibility/spacing logic that currently derives “recent strength” from legacy `CompletedTrainingEvent`/history. Route it to `PerformedExposureFact`.

Add a named policy instead of embedding a one-off check in the full-body workout selector, for example:

```ts
strengthSpacingStatus(exposures, now, candidate)
```

The policy should consider:

- most recent completed Strength exposure;
- elapsed/local days since exposure;
- candidate lower-body/systemic/neuromuscular cost;
- existing readiness/tissue gates;
- whether candidate is a recovery-safe/upper-only exception.

Exact spacing thresholds should come from existing planner/recovery policy if already defined; this PR must not invent a new sports-science constant merely to pass the fixture. If no explicit threshold exists, author that policy separately and make it configurable/tested.

### Production acceptance for the incident

Given a 2026-09-01 canonical Strength occurrence, the 2026-09-02 engine must not choose `strength_full_body_maintenance_01` / reduced full-body strength **solely to close an unfulfilled weekly strength role** while ignoring the recent exposure.

If another policy deliberately chooses strength despite the recent exposure, rationale must explicitly show that override; a weekly-target reason alone is insufficient.

### Required regression tests

- previous-day Garmin-only strength suppresses/down-ranks duplicate full-body candidate;
- previous-day app-only structured strength does the same;
- matching app + Garmin remains one exposure;
- upper-body/trunk conditional alternative is not incorrectly treated as equivalent to full-body role;
- cycling/running recent-exposure behavior remains unchanged.

---

## PR 3 — Cut weekly coverage credit to canonical semantic identity

### Purpose

Make `Weekly Stimulus Target (Full-body Strength)` derive from the same occurrence truth while preserving exact coverage semantics.

### Algorithm

For each active canonical occurrence:

1. Resolve attached structured execution, if any.
2. Resolve exact workout/prescription identity from `SessionExecution.sessionSource`, `sessionOccurrenceId`, prescription hash, or persisted recommendation link.
3. Look up the active `CoverageSetDescriptor`.
4. Grant each matching role once per occurrence.
5. If only generic modality is known, emit `creditKind='none'` with `reasonCode='generic_modality_only'`.
6. Never award the same role twice because both Garmin and app sources exist.

For evergreen general training today:

`primary_strength` maps to:

- `strength_full_body_maintenance_01`
- `strength_bodyweight_full_body_01`

Do not broaden this mapping in the cutover PR.

### Legacy app session handling

For pre-#321 records:

- normalize via `adaptStrengthSessionToNormalizedExecution()`;
- recover exact workout identity only where a deterministic persisted link exists;
- otherwise leave role credit unresolved while still preserving recent Strength exposure.

If production data proves that `sourceRecommendationDate` can deterministically join one legacy strength session to one recommendation/workout on that date, implement that join with explicit collision handling and tests. Do not use “same date = same workout” when multiple candidate strength prescriptions/sessions are possible.

### Required tests

- exact `strength_full_body_maintenance_01` execution -> one `primary_strength` credit;
- exact `strength_bodyweight_full_body_01` -> one `primary_strength` credit;
- `strength_compact_power_01` -> no `primary_strength` credit;
- generic Garmin Strength -> no exact `primary_strength` credit;
- app+Garmin exact full-body -> one credit, not two;
- exact catalog identity survives source arrival in either order;
- unknown/legacy identity remains uncredited but observable.

---

## PR 4 — Late-sync invalidation + legacy history horizon

### Purpose

Ensure morning recommendations update when performed-training evidence arrives after the initial decision snapshot.

### Changes

- introduce/extend recommendation fact revision watermark;
- update it when canonical occurrences or relevant source semantics change;
- recompute current-day recommendation facts when a source affecting the lookback arrives;
- ensure Garmin sync completion publishes/causes occurrence reconciliation before recommendation freshness is checked;
- ensure legacy strength read-through covers at least the maximum recommendation lookback plus a small safety buffer;
- do not use sync date as performed date.

### Required tests

Timeline fixture:

1. recommendation computed at T0;
2. Garmin activity for previous day syncs at T1;
3. occurrence created/attached at T2;
4. same current-day recommendation request at T3 sees a newer training-history revision and recomputes;
5. returned recommendation includes the new recent Strength exposure.

Also test:

- week boundary Sunday/Monday;
- DST / Warsaw-local calendar behavior;
- provider source with adjacent provider-local date but canonical local date from structured execution;
- repeated same sync run is idempotent.

---

## PR 5 — Remove recommendation-specific reconciliation

### Entry gate

Do this only after dual-read telemetry shows acceptable parity and all known differences are intentional.

### Changes

- remove/retire raw Garmin + `DailyRecommendation.adherence` matching from the live recommendation path;
- keep pure cost/stimulus helpers from `completedTraining.ts` if still useful, but feed them canonical facts;
- delete dead duration/date matching logic once no live consumer needs it;
- remove obsolete shadow flags/diagnostics after a soak period.

### Exit invariant

There is one matcher for physical workout identity: ADR-0034.

---

# Data model and hydration details

## Canonical source facts should remain minimal

Do **not** inflate `PerformedTrainingOccurrence` into a giant mutable copy of every source field. ADR-0034 correctly keeps source records non-destructively linked.

Recommendation fact hydration should fetch the attached sources and derive what it needs.

This prevents stale duplicated exercise/HR fields and preserves auditability.

## Legacy strength source representation

Two implementation options are acceptable, in preference order:

### Option A — expose legacy strength through the normalized execution repository/read layer

If the repository already has a version-neutral execution query that can include legacy `StrengthSession` via adapter, use it. ADR-0034 then sees an execution source without any bespoke legacy occurrence type.

### Option B — materialize a structured source on demand/rebuild

If reconciliation currently only discovers persisted `SessionExecution`, extend rebuild/source discovery to feed an adapted legacy normalized execution as reconciliation input without destructive migration.

Whichever option is selected, preserve stable source identity so repeated rebuilds do not create new occurrences.

## App RPE/rest detail

#321 adds richer structured rest/execution logging. Fact derivation should prefer that detail when available but remain backwards compatible:

- missing rest events in old sessions are unknown, not zero;
- missing RPE is unknown, not easy;
- no attempt should be made to synthesize structured rest from Garmin set durations.

---

# Recommendation policy contract

## Weekly target cannot override unresolved next-day strength exposure silently

When:

- `primary_strength` exact weekly credit is absent; **and**
- a recent canonical Strength exposure exists;

selection should not simply interpret the target as “schedule full-body strength now.”

The selector needs an explicit state, conceptually:

```ts
{
  weeklyRole: 'fulfilled' | 'unfulfilled' | 'uncertain',
  recentExposure: 'none' | 'recent' | 'very_recent',
}
```

The reported case is expected to be either:

- `fulfilled + very_recent`, if exact legacy/app identity is recoverable; or
- `unfulfilled/uncertain + very_recent`, if it is not.

Neither state should produce an unqualified next-day full-body recommendation just because sleep/HRV are green.

## Rationale requirements

Replace opaque target-only reasoning with evidence-aware language/data.

Internal reason payload should include:

```ts
{
  reasonCode: 'weekly_strength_role' | 'recent_strength_spacing' | ...,
  performedOccurrenceIds: string[],
  roleCreditStatus?: 'fulfilled' | 'unfulfilled' | 'uncertain',
  lastStrengthLocalDate?: string,
  confidence?: string,
  sourceKinds?: string[],
}
```

UI wording can remain concise, but debugging must retain the structured evidence.

---

# Test fixture based on the production export

Add an anonymized deterministic fixture reproducing the important shape of activity `24197884873` (the exact external ID may be replaced in tests):

```ts
{
  date: '2026-09-01',
  type: 'strength_training',
  durationMin: 77,
  trainingEffectAerobic: 0.2,
  trainingEffectAnaerobic: 0,
  averageHr: 85,
  activityTrainingLoad: 2.9,
  intensityTag: 'easy',
  exerciseSets: [
    { setType: 'active', repetitionCount: 2, exerciseCategory: 'SQUAT', durationSeconds: 120 },
    { setType: 'active', repetitionCount: 5, exerciseCategory: 'DEADLIFT', exerciseName: 'BARBELL_DEADLIFT', durationSeconds: 327.627 },
    { setType: 'active', repetitionCount: 5, durationSeconds: 1566.736 },
    // plus sparse rows representative of the export
  ]
}
```

Pair it with:

1. a legacy app `StrengthSession` containing richer exercise/set/RPE data;
2. a structured #321 `SessionExecution` version of the same scenario;
3. a Garmin-only variant.

Assertions must verify behavior, not just parsing.

---

# Full acceptance matrix

## Identity / deduplication

- [ ] app execution + matching Garmin = one canonical occurrence
- [ ] legacy app strength + matching Garmin = one canonical occurrence/read fact set
- [ ] Garmin re-sync is idempotent
- [ ] source arrival order does not change final semantics
- [ ] two legitimate same-day strength workouts stay separate
- [ ] manual keep-separate/unlink is respected by recommendation facts
- [ ] merged loser occurrence never emits live duplicate facts

## Strength semantics

- [ ] app exercises/sets/reps/load/RPE survive hydration
- [ ] Garmin set rows do not override app detail
- [ ] Garmin-only strength emits recent Strength exposure
- [ ] low Garmin TE/training load does not erase strength occurrence
- [ ] sparse Garmin set rows do not become fabricated hard-set volume
- [ ] missing old RPE/rest is represented as unknown

## Weekly coverage

- [ ] exact full-body maintenance workout earns `primary_strength` once
- [ ] bodyweight full-body workout earns `primary_strength` once
- [ ] compact strength does not silently satisfy `primary_strength`
- [ ] upper-body/trunk does not satisfy `primary_strength`
- [ ] generic Garmin strength does not automatically satisfy `primary_strength`
- [ ] unresolved legacy identity produces explicit no/uncertain credit reason

## Spacing / recommendation selection

- [ ] previous-day Strength exposure influences full-body candidate eligibility/ranking
- [ ] reported 2026-09-01 -> 2026-09-02 reproduction no longer yields duplicate full-body strength solely from weekly target
- [ ] green HRV/sleep cannot bypass recent-strength spacing without explicit policy
- [ ] if a deliberate override exists, rationale shows it
- [ ] cycling/running recommendations are unchanged unless their own canonical facts differ intentionally

## Time / freshness

- [ ] local performed date drives history, not sync date
- [ ] midnight boundary handled
- [ ] week boundary handled
- [ ] late Garmin sync invalidates/recomputes current recommendation facts
- [ ] edited app session invalidates/recomputes facts
- [ ] repeated sync with no semantic change does not cause recompute churn

## Explainability / telemetry

- [ ] reason can name contributing occurrence ids
- [ ] role credit/no-credit reason is inspectable
- [ ] source provenance/confidence recorded
- [ ] dual-read mismatch counters exist during rollout
- [ ] no PII/raw notes are added to telemetry payloads

---

# Rollout and safety gates

## Phase A — shadow

- build canonical facts in parallel;
- compare occurrence count, modality, local date, exact workout identity, weekly role credits, and recent-exposure status;
- categorize differences (`legacy_duplicate`, `canonical_linked`, `legacy_missing_execution`, `role_credit_changed`, `time_boundary`, etc.).

## Phase B — recency cutover

- canonical facts become authoritative only for recent-exposure/spacing;
- weekly role remains old path temporarily;
- monitor strength recommendation rate on day +1 after strength occurrences.

## Phase C — role-credit cutover

- canonical semantic identity becomes authoritative for weekly coverage;
- compare role-credit deltas before serving.

## Phase D — freshness/invalidation on

- enforce occurrence revision watermark for current recommendations.

## Phase E — legacy path removal

- remove recommendation-specific matching after an agreed soak window and no unexplained high-severity deltas.

### Rollback

Maintain a temporary runtime flag around canonical recommendation facts until Phase E. Rollback should switch the **consumer** back, not delete canonical occurrence/source data.

---

# Metrics

Recommended counters/gauges:

- `training_occurrence.recommendation_fact_occurrences`
- `training_occurrence.recommendation_fact_strength_exposures`
- `training_occurrence.recommendation_fact_exact_role_credits`
- `training_occurrence.recommendation_fact_unresolved_strength_role`
- `training_occurrence.recommendation_dual_read_mismatch{reason}`
- `training_occurrence.late_evidence_recommendation_invalidations`
- `training_occurrence.duplicate_source_credit_prevented`

Product-level guardrail:

- rate of full-body strength recommendations within one local day after a completed Strength occurrence, segmented by explicit override reason.

That should approach zero except where a deliberately authored policy permits it.

---

# Documentation updates required during implementation

- update ADR-0034 when recommendation read authority is no longer shadow-only;
- update ADR-0016 to make the distinction between broad exposure facts and exact weekly role credit explicit;
- update the structured-strength/Garmin reconciliation analysis with the final source-precedence implementation;
- document recommendation invalidation/revision semantics;
- document legacy strength read-through behavior and retention horizon.

---

# Definition of done

This initiative is complete when:

1. the recommender no longer performs an independent raw Garmin/adherence identity match for live history;
2. all performed-training recommendation facts come from active ADR-0034 occurrences;
3. app + Garmin for one physical session are credited once;
4. pre-#321 strength logs can contribute through the existing legacy adapter/read-through;
5. generic strength reliably affects spacing without falsely satisfying exact full-body coverage;
6. exact app/prescription identity satisfies `primary_strength` once when known;
7. late-arriving provider/app evidence makes current recommendations fresh;
8. the supplied 2026-09-01 production reproduction is covered by an automated regression test;
9. rationale/debug output can explain both recent strength exposure and weekly role status;
10. legacy recommendation-specific reconciliation has been removed after parity rollout.
