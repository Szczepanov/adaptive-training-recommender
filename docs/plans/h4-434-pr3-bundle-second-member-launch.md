# H4 / issue #434 PR 3 — Intraday bundle second-member launch & athlete confirmation capture

**Status:** Draft (design not yet agreed).
**Tracks:** [GitHub issue #434](https://github.com/Szczepanov/adaptive-training-recommender/issues/434), PR 3.
**Blocked by:** nothing — [PR #445](https://github.com/Szczepanov/adaptive-training-recommender/pull/445)
(#434 PR 2, external-plan occurrence tracking) merged to `main` as `99a7638f`. Phase 1
below is now a short adopt-and-verify pass, not new construction.
**Unlocks:** live wiring of ADR-0036 D-REASSESS (`reassessDependentBundleMember`, issue #436)
and D-AUDIT (`intradayDecisionService`, issue #437), both of which currently exist as
unwired engine/service code.
**Governs:** [ADR-0036](../adr/0036-intraday-training-windows-and-reassessment.md)
D-WINDOW / D-LEDGER / D-REASSESS / D-PLACEMENT.
**Builds on:** [`h4-external-plan-execution-binding-pipeline.md`](./h4-external-plan-execution-binding-pipeline.md),
[`h4-dreassess-analysis.md`](./h4-dreassess-analysis.md), [`h4-daudit-analysis.md`](./h4-daudit-analysis.md).

---

## Overview

A v4 intraday bundle's non-primary member is today correctly *placed* (window, order,
rest, and both ledger dimensions resolved by `resolveIntradayBundlePlacement`) but it has
no execution identity, is never attached to `additionalSessions`, and cannot be started.
This PR turns that placed member into an independently launchable, state-tracked
occurrence, routes its launch through an atomic capacity claim, and captures the
post-AM athlete confirmation that D-REASSESS requires before the PM member may proceed.

Three deliverables:

1. **Surface** non-primary bundle members as launchable `additionalSessions` entries on
   `Home.tsx` (plus the UI that renders them — none exists today).
2. **Claim** capacity atomically: `App.tsx` launch → `sessionOccurrenceService.claimOccurrenceLaunch`
   → `useSessionRunner.startSession`, with D-REASSESS re-evaluated inside the transaction.
3. **Capture** the post-workout `SessionResponse` (`window: 'immediate'`) and
   `tissueResponses` on AM completion, so D-REASSESS reads real athlete evidence instead
   of remaining permanently `pending`.

---

## Verified current state

Every claim below was read from the code, not inferred from the issue text. Re-verified
against `origin/main` at `99a7638f` (the #445 merge).

### What already exists and is reusable

| Capability | Location | State |
|---|---|---|
| v4 primary launch binding | `app/src/services/sessionAuthoringService.ts:164` `prepareExternalPlanSessionLaunch` | Delivered (PR #440) |
| Bundle placement resolution | `app/src/services/activeExternalPlanService.ts:116` `resolveIntradayBundlePlacement` | Delivered, wired into `Home.tsx:432` |
| Bundle placement engine | `app/src/engine/intradayBundlePlacement.ts` (`proposeBundlePlacement`, `ResolvedWindowBinding`, `LEGACY_SINGLE_SLOT_WINDOW_ID`) | Delivered |
| Shared daily ledger | `app/src/engine/dailyLedger.ts` (`computeDailyLedger`, `admitsCandidate`, `reconcileEntry`) | Delivered |
| D-REASSESS pure evaluation | `app/src/engine/intradayReassessment.ts:124` `reassessDependentBundleMember` | Delivered (PR #442), **no production caller** |
| Atomic launch claim | `app/src/services/sessionOccurrenceService.ts:155` `claimOccurrenceLaunch` (with `onBeforeClaim` in-transaction hook) | Delivered (PR #442), **no production caller** |
| D-AUDIT record + store | `app/src/engine/intradayDecision.ts`, `app/src/services/intradayDecisionService.ts`, rules `users/{u}/intraday_decisions/{id}` | Delivered (PR #443), **no production writer** |
| Authored gate reuse | `app/src/engine/authoredSessionGates.ts` `adjudicateAuthoredSession`, `estimateAuthoredSessionSystemicCost` | Delivered, already used for manual additional sessions (`Home.tsx:608`) |
| Response persistence | `app/src/services/sessionResponseService.ts` (`recordResponse`, deterministic id per `(source, window)`) | Delivered |
| Occurrence-aware execution start | `app/src/hooks/useSessionRunner.ts:285` `startSession(def, source, { occurrenceId, prescriptionHash })` | Delivered |

### The five real gaps (one now closed)

1. **~~`SessionOccurrence` has no external-plan identity~~ — closed by #445 (`99a7638f`).**
   `SessionOccurrence` is now a discriminated union (`ManualSessionOccurrence` |
   `ExternalPlanSessionOccurrence`) with `ExternalPlanOccurrenceRef {planId, revision,
   sessionId, contentHash}` — matching the `SessionSourceRef` `external_plan` branch exactly
   — plus authority `'external_plan'`, state `'skipped'`, the `isManualOccurrence` /
   `isExternalPlanOccurrence` guards, an explicit `VALID_OCCURRENCE_TRANSITIONS` lifecycle
   table mirrored in `firestore.rules` (`isValidOccurrenceStateTransition`), a SHA-256
   deterministic occurrence id, a transactional `getOrCreateExternalPlanOccurrence`, and
   occurrence completion/abandon transitions in `useSessionRunner`.

2. **`additionalSessions` has no UI at all.** It is produced (`Home.tsx:634`), validated
   (`engine/validationCore.ts:1268`, max 4 bindings), persisted
   (`services/recommendationService.ts:106`) and replayed (`engine/replay.ts:87`) — but no
   component renders it. `MorningDecisionCard` only exposes `recommendation.primarySession`
   (`MorningDecisionCard.tsx:154`). A launch affordance must be built.

3. **Nothing calls `claimOccurrenceLaunch`** outside its own test file. `App.tsx:323`
   `onStartSession` resolves the definition and hands it straight to `SessionRunner`,
   which calls `runner.startSession` (`SessionRunner.tsx:331`) with no claim.

4. **No `SessionResponse` is ever written with `window: 'immediate'`.** `DailyCheckin.tsx:427`
   writes `next_morning`; `session/laterDayFollowupAction.ts` writes `later_day`.
   `useSessionRunner.completeSession` writes tissue values into the daily check-in
   (correct per D-MRESP) but creates **no** `SessionResponse` at all. D-REASSESS's
   confirmation gate (`intradayReassessment.ts`, invariant 3) therefore can never be
   satisfied for a same-day predecessor — every dependent PM member would sit at `pending`
   forever.

5. **`toMembers` hardcodes `started: false`** (`activeExternalPlanService.ts:88`), with an
   explicit comment deferring execution-state reconciliation to D-REASSESS. Once members
   are launchable this becomes wrong: a started AM member must keep its binding and its
   consumed window.

### What #445 (merged, `99a7638f`) leaves for PR 3

Four issues raised during review were fixed before merge: the blocking
`scheduled → completed`/`abandoned` regression (both edges now allowed *and* occurrence
bookkeeping moved out of the completion batch into a non-throwing post-commit step), the
date-wide scan (now a transactional read-by-deterministic-id, so concurrent creates are
atomic), the non-injective id sanitizer (now SHA-256 over the identity tuple), and the
parameter order on `queueOccurrenceTransition`. What remains:

- **Launch still never claims.** `claimOccurrenceLaunch` — signature and `onBeforeClaim`
  hook unchanged by the merge — has no production caller. The AM primary now carries
  `binding.occurrenceId` and transitions `scheduled → completed` directly; `active` is
  never entered, so the reservation is never in-progress and D-REASSESS cannot see that a
  member has started. **This is PR 3's step 11.**
- **An occurrence now exists for the AM primary on every dashboard load,** created by
  `prepareExternalPlanSessionLaunch(..., { date })` whether or not the athlete launches.
  Phase 2 should treat that `scheduled` occurrence as a *reserved* ledger row — which is
  the correct D-LEDGER reading, but it means the ledger becomes non-empty as soon as this
  plan's Phase 2 lands, not only after a launch.
- **A completed occurrence is still returned to the binding.**
  `getOrCreateExternalPlanOccurrence` matches regardless of state, so after the AM
  completes, the next load binds `primarySession` to a `completed` occurrence. The claim
  correctly rejects it ("completed AM cannot relaunch"), but the UI must stop offering
  Start rather than surfacing a thrown claim — PR 3's step 10.
- **`queueOccurrenceTransition` is now unused production code** (test-only). PR 3 either
  uses it for the claim/transition batching or removes it.
- **No window identity on the occurrence.** Unchanged by the merge — see open question 5.

### Two contract inconsistencies to reconcile (do not paper over)

- **Duplicate, divergent `ReassessmentInputRevision`:** `engine/intradayReassessment.ts:44`
  declares `ledgerRevision: number` and an optional `postPredecessorConfirmationRevision`;
  `engine/intradayDecision.ts:22` declares `ledgerRevision: string` and no confirmation
  field. Wiring both together in one launch path forces a decision. Recommendation: make
  the audit record's shape the superset (`ledgerRevision: string`, optional
  `postPredecessorConfirmationRevision`), export a single type from `intradayReassessment.ts`,
  and have `intradayDecision.ts` import it — with the D-AUDIT validator widened accordingly.
  This is a schema change to an already-shipped persisted record: keep the validator
  backward-compatible for records written without the confirmation field.

- **The `alreadyTrainedOverride` trap** (`engine/rules.ts:406-413`): once the AM execution
  is `completed`, `objective.today_training` is non-null, so the ordinary
  `evaluateReadinessAndSafetyEnvelope` call in `Home.tsx:518` forces `mode = 'recover'`,
  and `adjudicateAuthoredSession` (`authoredSessionGates.ts:189-191`) then rejects any
  non-recovery session. **The PM member must never be adjudicated through that envelope.**
  `reassessDependentBundleMember` already handles this internally (invariant 7); the plan
  below routes bundle members exclusively through it and leaves the manual
  additional-session path untouched.

---

## Requirements & constraints

- **ADR-0036 D-WINDOW:** at most one training occurrence per resolved window; requested
  intervals never create availability.
- **ADR-0036 D-LEDGER:** minute and systemic-cost remainders come from one shared ledger;
  neither dimension admits work on the other's spare capacity; a reservation that becomes
  in-progress keeps the same occurrence identity and is not charged twice.
- **ADR-0036 D-REASSESS:** the PM verdict is provisional until launch; a completed AM
  occurrence cannot be relaunched; the launch claim atomically validates the input
  revision and transitions the reservation.
- **ADR-0023 D-MRESP:** `DailySubjectiveCheckin.tissueResponses` remains the sole tissue
  authority. A `SessionResponse` is never fabricated for a prompt the athlete did not
  answer — "missing" must stay distinguishable from "answered normal".
- **PR-1 invariants** (`h4-external-plan-execution-binding-pipeline.md`): v4 only via the
  `isV4Plan` discriminator; no binding for `skip`/`defer`/untransformed `scale`; never
  launch `isEvent` sessions; keep the engine pure and persistence in callers.
- `additionalSessions` is capped at 4 bindings by `validationCore.ts:1269` — a bundle
  cannot exceed that.
- Firestore rules changes must keep `hasValidRecommendationAudit` within its
  expression budget; the emulator budget test stays in the required set.

---

## Architecture changes

| File | Change |
|---|---|
| `app/src/sessions/models.ts` | *(#445)* discriminated `SessionOccurrence` union + `ExternalPlanOccurrenceRef`. PR 3 adds nothing here unless open question 5 puts a window binding on the occurrence. |
| `app/src/sessions/validation.ts` | *(#445)* mutual-exclusivity + `externalPlanRef` validation. PR 3 extends only if a window binding is added. |
| `app/firestore.rules` | *(#445)* `externalPlanRef` branch and `hasValidOccurrenceUpdate`. PR 3 adds the date-level reservation/lock document rules (step 11). |
| `app/src/services/sessionOccurrenceService.ts` | *(#445)* `getOrCreateExternalPlanOccurrence`, `transitionOccurrenceState`. PR 3 hardens id determinism and adds `getExternalPlanOccurrencesForDate` + `releaseOccurrenceClaim`. |
| `app/src/services/activeExternalPlanService.ts` | `toMembers` accepts real execution state (`started`, `existingBinding`) instead of hardcoding `false`. |
| `app/src/components/Home.tsx` | Build ledger entries from today's occurrences/executions; adjudicate non-primary bundle members through `reassessDependentBundleMember`; emit `additionalSessions` + per-member status. |
| `app/src/components/session/AdditionalSessionsCard.tsx` *(new)* | Renders launchable/pending/blocked additional sessions. |
| `app/src/App.tsx` | `onStartSession` claims the occurrence (with in-transaction reassessment) before navigating to the runner. |
| `app/src/hooks/useSessionRunner.ts` | `completeSession` records the `immediate` `SessionResponse`. |
| `app/src/components/session/SessionCompletionSheet.tsx` | Adds the completion-fraction / unexpected-fatigue fields the `immediate` response needs. |
| `app/src/engine/intradayDecision.ts` | Import the single `ReassessmentInputRevision`; widen the validator. |
| `app/src/engine/policy.ts` | `POLICY_VERSION` bump; previous value appended to `HISTORICAL_POLICY_VERSIONS`. |

---

## Implementation steps

### Phase 1 — Adopt the merged occurrence contract

> #445 is merged (`99a7638f`) and delivers the contract: union model, validation, rules,
> deterministic ids, transactional get-or-create, and runner transitions. This phase adopts
> it and confirms the baseline; it builds nothing new.

1. **Rebase onto #445 and adopt its vocabulary**
   - Action: use authority `'external_plan'` (not a new `'intraday_bundle_member'` value),
     `ExternalPlanOccurrenceRef`, and the `isManualOccurrence` / `isExternalPlanOccurrence`
     guards. Carry `intraday.order` in the existing `placementOrder` field.
   - Why: a second authority value for the same kind of occurrence would fragment every
     query and rules branch for no gain.
   - Risk: Low.

2. **Verify the merged completion path end to end**
   - Action: complete and abandon one manual authored-replacement session and one
     external-plan session on `main`, confirming the occurrence reaches `completed` /
     `abandoned` and that a failed occurrence write cannot fail the execution transition
     (it is now a non-throwing post-commit step).
   - Why: Phase 5 adds the `immediate` `SessionResponse` write to that same
     `completeSession` path; establish the baseline before changing it.
   - Risk: Low. This is confirmation, not construction.

3. **Decide `queueOccurrenceTransition`'s fate**
   - Action: either use it to batch the claim-side transition in step 11, or delete it as
     dead code. Do not leave an unused second transition API alongside
     `transitionOccurrenceState` and `claimOccurrenceLaunch`.
   - Risk: Low.

4. **Add the bundle-member query**
   - Action: `getExternalPlanOccurrencesForDate(userId, date)` returning external-plan
     occurrences in `placementOrder` then `occurrenceId` order. Note that
     `getAdditionalOccurrencesForDate` filters `authority === 'additional_session'` and will
     correctly *not* return these — bundle members must not flow through the manual
     additional-session adjudication path (see the `alreadyTrainedOverride` trap).
   - Dependencies: step 1. Risk: Low.

5. **Confirm the rules surface covers a non-primary member**
   - Action: extend `app/src/emulator/firestoreRules.emulator.test.ts` (#445 already adds
     external-plan occurrence cases) with a second same-date occurrence, and re-run the
     expression-budget test.
   - Verify: `cd app && npm run test:rules`. Risk: Low.

### Phase 2 — Ledger truth for today

6. **Build real ledger entries** (`app/src/components/Home.tsx:434-443`)
   - Action: replace `computeDailyLedger({...}, [])` with entries derived from today's
     occurrences and executions:
     - `scheduled` occurrence → `{ state: 'reserved', reservedMinutes, reservedSystemicCost }`;
     - `active` occurrence / `in_progress` execution → `state: 'in_progress'`, same reservation
       (never charged again — same occurrence identity);
     - `completed` execution with a bounded actual duration → `state: 'completed'` with
       `actualMinutes` (and `actualSystemicCost` when the estimator can bound it);
     - completed/abandoned without a bounded actual → `state: 'unresolved'`, reservation
       retained (D-LEDGER: missing cost is uncertainty, never spare capacity).
   - Reuse `reconcileEntry` (`dailyLedger.ts:175`) rather than hand-rolling the transitions.
   - Why: the ledger currently sees an empty day, so an AM completion frees nothing and
     reserves nothing — the "90-minute ceiling, 60-minute AM leaves ≤30 for PM" acceptance
     case in ADR-0036 cannot pass without this.
   - Dependencies: step 5. Risk: **High** (this is the correctness core). Cover with the
     ADR's named ledger cases as unit tests against a pure extracted helper — do **not**
     leave this logic inline in the component.
   - Extraction: put it in a new pure module, e.g. `app/src/engine/intradayLedgerInputs.ts`,
     with `Home.tsx` only supplying loaded data. Keeps the "engine pure, persistence in
     callers" invariant and makes the acceptance cases testable.

7. **Real execution state into placement** (`app/src/services/activeExternalPlanService.ts:82`)
   - Action: give `IntradayBundlePlacementContext` an optional
     `memberState?: ReadonlyMap<string, { started: boolean; existingBinding?: ResolvedWindowBinding }>`
     keyed by `sessionId`, and have `toMembers` read from it instead of hardcoding
     `started: false`.
   - Why: ADR-0036 D-PLACEMENT — "once a member starts, do not move its history"; the
     placement engine already supports `started`/`existingBinding`, only the caller lies.
   - Risk: Low. Existing `activeExternalPlanService.intradayBundle.test.ts` covers the
     absent-map fallback.

### Phase 3 — Surface non-primary members as `additionalSessions`

8. **Adjudicate bundle members** (`app/src/components/Home.tsx`, after `resolveIntradayBundlePlacement`)
   - Action: for a `placed` proposal, take every binding after `bindings[0]` (the primary,
     already handled at `Home.tsx:487`), resolve its v4 session, and for each:
     1. `getOrCreateExternalPlanOccurrence` (hardened in Phase 1, step 2), passing
        `intraday.order` as `placementOrder`;
     2. call `reassessDependentBundleMember` with the target's `intraday` request,
        predecessor evidence (occurrence state + `completedAt` + `SessionResponse`
        `immediate` + tissue responses), the Phase-2 ledger, and
        `computeReassessmentInputRevision(...)`;
     3. on `proceed`/`scale` → `prepareExternalPlanSessionLaunch` for the accepted
        definition (for `scale`, **do not** launch the authored blocks — PR 1's rule
        stands; surface the advice and keep the member unlaunchable until a block-level
        transform exists);
     4. attach `{ ...binding, occurrenceId }` to `additionalSessions`;
     5. on `pending`/`reject` → no binding; carry the reason into the per-member status.
   - Why: `adjudicateAuthoredSession` alone would trip `alreadyTrainedOverride`;
     `reassessDependentBundleMember` is the authority that bypasses it correctly.
   - Dependencies: steps 5-7. Risk: **High** (blast radius in a 1,400-line component).
     Mitigation: extract the whole loop into
     `app/src/services/intradayBundleMemberAdjudication.ts` returning
     `{ bindings, statuses, notices }`, and keep `Home.tsx`'s addition to a call plus state.
   - Guard rails to keep from PR 1: `isV4Plan` discriminator; reject `isEvent`; never bind
     `rest_01`; respect ADR-0035 rest (already enforced inside `proposeBundlePlacement`
     via `restDates`).
   - Cap: never emit more than 4 bindings total (`validationCore.ts:1269`) — count the
     manual additional-session bindings already produced at `Home.tsx:590-627` and emit a
     notice if the bundle would exceed the cap rather than producing an invalid
     recommendation.

9. **Persist the provisional decision (D-AUDIT)** — optional in this PR, recommended
   - Action: after each member is adjudicated, write an `IntradayDecisionRecord` with
     `status: 'provisional'` via `saveIntradayDecision`.
   - Why: the store already exists and is write-once; without a provisional record, the
     launch-time record has no `supersededDecisionId` chain to link to.
   - Risk: Low; skip only if the PR gets too large — but then say so explicitly in the PR
     description rather than leaving it silently unwritten.

### Phase 4 — Launch affordance and the atomic claim

10. **`AdditionalSessionsCard`** (`app/src/components/session/AdditionalSessionsCard.tsx`, new + CSS)
    - Action: render each additional session with its window (`boundStartLocal-boundEndLocal`),
      order label, and one of: a Start button (binding present), a pending explanation
      (e.g. "waiting on your post-session check-in", "needs 180 min after your morning
      session — 95 min elapsed"), or a blocked reason. Render in `Home.tsx` beneath
      `MorningDecisionCard` (`Home.tsx:1127`).
    - Why: no existing component renders `additionalSessions`; `MorningDecisionCard` is
      already large and primary-session specific.
    - Risk: Low. Add a component test asserting that a `pending` member exposes no
      Start control.

11. **Claim before start** (`app/src/App.tsx:323`)
    - Action: in `onStartSession`, when `binding.occurrenceId` is present:
      ```typescript
      await sessionOccurrenceService.claimOccurrenceLaunch(userId, binding.occurrenceId, {
        onBeforeClaim: async (transaction, occurrence) => {
          // re-read date-level inputs, recompute the ledger, re-run
          // reassessDependentBundleMember, and compare ReassessmentInputRevision.
          // Throw a typed StaleDecisionError on mismatch or non-'proceed' verdict.
        },
      });
      ```
      then resolve the definition and navigate to the runner. On `StaleDecisionError`,
      do not navigate: refresh the dashboard and show the recomputed reason.
    - Why: ADR-0036 D-REASSESS — "each accepted launch must atomically validate the current
      ledger/input revision and claim or transition its existing reservation". The hook
      already exists on `claimOccurrenceLaunch`; nothing uses it.
    - Constraint: Firestore transactions require **all reads before any write**, and
      `claimOccurrenceLaunch` reads the occurrence first — so `onBeforeClaim` may only
      read (via `transaction.get`) and stage writes; it must not read after writing.
    - Date-level lock: the open question in `h4-dreassess-analysis.md` still stands. Recommendation:
      lock on `users/{userId}/daily_recommendations/{date}` — it already exists, already
      holds the recommendation revision, and avoids a new collection plus new rules budget.
      If its rules budget cannot absorb a reservation map, fall back to a dedicated
      `users/{userId}/daily_ledgers/{date}` document with independent rules. Decide with the
      emulator budget test, not by inspection.
    - Rollback: if `resolveSessionDefinition` or `startSession` fails *after* a successful
      claim, the occurrence is stranded in `active` with no execution. Add
      `releaseOccurrenceClaim(userId, occurrenceId)` transitioning `active → scheduled`
      **only when no execution references it**, and call it from the failure path.
    - Risk: **High** (concurrency + partial failure). Tests: two concurrent claims → exactly
      one wins; claim on an already-`active`/`completed` occurrence → rejected; stale input
      revision → rejected and recomputed; failed start → released back to `scheduled`.

12. **Runner passes the occurrence through** (`app/src/components/session/SessionRunner.tsx:331`)
    - Action: no signature change needed — `binding.occurrenceId` already flows into
      `runner.startSession`. Verify the restore path (`SessionRunner.tsx:318-327`) does
      **not** re-claim: a resumed in-progress execution preserves its execution identity
      and its occurrence is already `active`.
    - Risk: Low, but explicitly test the reload-mid-session case.

### Phase 5 — Post-AM confirmation capture

13. **Record the `immediate` response** (`app/src/hooks/useSessionRunner.ts`, `completeSession`)
    - Action: after the execution transitions to `completed`, call
      `sessionResponseService.recordResponse(userId, { kind: 'execution', id: executionId, date: execution.date }, 'immediate', execution.date, execution.date, facts, execution.occurrenceId)`
      where `facts` = `{ sessionRpe, completedFraction, unexpectedFatigue, note }` from the
      completion payload. Guard with `getResponseForWindow` → `updateResponseFacts` when
      one already exists (the deterministic id makes a double-tap throw otherwise).
    - Why: gap 4 above — without this, every dependent PM member stays `pending`.
    - D-MRESP compliance: write the response **only** from an actually-submitted completion
      sheet. Never synthesize one on abandon or on a completion with no answers; a missing
      `immediate` response must stay legible as "not answered".
    - Failure handling: a failed response write must not fail the completion. Log and let
      the PM member stay `pending` (fail-closed is the correct direction here) — but surface
      it, e.g. by re-prompting from the additional-session card.
    - Risk: Medium — `completeSession` is on the critical path of every session in the app.
      Keep the write after the batch commit, non-throwing.

14. **Completion sheet fields** (`app/src/components/session/SessionCompletionSheet.tsx:21`)
    - Action: extend `SessionCompletionPayload` with `completedFraction?: number` and
      `unexpectedFatigue?: boolean`, and add the two controls. `sessionRpe`, `notes` and
      `tissueFeedback` already exist; the current tissue control only captures **one**
      region — for a bundle predecessor, allow the athlete to add more than one region, or
      state explicitly in the PR that single-region capture is retained.
    - Why: D-REASSESS reads `unexpectedFatigue` and tissue `afterTrainingState` to decide
      scale/reject; RPE alone is insufficient evidence.
    - Risk: Low. Existing `SessionCompletionSheet.test.tsx` covers the sheet.

15. **Confirmation revision** (`app/src/engine/intradayReassessment.ts`)
    - Action: populate `postPredecessorConfirmationRevision` from the predecessor
      `SessionResponse.updatedAt` + tissue-response `sourceSessionRef` fingerprint, so a
      later-edited answer invalidates a pending PM approval (ADR-0036: "changes to
      completion, symptoms, ... invalidate a pending PM approval").
    - Risk: Low.

### Phase 6 — Contract reconciliation, policy, and verification

16. **Unify `ReassessmentInputRevision`** — single exported type in
    `engine/intradayReassessment.ts`; `engine/intradayDecision.ts` imports it and widens
    `validateIntradayDecisionRecord` (accept string `ledgerRevision`, optional
    `postPredecessorConfirmationRevision`, tolerate records written without it).
    Risk: Medium — it is a persisted, write-once record; keep the reader backward compatible.

17. **Policy bump** (`app/src/engine/policy.ts`) — this changes persisted decisions, so
    `POLICY_VERSION` must move (e.g. `2026-09-h4-intraday-bundle-member-launch-v1`) and
    `2026-09-h4-intraday-reassessment-v1` joins `HISTORICAL_POLICY_VERSIONS`. Verify with
    `cd app && node scripts/check-policy-drift.mjs <base-sha>`.

18. **Docs** — update `docs/plans/h4-external-plan-execution-binding-pipeline.md`'s
    roadmap (PR 2 folded into PR 3; PR 3 delivered), add this plan's row to
    `docs/plans/README.md`, and record the delivered state in `AGENTS.md`'s package map if
    new modules land.

---

## Verification & testing strategy

**Automated (all must pass):**

```bash
cd app && npm run check
```

```bash
cd app && npm run test:rules
```

```bash
cd app && npm run simulate:scenarios && npm run simulate:diff
```

```bash
make check
```

**New unit tests, by ADR-0036 acceptance clause:**

| ADR acceptance case | Test target |
|---|---|
| 90-min ceiling, 60-min AM completion leaves ≤30 for PM | `engine/intradayLedgerInputs.test.ts` (new) |
| spare minutes but exhausted systemic cost → not admitted | same |
| execution + provider evidence counts once; completion reconciles, never stacks | same, via `reconcileEntry` |
| partial/abandoned retains known consumption, releases only proven-unperformed | same |
| missing/late/ambiguous actual retains the reservation; repeat evidence idempotent | same |
| overrun replaces reservation and clamps at zero | same |
| completed AM cannot relaunch | `services/sessionOccurrenceService.test.ts` |
| concurrent PM launches cannot double-reserve | `App` claim test + occurrence service test |
| stale approval recomputes | claim `onBeforeClaim` test |
| unknown actual end cannot satisfy a required separation | `engine/intradayReassessment.test.ts` (exists — extend) |
| missing post-AM confirmation stays `pending`; favorable response does not expand dose | `intradayReassessment` + new `useSessionRunner` response test |
| optional PM drops independently without replacement | `engine/intradayBundlePlacement.test.ts` (exists) |
| started member's history is never moved | `activeExternalPlanService.intradayBundle.test.ts` |
| cross-user writes / invalid persisted window+ledger data denied | `firestore.rules` emulator tests |

**Integration flow to walk manually** (`cd app && npm run dev`):
import a v4 plan with a two-member bundle → confirm the AM member is primary and the PM
member appears as a pending additional session → complete AM with the new completion
fields → confirm the PM member becomes launchable only after both the response and the
separation minimum are satisfied → launch it and confirm exactly one occurrence moved
`scheduled → active`, with ledger minutes reduced by the AM's actuals.

**Visual check:** `cd app && npm run visual:refresh` for the new card.

---

## Risks & mitigations

- **Duplicate occurrences per dashboard load** (double-charged ledger) — closed by #445's
  transactional read-by-deterministic-id. → Keep a regression test asserting repeated
  `loadDashboardData` yields one document, since Phase 2 makes each occurrence a ledger debit.
- **Stranded `active` occurrence when the runner fails after the claim.** → `releaseOccurrenceClaim`
  on the failure path, guarded on "no execution references this occurrence".
- **`Home.tsx` blast radius** (already 1,407 lines; the load function is ~400). → Extract
  the ledger-input builder and the member-adjudication loop into pure/service modules;
  `Home.tsx` gains a call, not a branch tree.
- **The occurrence union breaking manual authored sessions.** #445 guards the two `Home.tsx`
  manual paths with `isManualOccurrence`. Re-verify after rebasing onto `99a7638f` that no
  other `definitionRef` reader was missed (`grep -rn "definitionRef" app/src`) and that no
  non-null assertion was used to silence the compiler.
- **Firestore rules expression budget.** → Measure with the emulator budget test before and
  after; prefer a dedicated `daily_ledgers` document over enlarging the recommendation audit.
- **`scale` verdicts.** → Still not launchable (PR 1's rule). Display advice only; do not
  quietly bind authored blocks that the verdict says should be reduced.
- **PR size.** Phases 1-2 are independently valuable and independently testable; if review
  load demands it, split at the Phase 2/3 boundary (contracts + ledger truth first, launch
  + capture second) rather than dropping test coverage.

---

## Open questions

1. **Date-level lock document** — `daily_recommendations/{date}` (reuses existing rules,
   risks budget) vs. a new `daily_ledgers/{date}` (clean budget, new rules surface).
   Recommendation above is the former, decided by the budget test.
2. **`ReassessmentInputRevision` unification** — confirm widening the already-shipped
   D-AUDIT validator is acceptable versus versioning the record (`schemaVersion: 2`).
3. **Multi-region tissue capture** in the completion sheet: expand now, or accept
   single-region capture for this PR and note the limitation?
4. **Provisional D-AUDIT records (step 9)** — in this PR, or deferred to issue #437?
5. **Window identity's home** — #445 puts no `windowId`/`bundleId`/bound interval on the
   occurrence. Persist it on `IntradayDecisionRecord` only (no occurrence-level enforcement
   of D-WINDOW's one-occurrence-per-window rule), or add a `windowBinding` to the occurrence
   in PR 3 (a second rules/validation change on top of #445's)?
6. **Re-import semantics** — settled by #445: the deterministic id hashes the full
   `externalPlanRef`, so a new revision yields a new occurrence document. Confirm the old
   one is marked `superseded` rather than left `scheduled` and counted a second time by the
   Phase 2 ledger.

---

## Success criteria

- [ ] A v4 bundle's non-primary member appears on `Home.tsx` with its resolved window and a
      launch affordance, or an explicit pending/blocked reason.
- [ ] Launching it claims capacity atomically; a stale decision recomputes instead of
      launching; concurrent launches cannot both succeed.
- [ ] A completed AM occurrence cannot be relaunched, and its execution identity is
      preserved across reload.
- [ ] Completing the AM session records an `immediate` `SessionResponse` (only when actually
      answered) and tissue responses, and the PM member's `pending` state clears as a result.
- [ ] The shared ledger reflects today's completed and reserved work; the ADR's 90/60/30
      case and the exhausted-cost case both pass as tests.
- [ ] `npm run check`, `npm run test:rules`, simulation/diff, and the policy-drift guard all
      pass; `POLICY_VERSION` is bumped and the previous value archived.
