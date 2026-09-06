# H4: D-REASSESS analysis and PR-1 handoff

**Status:** Analysis only. No code changes in this doc's commit.
**Tracks:** [GitHub issue #436](https://github.com/Szczepanov/adaptive-training-recommender/issues/436).
**Builds on:** [PR #440](https://github.com/Szczepanov/adaptive-training-recommender/pull/440)'s
analysis of the external-plan execution-binding pipeline (issue #434) -- **not yet
implemented**. This document's design assumes that pipeline's PR 1 (prescription-only v4
launch binding) and PR 2 (occurrence tracking) both exist; see "Sequencing" below for why
both, not just PR 1, are prerequisites.

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
launchable, stateful thing. Today (even after `activeExternalPlanService.ts`'s D-PLACEMENT
wiring, PR #432), a v4 bundle's non-primary member is correctly *placed* (window/order/
budget/rest all resolved) but has no execution identity at all -- there is nothing to
"start," nothing that can be "completed," and no occurrence record D-REASSESS could query
to ask "has the predecessor actually finished." Building D-REASSESS against that gap would
mean either (a) inventing a parallel, throwaway state-tracking mechanism that duplicates
what #434 PR 2 (occurrence tracking) is already supposed to build, or (b) blocking on #434
first. Option (b) is the only one that doesn't create duplicate, soon-to-be-replaced work.

**Concretely, D-REASSESS needs:**
- #434 PR 1 (prescription-only launch binding) -- so a v4 session can be started at all.
- #434 PR 2 (occurrence tracking, `OccurrenceAuthority`/`SessionOccurrence` extended for
  `external_plan`) -- so a bundle member's lifecycle (`scheduled → active → completed`)
  is queryable independently of the plan/date, which is what "has the predecessor
  completed" and "a completed AM occurrence cannot be launched again" both require.

Neither exists yet. This document is written so its design is ready the moment they do,
but implementing D-REASSESS before them would mean re-deriving occurrence state ad hoc.

## Current state, verified against code

### What already exists and can be reused directly

- **`evaluateReadinessAndSafetyEnvelope`** (`app/src/engine/rules.ts:277`) already computes
  `{ mode, envelopes: { safety, plan }, telemetry, alreadyTrainedOverride }` from
  `(readiness, context, date, previousMode, subjectiveDriftPolicy, subjectiveDriftWeights)`.
  This is the "common eligibility, readiness... gates" the ADR says to re-run -- it's
  already a pure, callable function, not something new to build. D-REASSESS's "compose a
  fresh as-of decision" is largely "call this again with today's current inputs," not a
  new gate system.
- **`adjudicateAuthoredSession`** (`app/src/engine/authoredSessionGates.ts`) already
  implements "run gates again for one specific session, given current readiness/context/
  envelope/availability, and return `proceed | scale | reject`" -- exactly the shape a
  dependent bundle member's reassessment needs. It's already reused for the manually-
  authored additional-session flow in `Home.tsx`; PR 3 of #434's roadmap already proposes
  reusing it for bundle members too. D-REASSESS is the gate that decides *whether and
  when* to call it again for an already-placed dependent, not a replacement for it.
- **`dailyLedger.ts`'s `computeDailyLedger`/`admitsCandidate`** (delivered, PR #426/#427)
  already model "the day's remaining minute/systemic-cost capacity, reconciled against
  known actuals" -- the "shared ledger" D-REASSESS reads from. Not yet wired into a live
  per-launch admission check anywhere (see issue #433's closure -- the *week-ahead
  planner* doesn't need it, but a live PM-launch admission check plausibly does; this
  would be D-REASSESS's actual first real consumer of `admitsCandidate` as a launch-time
  gate, distinct from #433's now-closed, differently-scoped ask).
- **Same-day canonical performed facts** (`training-occurrence/performedTrainingFactsService.ts`'s
  `getPerformedTrainingFactsThroughToday`, verified in the D-WINDOW PR era) is the "today's
  canonical completed work" input, already proven to correctly include today's own
  same-day evidence.
- **Atomic claim/transition precedent**: `assessmentAttemptService.ts`'s private
  `transitionAttempt` (lines ~99-113) is a direct, reusable pattern for "atomically
  validate the current ... revision and claim or transition its existing reservation":

  ```typescript
  private async transitionAttempt(userId, attemptId, transition: (current) => next): Promise<void> {
      const ref = this.attemptRef(userId, attemptId);
      await runTransaction(this.db, async transaction => {
          const snapshot = await transaction.get(ref);
          if (!snapshot.exists()) throw new Error(...);
          const current = snapshot.data();
          assertValidAssessmentAttempt(current);
          const next = transition(current);
          assertValidAssessmentAttempt(next);
          transaction.set(ref, next);
      });
  }
  ```
  This is exactly the shape D-REASSESS's "each accepted launch must atomically validate
  the current ledger/input revision and claim or transition its existing reservation,
  preventing two tabs or concurrent requests from spending the same minute or
  systemic-cost capacity" needs: read the occurrence + today's ledger-relevant state
  inside a `runTransaction`, validate the caller's assumed revision still matches, and
  only then write the claimed/transitioned state. `garminSyncRequestService.ts` and
  `healthAnomalyOutcomeService.ts` show the same pattern used twice more elsewhere in
  this codebase -- it's an established idiom, not a new one to invent.

### What does not exist yet (beyond #434's gap)

- No "revision" concept for a day's ledger/availability inputs as a whole (only
  `dailyLedger.ts`'s per-*entry* `revision`, and `ExternalPlanPlacement.revision` for the
  plan overlay). D-REASSESS's "atomically validate the current ledger/input revision"
  implies some notion of "the as-of state this PM decision was computed against" that can
  be compared to "the as-of state at claim time" to detect staleness (availability
  changed, symptoms changed, placement changed, etc. -- the ADR's own list of invalidating
  changes). This needs a new, explicit revision/hash concept spanning the *inputs to one
  day's reassessment decision*, not a reuse of an existing per-entity revision. See
  "Design sketch" below.
- No persisted "pending PM approval" concept at all -- this is arguably the first slice of
  D-AUDIT (issue #437) that D-REASSESS actually needs before it can be built, not just a
  D-REASSESS-internal detail. A provisional AM-time PM verdict needs *somewhere* to live
  between "AM decision composed" and "PM launch claimed," and the ADR's "historical
  decisions remain immutable and are linked by superseding decision identity" describes
  exactly the kind of snapshot D-AUDIT is supposed to own. **This is a second real
  dependency this document did not originally expect**: D-REASSESS and D-AUDIT are more
  intertwined than the original issue split suggested -- see "Sequencing," revised.
- No explicit "post-predecessor symptom/response confirmation" UI/data model. The ADR
  requires this be a distinct, explicit athlete input ("absent confirmation leaves it
  pending, not implicitly well tolerated") -- nothing in the existing check-in/health-
  context schema (`DailySubjectiveCheckin`, `HealthContext`) is scoped to "confirming how
  a specific just-completed session felt," as opposed to the whole day's general state.

## Design sketch (for the implementing agent to refine, not a final spec)

1. **A day's reassessment-input revision.** Define something like:
   ```typescript
   interface ReassessmentInputRevision {
       availabilityRevision: string;   // hash of resolveAvailability's relevant inputs for the date
       completedFactsRevision: string; // from getPerformedTrainingFactsThroughToday
       checkinRevision: string;        // today's check-in document's own revision/updatedAt
       ledgerRevision: string;         // hash of the day's LedgerEntry set at compose time
       placementRevision: string;      // the bundle's proposeBundlePlacement outcome hash
   }
   ```
   Computed once when the provisional PM decision is composed (AM time or whenever
   re-evaluated), persisted alongside it, and re-derived at claim time inside the
   transaction; a mismatch on any field means "stale, must recompute" per the ADR.
2. **`reassessDependentBundleMember(...)`** (name placeholder): a new pure function,
   analogous to `evaluateReadinessAndSafetyEnvelope` + `adjudicateAuthoredSession`
   composed together, that:
   - Requires an explicit "post-predecessor confirmation" input; returns a `pending`
     verdict (not `proceed`/`scale`/`reject`) when absent.
   - Re-runs `evaluateReadinessAndSafetyEnvelope` and `adjudicateAuthoredSession` against
     *current* inputs, not the AM-time snapshot.
   - Consults `dailyLedger.ts`'s `admitsCandidate` against the day's *current* remaining
     capacity (today's real first live consumer of that function as an admission gate,
     distinct from issue #433's now-closed ask).
3. **Claim transaction**, mirroring `assessmentAttemptService.ts`'s `transitionAttempt`:
   read the occurrence (from #434 PR 2) and the persisted `ReassessmentInputRevision`
   inside one `runTransaction`; if the caller's assumed revision doesn't match current,
   fail with "stale, recompute"; otherwise atomically move the occurrence from
   `scheduled` to `active` (claim) and write the resolved verdict.
4. **Persistence** of the provisional/reassessed decision itself is D-AUDIT's concern
   (issue #437) -- D-REASSESS should be designed to *write into* whatever shape D-AUDIT
   defines, not invent its own separate storage. This is the reason to read #437's
   analysis (once written) before finalizing D-REASSESS's exact persisted shape.

## Revised sequencing

Original issue split assumed D-REASSESS → D-AUDIT in that order. Investigation shows
they're more coupled: D-REASSESS needs *somewhere* to persist a provisional decision
between AM composition and PM claim, and that "somewhere" is D-AUDIT's actual subject
matter. Recommended real order:

1. #434 PR 1 (prescription-only v4 launch binding) -- not yet implemented.
2. #434 PR 2 (occurrence tracking for `external_plan`) -- not yet implemented.
3. **A minimal slice of D-AUDIT** covering just enough persisted shape for one pending
   decision + its input-revision snapshot (not the full D-AUDIT scope from issue #437,
   which also covers full replay semantics, superseded-decision chains, etc.) -- this
   could be its own small PR, or folded into D-REASSESS's first PR if it stays small.
4. D-REASSESS's actual gate logic (the design sketch above), built against that minimal
   persisted shape.
5. The rest of D-AUDIT (issue #437) -- full replay verification, superseded-decision
   chains, UI surfacing of provisional/pending/dropped states.

## Open questions for the implementing agent

- Exact shape of `ReassessmentInputRevision` -- the sketch above is illustrative; the
  actual hash/revision sources need re-verification against the tree at implementation
  time (this doc was written after PR #441 merged; confirm nothing shifted).
- Whether "post-predecessor confirmation" belongs in the existing daily check-in flow
  (`DailySubjectiveCheckin`) as a new optional field, or as its own separate, session-
  scoped confirmation record -- the ADR's emphasis on "explicit" and "absent confirmation
  leaves it pending" suggests a separate record is safer (a daily check-in the athlete
  fills before any session starts can't logically already contain a *post*-predecessor
  confirmation), but this needs product-level input, not just an engineering call.
- How much of "the minimal slice of D-AUDIT" (step 3 above) is small enough to fold into
  D-REASSESS's first PR versus needing its own -- re-evaluate once #434 actually exists
  and the real occurrence shape is known.
- Firestore rules budget: any new persisted shape for a pending decision needs its own
  validation function, ideally *not* nested inside the already-at-capacity
  `hasValidRecommendationAudit` (see issue #435/PR #441's finding) -- a new top-level
  collection with its own, unrelated validation function avoids inheriting that ceiling.

## Suggested PR description for D-REASSESS's first real implementation PR (once unblocked)

> ## Summary
> First implementation PR for ADR-0036 D-REASSESS (issue #436), unblocked by #434 PR 1+2
> (external-plan launch binding + occurrence tracking) and a minimal slice of D-AUDIT
> (issue #437) providing persisted-decision-revision tracking.
>
> Reuses `evaluateReadinessAndSafetyEnvelope`/`adjudicateAuthoredSession` (unchanged) for
> the actual gate re-evaluation, `dailyLedger.ts`'s `admitsCandidate` as a real live
> admission check (its first production consumer), and
> `assessmentAttemptService.ts`'s `runTransaction`-based claim pattern for atomic
> launch-time revision validation.
>
> ## What's delivered
> - `ReassessmentInputRevision` computation and persistence (see D-AUDIT's minimal slice).
> - A new pure reassessment function requiring explicit post-predecessor confirmation.
> - An atomic claim transaction preventing double-reservation across concurrent launches.
> - `POLICY_VERSION` bump (real decision behavior).
>
> ## Not in scope here
> - Full D-AUDIT (replay verification, superseded-decision chains) -- issue #437.
> - UI for the confirmation input -- product design needed first (see open questions).
>
> (standard verification checklist)
