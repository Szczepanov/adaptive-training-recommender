# H4: D-REASSESS analysis and PR-1 handoff

**Status:** Analysis only. No code changes in this doc's commit.
**Tracks:** [GitHub issue #436](https://github.com/Szczepanov/adaptive-training-recommender/issues/436).
**Builds on:**
- [PR #440](https://github.com/Szczepanov/adaptive-training-recommender/pull/440) (issue #434 PR 1: external-plan execution-binding pipeline for primary session launch).
- External-plan pipeline roadmap in [`docs/plans/h4-external-plan-execution-binding-pipeline.md`](./h4-external-plan-execution-binding-pipeline.md) (PR 2: occurrence tracking; PR 3: bundle second-member adjudication).


## What ADR-0036 D-REASSESS requires

Quoting the ADR directly (`docs/adr/0036-intraday-training-windows-and-reassessment.md`):

> A morning PM verdict is provisional. Before a later session starts, compose a fresh
> as-of decision from current availability, today's canonical completed work, current
> health/symptom inputs and the shared ledger. Require an explicit post-predecessor
> symptom/response confirmation for a dependent session; absent confirmation leaves it
> pending, not implicitly well tolerated. [...] Run the common eligibility, readiness,
> dose and authored gates again. New adverse symptoms may scale/defer PM despite
> favorable morning wearables. Favorable response does not automatically increase the
> authored dose. A completed AM occurrence cannot be launched again; resuming an
> in-progress execution preserves its execution identity.
>
> Each accepted launch must atomically validate the current ledger/input revision and
> claim or transition its existing reservation, preventing two tabs or concurrent
> requests from spending the same minute or systemic-cost capacity. A stale decision must
> recompute. Changes to completion, symptoms, placement, availability or reconciliation
> invalidate a pending PM approval; historical decisions remain immutable and are linked
> by superseding decision identity.

## Why this depends on #434, not just D-PLACEMENT

D-REASSESS's entire premise is "before a later session starts" and "a completed AM
occurrence cannot be launched again." Both phrases presuppose a bundle member is a real,
launchable, stateful occurrence. Today (even after `activeExternalPlanService.ts`'s D-PLACEMENT
wiring, PR #432), a v4 bundle's non-primary member is correctly *placed* (window/order/
budget/rest all resolved) but has no execution identity, is not yet attached to
`additionalSessions`, and cannot be started.

Building D-REASSESS against that gap would mean either (a) inventing a parallel, throwaway
state-tracking mechanism that duplicates what #434 is already designed to build, or (b) sequencing
cleanly on top of the execution-binding pipeline. Option (b) is the only one that avoids duplicate work.

**Concretely, D-REASSESS requires the following pipeline stages:**
- **#434 PR 1 (delivered in PR #440):** Prescription-only launch binding for external-plan
  primary sessions, proving write-once content-addressed `ExecutionPrescription` storage.
- **#434 PR 2 (occurrence tracking):** Extending `OccurrenceAuthority`/`SessionOccurrence`
  for `external_plan` so a bundle member's lifecycle (`scheduled → active → completed`)
  is queryable independently of the plan/date, providing the state needed for "has the
  predecessor actually completed" and "a completed AM occurrence cannot be launched again."
- **#434 PR 3 (bundle second-member adjudication):** Adjudicating placed non-primary bundle
  members via `adjudicateAuthoredSession` and attaching them to `additionalSessions` in
  `Home.tsx` so they are exposed in the app with an actionable launch affordance.

D-REASSESS governs the runtime reassessment and launch-time claim gate for those
actionable bundle members.


## Current state, verified against code

### What exists and how it must be adapted

- **`evaluateReadinessAndSafetyEnvelope`** (`app/src/engine/rules.ts:277`) computes
  `{ mode, envelopes: { safety, plan }, telemetry, alreadyTrainedOverride }` from
  `(readiness, context, date, previousMode, subjectiveDriftPolicy, subjectiveDriftWeights)`.

  > [!CAUTION]
  > **The `alreadyTrainedOverride` trap:** In `rules.ts:406-413`, the logic enforces:
  > ```typescript
  > const alreadyTrainedOverride = subjective.alreadyTrainedToday === true || objective.today_training !== null;
  > if (alreadyTrainedOverride || redFlagOverride) mode = 'recover';
  > ```
  > If an athlete completes their AM session, `objective.today_training` will be non-null. Calling
  > `evaluateReadinessAndSafetyEnvelope` blindly with "today's current inputs" in the
  > afternoon will unconditionally trip `alreadyTrainedOverride` and force `mode = 'recover'`.
  > Downstream in `adjudicateAuthoredSession` (`authoredSessionGates.ts:189-191`), `mode === 'recover'`
  > unconditionally rejects any session whose intent is not `'recovery'`.
  >
  > **Required adaptation:** In ADR-0036 D-LEDGER, completed same-day work in a planned bundle is
  > accounted for through the **shared daily ledger debit**, not the single-session
  > `alreadyTrainedOverride` fail-stop. `evaluateReadinessAndSafetyEnvelope` must accept an
  > explicit option (e.g. `ignoreAlreadyTrainedOverride?: boolean` or a window/bundle context)
  > when evaluating an intraday bundle member whose predecessor completed as planned.

- **`adjudicateAuthoredSession`** (`app/src/engine/authoredSessionGates.ts`) already
  implements "run gates again for one specific session, given current readiness/context/
  envelope/availability, and return `proceed | scale | reject`" -- exactly the shape a
  dependent bundle member's reassessment needs. It is already reused for manually-authored
  additional sessions in `Home.tsx` and for external bundle members in #434 PR 3.

- **`dailyLedger.ts`'s `computeDailyLedger`/`admitsCandidate`** (delivered, PR #426/#427)
  already model "the day's remaining minute/systemic-cost capacity, reconciled against
  known actuals" -- the "shared ledger" D-REASSESS reads from. `admitsCandidate` serves as the
  live launch-time admission check: even if minutes remain in the current window, candidate
  work must fit within both `remainingMinutes` and `remainingSystemicCost`.

- **Elapsed separation calculation via D-TIME** (`app/src/engine/localInstant.ts`):
  `elapsedMinutesBetweenInstants(prospectiveStartInstant, predecessorActualEndInstant)`
  already computes exact elapsed minutes between UTC instants. ADR-0036 D-TIME mandates
  that separation is prospective start minus predecessor's *actual* end instant. If
  predecessor completion timestamps are missing or elapsed minutes < `minimumSeparationMinutes`,
  reassessment must fail closed (reporting an unresolved timing prerequisite).

- **Post-predecessor response schema already exists (ADR-0023 D-MRESP):**
  ADR-0036 line 188 explicitly states: *"Reuse the existing health-context and response authorities;
  do not create a second tissue score."*

  The codebase already provides:
  1. `SessionResponse` (`app/src/responses/models.ts`): Stores session-scoped facts with
     `window: 'immediate' | 'later_day' | 'next_morning'`, `sourceSession: { kind, id, date }`,
     `occurrenceId`, `sessionRpe`, `completedFraction`, and `unexpectedFatigue`.
  2. `RegionTissueResponse` (`app/src/engine/models.ts`): Carries `sourceSessionRef` and
     `afterTrainingState: 'calm' | 'tight' | 'ache' | 'sharp'`.
  3. `deriveSessionOutcome` (`app/src/responses/outcome.ts`): Summarizes passed, caution,
     or reactive status from recorded evidence.

  Reassessment does not require inventing a new schema: it checks whether a `SessionResponse`
  (or corresponding `RegionTissueResponse` with `sourceSessionRef`) exists for the predecessor.
  If absent, the dependent session remains `pending`. If reactive (`afterTrainingState: 'sharp'`
  or severe adverse symptoms), PM is scaled or deferred.

- **Same-day canonical performed facts** (`training-occurrence/performedTrainingFactsService.ts`'s
  `getPerformedTrainingFactsThroughToday`, verified in the D-WINDOW PR era) provides the
  "today's canonical completed work" input, proven to include today's own same-day evidence.

- **Atomic claim/transition precedent**: `assessmentAttemptService.ts`'s private
  `transitionAttempt` (lines ~99-113) demonstrates the `runTransaction`-based state transition
  pattern, also mirrored in `garminSyncRequestService.ts` and `healthAnomalyOutcomeService.ts`.

### What must be designed for D-REASSESS

- **Date-level concurrency locking:**
  ADR-0036 requires preventing two tabs or concurrent requests from spending the same minute
  or systemic-cost capacity. Reading and updating only `session_occurrences/{occurrenceId}`
  prevents double-launching the *same* session, but does not prevent two *different* sessions
  from concurrently claiming the same remaining daily ledger capacity. The claim transaction
  must read and write a **date-level document** (e.g. `users/{userId}/daily_recommendations/{date}`
  or a dedicated daily ledger reservation record) holding active reservations and ledger revision.
- **Reassessment input revision tracking:**
  A composite revision/hash spanning availability, completed facts, check-in, and ledger
  entries to verify the decision has not become stale at launch time.
- **Uncoupling operational reassessment from D-AUDIT:**
  Reassessment is the *live decision and gate logic*; D-AUDIT (issue #437) is the *immutable
  historical snapshotting for replay*. Operational decision updates are already archived
  via `RecommendationService`'s `revisions` subcollection. Reassessment should write into
  the established recommendation and occurrence models rather than waiting for D-AUDIT's
  replay store. Note that `hasValidRecommendationAudit` in `firestore.rules` is at its
  1,000 expression limit, so pending operational state must not be shoehorned into the
  existing audit map.


## Design sketch (for the implementing agent to refine, not a final spec)

1. **`ReassessmentInputRevision` shape:**
   ```typescript
   export interface ReassessmentInputRevision {
       availabilityRevision: string;   // hash of schedule windows for the date
       completedFactsRevision: string; // from getPerformedTrainingFactsThroughToday
       checkinRevision: string;        // check-in updatedAt / hash
       ledgerRevision: number;         // daily ledger entries sequence / hash
       placementRevision: string;      // bundle placement hash
   }
   ```
   Generated when the provisional PM recommendation is composed, passed to the launch action,
   and re-verified inside the atomic claim transaction; a mismatch means "stale, must recompute."

2. **`reassessDependentBundleMember(...)` (pure engine function):**
   - **Predecessor completion:** Verifies predecessor occurrence is `completed`. If not,
     returns `pending`.
   - **Elapsed separation:** If `minimumSeparationMinutes` is defined, computes
     `elapsedMinutesBetweenInstants(evaluationInstant, predecessorCompletedAt)` via `localInstant.ts`.
     If timestamps are missing or elapsed interval is insufficient, returns `pending` (unresolved timing prerequisite).
   - **Post-predecessor confirmation:** Queries `SessionResponse` (`window: 'immediate'`)
     and `DailySubjectiveCheckin.tissueResponses` for the predecessor. If absent, returns
     `pending`. If adverse symptoms or reactive tissue responses are present, scales or rejects.
   - **Readiness & safety envelopes:** Re-runs `evaluateReadinessAndSafetyEnvelope` with
     `ignoreAlreadyTrainedOverride: true` (since same-day load is accounted for via ledger).
   - **Ledger admission:** Recomputes `computeDailyLedger` with today's latest canonical facts
     and verifies `admitsCandidate` has headroom for both minutes and systemic cost.
   - **Authored adjudication:** Re-runs `adjudicateAuthoredSession` against the current envelope.

3. **Atomic launch claim transaction:**
   Inside `runTransaction`:
   - Reads the date-level reservation/recommendation document and the target `session_occurrence`.
   - Verifies target occurrence is currently `scheduled` (rejects if already `active` or `completed`).
   - Verifies date ledger revision matches the assumed revision (rejects with "stale, recompute" if mismatched).
   - Transitions occurrence to `active`, registers the active reservation in the date ledger,
     and commits atomically.

4. **Persistence & D-AUDIT boundary:**
   Operational decision updates are archived via `RecommendationService`'s existing `revisions`
   subcollection and `SessionOccurrence` state transitions. D-AUDIT (issue #437) will provide
   the dedicated, immutable replay snapshot layout. Keeping operational decision state within
   standard recommendation/occurrence channels avoids exceeding `hasValidRecommendationAudit`'s
   1,000 expression limit.

## Revised sequencing

1. **#434 PR 1 (delivered, PR #440):** Prescription launch binding for external-plan primary.
2. **#434 PR 2 (occurrence tracking):** `SessionOccurrence` support for `external_plan`
   (`scheduled → active → completed` lifecycle).
3. **#434 PR 3 (bundle second-member launch):** Adjudicating placed non-primary bundle members
   and attaching them to `additionalSessions` in `Home.tsx`.
4. **D-REASSESS (issue #436):**
   - Pure `reassessDependentBundleMember` (handling `alreadyTrainedOverride` bypass, `SessionResponse`
     confirmation, elapsed separation, and `admitsCandidate`).
   - Atomic date-level claim transaction.
   - `POLICY_VERSION` bump.
5. **D-AUDIT (issue #437):** Dedicated persistence shape for multi-decision same-day replay,
   historical supersession chains, and replay verification suite.

## Open questions for the implementing agent

- Exact document path for date-level ledger locking: whether to lock on `users/{userId}/daily_recommendations/{date}`
  or a dedicated `users/{userId}/daily_ledgers/{date}` document during the claim transaction.
- Wiring `SessionResponse` into the immediate post-workout modal for external-plan sessions
  so athletes can submit post-predecessor confirmation immediately upon completing the AM session.
- Firestore rules budget: ensure new date-level reservation updates do not exceed expression
  limits on the recommendation document, or use a dedicated collection with independent rules.

## Suggested PR description for D-REASSESS's first real implementation PR (once unblocked)

> ## Summary
> First implementation PR for ADR-0036 D-REASSESS (issue #436), unblocked by #434 PR 1–3
> (external-plan launch binding, occurrence tracking, and bundle second-member adjudication).
>
> Reuses `evaluateReadinessAndSafetyEnvelope` (with `alreadyTrainedOverride` bypass for ledger-accounted
> bundle members), `localInstant.ts`'s `elapsedMinutesBetweenInstants` for elapsed separation checks,
> `SessionResponse`/`RegionTissueResponse` for post-predecessor confirmation, `dailyLedger.ts`'s
> `admitsCandidate` as a live admission gate, and an atomic date-level claim transaction
> preventing concurrent double-reservation.
>
> ## What's delivered
> - `ReassessmentInputRevision` computation and validation.
> - Pure `reassessDependentBundleMember` implementing predecessor completion, separation, confirmation,
>   readiness, ledger, and authored gates.
> - Atomic claim transaction locking date-level capacity and transitioning occurrence to `active`.
> - `POLICY_VERSION` bump (real decision behavior).
>
> ## Not in scope here
> - Full D-AUDIT (dedicated multi-decision replay persistence and historical audit chains) -- issue #437.
>
> (standard verification checklist)
