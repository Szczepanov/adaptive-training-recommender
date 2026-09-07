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
| `app/src/sessions/models.ts` | *(#445)* discriminated `SessionOccurrence` union + `ExternalPlanOccurrenceRef`. PR 3 adds a `windowBinding` (Phase 1, step 4a) unless the `(date, windowId)` reservation-document alternative is chosen. |
| `app/src/sessions/validation.ts` | *(#445)* mutual-exclusivity + `externalPlanRef` validation. PR 3 extends it for the window binding. |
| `app/firestore.rules` | *(#445)* `externalPlanRef` branch and `hasValidOccurrenceUpdate`. PR 3 adds the window binding's immutability and the date-level reservation/lock document rules (steps 4a, 11). |
| `app/src/services/sessionOccurrenceService.ts` | *(#445)* `getOrCreateExternalPlanOccurrence`, `transitionOccurrenceState`. PR 3 adds atomic re-import supersession (step 4b), `getExternalPlanOccurrencesForDate`, and `releaseOccurrenceClaim`. |
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
     occurrences in `placementOrder` then `occurrenceId` order, **excluding `superseded`
     and `skipped`** (see steps 4b and 8). Note that `getAdditionalOccurrencesForDate`
     filters `authority === 'additional_session'` and will correctly *not* return these —
     bundle members must not flow through the manual additional-session adjudication path
     (see the `alreadyTrainedOverride` trap).
   - Dependencies: step 1. Risk: Low.

4a. **Give the occurrence a window identity — required before Phase 4**
   - Action: add `windowBinding { windowId, bundleId, order, boundStartLocal, boundEndLocal,
     startInstant, endInstant }` to `ExternalPlanSessionOccurrence` (model, validator, rules,
     immutable on update exactly like `externalPlanRef`), **or** introduce a per-date/window
     reservation document whose id *is* `(date, windowId)`, making a duplicate create
     transactionally impossible.
   - Why: D-WINDOW allows at most one occurrence per resolved window. Persisting the window
     only on `IntradayDecisionRecord` cannot enforce that — the decision store is an
     append-only audit log, so two concurrent creates (or two plan revisions resolving onto
     the same window) each append their own record and neither observes the other.
     Uniqueness needs either a document whose identity is the window, or a field the claim
     transaction can read and conflict on.
   - Closes open question 5 as a requirement; only the choice between the two mechanisms
     stays open.
   - Dependencies: step 1. Risk: Medium — a second rules/validation change on top of #445's,
     so re-run the expression-budget test.

4b. **Make re-import supersession atomic — required before Phase 2**
   - Action: when a new `externalPlanRef` revision produces a new occurrence for a
     `(date, planId, sessionId)` that already has one, transition the prior occurrence
     `scheduled → superseded` in the **same transaction** that creates the successor
     (`scheduled → superseded` is permitted by the merged transition table). Exclude
     `superseded` from `getExternalPlanOccurrencesForDate` and from Phase-2 ledger
     reconstruction.
   - Why: #445's deterministic id hashes the full ref, so a re-import creates a *second*
     document while the first stays `scheduled`. Phase 2 counts every `scheduled`
     occurrence, so re-importing a plan would double-reserve the same work in both
     dimensions. Non-atomic supersession leaves the same window double-counted between the
     two writes.
   - Note the asymmetry: an occurrence that already reached `active`/`completed` must
     **not** be superseded — its consumption is real and stays in the ledger (D-LEDGER:
     completed work is never retroactively erased to make later work fit).
   - Closes open question 6 as a requirement. Dependencies: step 1. Risk: Medium.

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
     - `partial` execution with a bounded actual → `state: 'partial'` with that actual: its
       known performed contribution stays consumed and only the demonstrably unperformed
       remainder is released (D-LEDGER's partial rule);
     - `completed`, `partial` **or** `abandoned` without a bounded actual → `state:
       'unresolved'`, reservation retained (D-LEDGER: missing cost is uncertainty, never
       spare capacity);
     - `superseded`/`skipped` occurrence → **no entry at all**. These are the two states
       meaning "this work is not happening and never consumed anything" (steps 4b and 8);
       counting them would double-reserve a re-imported plan, or charge the day for a member
       the gates just rejected.
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

6a. **The persisted date-level reservation aggregate** (new; consumed by step 11)
   - Firestore constraint that forces this design: in the Web SDK, `Transaction.get()`
     accepts a `DocumentReference` only — **it cannot run a query**. So the claim
     transaction physically cannot read "every occurrence for this date" and re-derive the
     ledger; it can only read documents it can name. The day's reservation totals must
     therefore live in one named document that every writer maintains, and step 6's derived
     ledger is a read-side projection, not the serialization authority.
   - Action: define `users/{userId}/daily_ledgers/{date}` (or the reservation map on
     `daily_recommendations/{date}` — step 11's open choice) holding: `revision`, the
     resolved `ceilings`, and `reservations: { [occurrenceId]: { minutes, systemicCost,
     state, decisionId? } }`, plus a per-`(date, sessionId)` `generation` counter used to
     mint a fresh occurrence identity after a `reject` (step 8, 2a). `decisionId` is the
     pointer step 11 uses to name the provisional decision record inside the claim
     transaction.
   - `decisionId` is **optional on the entry but mandatory for anything launchable**. Step 8
     reserves for `pending` and `scale` as well as `proceed`, while step 9 writes a decision
     record only for a member that receives a binding, so a `pending`/`scale` entry
     legitimately has none — it is holding capacity, not offering a launch. The claim must
     therefore reject any entry it is asked to launch that has no `decisionId`, rather than
     treating the absence as "no staleness to check". (Writing provisional records for
     `pending`/`scale` too would also close this, at the cost of appending records for
     verdicts that never launch; the audit value is real but out of scope here.)
   - **Every transition that changes an occurrence's reserving status must update this
     document and increment `revision` in the same transaction**, or the aggregate drifts
     from the occurrences and each direction of drift is a real defect:

     | Transition | Aggregate effect |
     |---|---|
     | create on `proceed`/`pending`/`scale` | add the reservation |
     | `reject` → `scheduled → skipped` (step 8) | remove it |
     | re-import → `scheduled → superseded` (step 4b) | remove it |
     | claim → `scheduled → active` (step 11) | mark `in_progress`, same debit, never re-add |
     | release → `active → scheduled` (step 11) | back to reserved, not removed |
     | completion/abandonment (`useSessionRunner`) | reconcile to the known actual, or `unresolved` when no bounded actual is available |

   - Why: a stale reservation left behind by a rejected or superseded member silently
     blocks a launch the athlete is entitled to, while a reservation that was never written
     for a `pending`/`scale` member lets two concurrent claims overbook the same capacity.
     Step 6's filtering fixes only the derived read; without this, the document step 11
     serializes on disagrees with it.
   - **Initialization is part of the contract, not a migration afterthought.** #445 already
     creates external-plan occurrences on every dashboard load, so real users will have
     `scheduled`, `active`, and `completed` occurrences for a date *before* this document
     exists. An absent or partial aggregate must therefore never read as an empty day:
     - a claim whose aggregate is absent, or whose `seededAt`/`ceilings` are missing, **fails
       closed** — no launch — rather than treating unaccounted occurrences as free capacity;
     - seeding is create-if-absent: read the date's occurrences and executions outside the
       transaction (a transaction cannot query), then inside one transaction re-check that
       the document still does not exist and write the seeded totals. A concurrent seeder
       loses the create and re-reads, so two tabs opening the same day cannot produce two
       different starting balances;
     - seeding **reuses step 6's mapping function verbatim** rather than restating it, so the
       two cannot drift: `scheduled` → reserved; `active`/`in_progress` → in-progress;
       `completed`, `partial` **and `abandoned`** → their bounded actual where one exists,
       otherwise `unresolved` with the reservation retained. Naming a subset here is exactly
       how a pre-existing abandoned execution would be dropped from the seed, undercounting
       consumption and admitting a claim the day cannot afford;
     - `superseded`/`skipped` seed nothing.
   - Reconciliation check: on each dashboard load, recompute the derived ledger from
     occurrences (step 6) and compare it against the persisted aggregate. A mismatch is a
     bug, not a state to paper over — surface it and prefer the conservative (higher
     consumption) side rather than silently releasing capacity.
   - Tests: rollout against a date that already has occurrences in **each** state —
     `scheduled`, `active`, `completed`, `partial`, `abandoned` (both with and without a
     bounded actual), `superseded`, `skipped`; two concurrent seeders; a claim attempted
     while the aggregate is absent (must refuse).
   - Dependencies: steps 4a-6. Risk: **High** — this is the shared mutable state; test each
     row of the table above, plus the drift check.

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
     1. call `reassessDependentBundleMember` **first**, with the target's `intraday`
        request, predecessor evidence (the *predecessor's* occurrence state + `completedAt`
        + `SessionResponse` `immediate` + tissue responses), the Phase-2 ledger, and
        `computeReassessmentInputRevision(...)`. The target's own occurrence is not an input
        to its own reassessment, so it must not be created before the verdict is known —
        **and on every load after the first, its existing reservation must be excluded from
        the ledger passed to it.** On a second load the target already holds a `scheduled`
        reservation from the first, step 6 counts it, and `admitsCandidate` then measures
        the candidate against a remainder its own reservation already reduced. A member that
        was admitted at 09:00 would flip to rejected at 09:05 with every input unchanged,
        purely by consuming itself. Subtract the target occurrence's own entry (or pass a
        ledger computed with it excluded) before reassessing it, and cover it with a
        two-load regression test asserting an unchanged verdict;
     2. **`reject` → create nothing**, and emit no binding. If an occurrence already exists
        from an earlier load whose verdict has since flipped, what happens depends on the
        state it is in:
        - `scheduled` → transition `scheduled → skipped` and drop its reservation from the
          aggregate (step 6a). A rejected member must never leave a `scheduled` occurrence
          behind: Phase 2 reads every `scheduled` occurrence as a live minute and
          systemic-cost reservation, so it would otherwise consume exactly the capacity it
          was just denied;
          A `skipped` occurrence is terminal, so this is a one-way door for that occurrence
          identity — see the recovery rule below;
        - `active` or `completed` → **change nothing.** The work is under way or already
          done; its consumption is real and stays in both the derived ledger and the
          aggregate. `active → skipped` is not even a legal transition in the merged table,
          and hiding such an occurrence would erase performed work to make later work fit —
          exactly what D-LEDGER forbids. A late `reject` for an occurrence in these states
          means only "do not offer it again", which is already true because a binding is
          emitted solely on `proceed` and the claim rejects any non-`scheduled` occurrence;
     2a. **Recovery from a `reject` that later becomes `pending`/`proceed`.** Conditions
        change within a day — a predecessor completes, a symptom resolves, capacity frees up
        — so a member rejected at 09:00 can legitimately be admissible at 14:00. The plan
        must define that path, because nothing else does: `skipped` is terminal in #445's
        transition table, `getOrCreateExternalPlanOccurrence` matches on the ref regardless
        of state and would hand back the skipped document, and the claim rejects every
        non-`scheduled` occurrence. Left undefined, one morning `reject` silently disables
        that member for the rest of the day.
        Recovery therefore creates a **new occurrence identity**, never reactivates the
        skipped one. That requires a discriminator in the deterministic id, whose inputs
        (`date`, `planId`, `sessionId`, `revision`, `contentHash`) are otherwise all
        unchanged: carry a per-`(date, sessionId)` `generation` counter in the step-6a
        aggregate, include it in the id, and increment it in the same transaction that skips
        the previous occurrence. Idempotency is preserved *within* a generation — two tabs
        recovering at once converge on the same new document — while the skipped record
        stays intact as history. Tests: `reject → pending` and `reject → proceed` on a later
        load each produce exactly one new reserved occurrence, and the skipped one is
        untouched;
     3. **`pending` → create the occurrence and reserve.** Deliberately different from
        `reject`: D-LEDGER counts "accepted pending session reservations" against the day,
        and a member waiting only on a post-AM confirmation is still intended work. Emit no
        binding;
     4. **`scale` → create the occurrence, reserve, emit no binding.** PR 1's rule stands:
        there is no block-level transformer for external definitions, so the authored blocks
        must not become an executable prescription. Do **not** call
        `prepareExternalPlanSessionLaunch` here. Carry the reduction advice in the member's
        status only;
     5. **`proceed` → `getOrCreateExternalPlanOccurrence`** (passing `intraday.order` as
        `placementOrder`), then `prepareExternalPlanSessionLaunch`, then attach
        `{ ...binding, occurrenceId }` to `additionalSessions`.
   - Launchability is carried by the presence of a binding and nothing else. Step 10 treats
     a binding as a Start control, so emitting one for `scale` or `pending` would expose a
     launch path for a verdict that must not launch. Return `{ status, reason, binding? }`
     per member and let the absence of `binding` be the single source of truth — do not add
     a parallel `launchable` flag that the card and the start handler could disagree about.
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

9. **Persist the provisional decision (D-AUDIT)** — **required, not optional**
   - Action: for every member that receives a binding, write an `IntradayDecisionRecord`
     with `status: 'provisional'` via `saveIntradayDecision` **before** the binding is
     exposed, carrying the `ReassessmentInputRevision` the verdict was computed against.
   - **Record the post-reservation revision, not the one the verdict was computed against.**
     These differ by exactly one increment and conflating them breaks every launch: step 8
     computes the revision, then creating the target's reservation bumps the aggregate
     (step 6a), so a record storing the pre-create value is stale the instant it is written
     and step 11's comparison rejects the member on its own reservation write. Nothing would
     ever launch on first attempt. The decision, the reservation and the occurrence are
     written in one transaction (below), so that transaction knows the resulting revision:
     store *that* value. The verdict is still the one computed from the pre-create inputs —
     only the revision is taken after the write, because the revision's job is to detect
     *other* writers, not to notice the decision recording itself.
   - Test: adjudicate `proceed` and claim immediately, with nothing else touching the day —
     the claim must succeed. A failure here means the self-invalidation above is present.
   - Why this is not optional: step 11's claim compares the *current* ledger revision
     against "the revision the decision assumed". That expected value has to be durable —
     it is read back in a transaction that may run in another tab, after a reload, or hours
     later. `SessionReferenceBinding` has no field for it (`sessionSource`, `occurrenceId`,
     `prescriptionHash`), and inventing one would change a shipped, rules-validated,
     replayed shape. The provisional record is the store that already exists for exactly
     this, so a deferred record leaves the claim with no expected revision and its staleness
     check becomes a no-op that compares the current value against itself.
   - Secondary benefit, which was the original reason: the launch-time record gains a
     `supersededDecisionId` chain to link to.
   - Alternative if this is deferred anyway: persist the revision on the occurrence and
     bump its own revision on every reassessment — strictly more schema churn on a document
     #445 just froze, for the same guarantee. Prefer the decision record.
   - **Steps 8 and 9 must not be able to half-succeed.** Step 8 creates the occurrence and
     its reservation; step 9 writes the decision record that carries the expected revision.
     If step 9 fails on its own, the day is left holding a reservation for a member with no
     binding and no recoverable expected revision — capacity consumed by a session the
     athlete can never start. `saveIntradayDecision` currently does its own `getDoc`/`setDoc`
     (`intradayDecisionService.ts`), so it cannot participate as written. **One transaction
     is the required path**, not one of two options: give `saveIntradayDecision` a
     transaction-accepting variant and commit the occurrence create, the aggregate update,
     and the decision record together. The record is create-only under its rules
     (`allow update, delete: if false`), so it composes cleanly.
     Compensating cleanup was considered and rejected as the primary design: it is not
     atomic in either direction. `setDoc` can commit on the server while the client sees a
     network error, so "the write failed" is unknowable from the caller; and the cleanup
     write can itself fail, leaving the same orphaned reservation it was meant to remove.
   - **Idempotent reconciliation for the ambiguous acknowledgement.** Even one transaction
     can be acknowledged ambiguously to the client. Derive the provisional decision id
     deterministically from `(occurrenceId, reassessmentInputRevision hash)` instead of a
     fresh UUID, and make the write create-if-absent. A retry after an unknown outcome then
     converges on the same document rather than appending a second provisional decision for
     the same verdict — which matters because the record is append-only and cannot be
     cleaned up afterwards. Note `validateIntradayDecisionRecord` accepts any string id up
     to 128 chars, so this needs no schema change.
   - **A deterministic id is not by itself an idempotency rule** — it only guarantees the
     retry addresses the same document, not what to do when that document already exists.
     The retry therefore reads it first, inside the transaction, and:
     - **exact match** on every immutable field — the target `occurrenceId`, the
       predecessor `occurrenceId`, `predecessorExecutionId`, `verdict` and
       `reassessmentInputRevision` → the first attempt did commit; treat the retry as
       success and do not write again. The predecessor occurrence belongs in this predicate
       precisely because the record stores it: two decisions differing only in which
       predecessor they depend on are different decisions, and omitting it would accept one
       as an idempotent retry of the other;
     - **any field differs** → this is a different decision colliding on the same id, not a
       retry. Fail the claim rather than overwriting: the record is append-only precisely so
       a decision cannot be rewritten after the fact, and a silent overwrite would break the
       replay guarantee the audit store exists for.
   - Tests: inject a failure at each write in the transaction and assert no orphaned
     reservation survives; simulate an ambiguous acknowledgement (write commits, client
     errors) and assert the retry produces exactly one provisional decision — covering both
     outcomes, the matching record (accepted) and a conflicting one (rejected).
   - This closes open question 4. Risk: Low for the record itself; Medium for the
     atomicity requirement above.

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
    - **The date-level capacity write is required, not optional.** `claimOccurrenceLaunch`
      transacts on a single occurrence document, so two *different* occurrences can each
      read the same ledger revision, each find headroom, and both commit — Firestore detects
      no conflict because they touch disjoint documents. Re-running the reassessment inside
      `onBeforeClaim` does not fix this: both callers would compute the same
      stale-but-individually-valid answer. The transaction must therefore, atomically:
      1. `transaction.get` the step-6a aggregate document (it must be read by name — a
         transaction cannot query for the date's occurrences);
      2. verify its revision against the `ReassessmentInputRevision` the decision assumed;
      3. move this member's entry from reserved to in-progress **and increment `revision`**
         (same debit, never re-added — D-LEDGER: a pending reservation that becomes
         in-progress keeps its identity and is not charged twice). This write is what makes
         a concurrent claim conflict and retry;
      4. transition the occurrence to `active`.
      Steps 1-2 must precede every write (Firestore's reads-before-writes rule). Without
      step 3 the lock document is never written and provides no mutual exclusion at all.
    - **Every reassessment input must be transaction-scoped, not just the aggregate.**
      `claimOccurrenceLaunch` reads only the target occurrence before invoking
      `onBeforeClaim`, so anything the hook consults outside the transaction can change
      between the read and the commit while the aggregate revision still matches. Split the
      inputs by whether Firestore can address them as a single document:
      - **Read inside the transaction, by id** — the aggregate; the target occurrence
        (already read by `claimOccurrenceLaunch`); the predecessor occurrence (its id is
        known from the bundle); the day's check-in, which is date-keyed at
        `users/{userId}/daily_subjective_checkins/{date}` and carries `tissueResponses`; the
        predecessor's `SessionResponse`, whose id is deterministic
        (`resp-execution-{executionId}-immediate`); and the provisional decision record
        itself, which supplies the expected `ReassessmentInputRevision` including
        `postPredecessorConfirmationRevision`.
      - **How the claim names that decision record.** Step 9 derives its id from
        `(occurrenceId, input-revision hash)`, which creates a circularity at claim time:
        the claim needs the record to learn the *expected* revision, so it cannot re-derive
        the id from the *current* revision — that would look up a different document when
        anything changed, and compare the current revision against itself when nothing did,
        which is the no-op this whole section exists to prevent. The reservation entry in
        the step-6a aggregate therefore carries `decisionId`, written in the same
        transaction that creates the reservation (step 9). The claim reads the aggregate
        first anyway, so it obtains the reference before it needs it, and the pointer
        survives reloads and other tabs. Note the two shipped stores that cannot hold it:
        `SessionReferenceBinding` is a rules-validated, replayed shape, and #445's rules
        restrict occurrence updates to `['state', 'updatedAt']`.
      - A reservation whose `decisionId` names a record that is **missing** is stale, not
        launchable: recompute rather than launching without a durable expected revision.
      - That `SessionResponse` read is only possible if the `executionId` is durably known,
        so **`IntradayDecisionRecord` gains a required `predecessorExecutionId`** (with the
        predecessor `occurrenceId` it belongs to, so the claim can validate that the
        response it reads is the response for *this* bundle's predecessor). This is not a
        free addition: `hasValidIntradayDecision` in `firestore.rules` pins the key set with
        `hasOnly(requiredKeys)`, and the record is write-once, so the field must land in the
        model, `validateIntradayDecisionRecord`, and the rules together — and records written
        before it exists can never gain it. Decide alongside open question 2 whether that is
        a `schemaVersion: 2` bump or a tolerated optional-on-read/required-on-write field.
        Without it the claim cannot name the document, and the confirmation check silently
        falls back to a non-transactional read — the exact race this section closes.
      - **Legacy records are non-claimable, whichever schema route is chosen.** A decision
        record lacking `predecessorExecutionId` cannot name the predecessor's
        `SessionResponse`, so the claim must reject it as stale and force a fresh
        reassessment (which writes a new record that has the field). Optional-on-read must
        **not** mean "launch without predecessor confirmation" — that would let exactly the
        unconfirmed PM launch D-REASSESS forbids through the one path that skipped the
        check. Since these records are provisional and same-day, the practical cost of
        rejecting them is one recomputation, not lost history.
      - **Not addressable, so folded into the aggregate's `revision`** — schedule windows
        (`users/{userId}/schedule_windows/*`, resolved by query), plan placement, and the
        performed-facts snapshot. A transaction cannot query, so whichever writer changes
        one of these must bump the aggregate revision **in the same transaction as the
        source change**, never as a follow-up write. A separate commit leaves a window in
        which the source has changed but the revision has not, so a concurrent claim
        validates the old `ReassessmentInputRevision` and launches on inputs that are
        already stale — the same race, moved rather than removed. Say so explicitly in the
        implementation, because the alternative — reading these outside the transaction —
        reintroduces it directly.
      - Tests: one two-tab race per input — predecessor completion, response/tissue edit,
        check-in edit, window change, placement change, **and a performed-facts change**
        (`computeReassessmentInputRevision` carries `completedFactsRevision`, so a
        provider sync landing mid-decision must invalidate it like any other input) — each
        asserting the second claim recomputes rather than launching on a stale verdict.
    - Step 6a defines that document's shape and the writers that must keep it consistent;
      only *which* document holds it is still open. Recommendation:
      `users/{userId}/daily_recommendations/{date}` — it exists already and already carries a
      revision — falling back to a dedicated `users/{userId}/daily_ledgers/{date}` with
      independent rules if the recommendation document's rules budget cannot absorb a
      reservation map. Decide with the emulator budget test, not by inspection.
    - Rollback: if `resolveSessionDefinition` or `startSession` fails *after* a successful
      claim, the occurrence is stranded in `active` with no execution. Add
      `releaseOccurrenceClaim(userId, occurrenceId)` transitioning `active → scheduled`
      **only when no execution references it**, and call it from the failure path.
    - Risk: **High** (concurrency + partial failure). Tests: two concurrent claims on the
      **same** occurrence → exactly one wins; two concurrent claims on **different**
      occurrences contending for the last remaining minutes/systemic cost → exactly one wins
      (the case a single-occurrence transaction does not cover, and precisely what
      ADR-0036's "two tabs cannot spend the same minute" clause is about); claim on an
      already-`active`/`completed` occurrence → rejected; stale input revision → rejected and
      recomputed; failed start → released back to `scheduled`.

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
      where `facts` = `{ sessionRpe, completedFraction, unexpectedFatigue, note }`. Note the
      deliberate rename at this boundary: the sheet's `SessionCompletionPayload.notes`
      (`SessionCompletionSheet.tsx:23`) maps to the response record's `SessionResponse.note`
      (`responses/models.ts`). Both names are already shipped on their own records, so
      neither is renamed here — but the mapping must be written explicitly
      (`note: payload.notes`) rather than spread, or the athlete's note is silently dropped. Guard with `getResponseForWindow` → `updateResponseFacts` when
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
4. ~~**Provisional D-AUDIT records (step 9)**~~ — settled as required: the claim's
   staleness check needs a durable expected revision, and the decision record is the only
   shipped store that can hold one.
5. **Window identity's mechanism** — settled that it cannot live on `IntradayDecisionRecord`
   alone (Phase 1, step 4a): an append-only audit log cannot enforce uniqueness. Still open:
   `windowBinding` on the occurrence vs. a `(date, windowId)`-keyed reservation document.
6. ~~**Re-import semantics**~~ — settled as a requirement in Phase 1, step 4b: supersession
   must be atomic with the successor's creation, and `superseded` occurrences are excluded
   from ledger reconstruction.

---

## Success criteria

- [ ] A v4 bundle's non-primary member appears on `Home.tsx` with its resolved window and a
      launch affordance, or an explicit pending/blocked reason.
- [ ] Launching it claims capacity atomically — including two *different* occurrences
      contending for the same remaining capacity, not only two claims on one occurrence; a
      stale decision recomputes instead of launching.
- [ ] A `reject` verdict leaves no reserving occurrence behind, and a re-imported plan
      revision supersedes its predecessor atomically rather than double-reserving the day.
- [ ] No `scale` or `pending` member ever receives a launch binding, so no Start control can
      appear for a verdict that must not launch.
- [ ] A completed AM occurrence cannot be relaunched, and its execution identity is
      preserved across reload.
- [ ] Completing the AM session records an `immediate` `SessionResponse` (only when actually
      answered) and tissue responses, and the PM member's `pending` state clears as a result.
- [ ] The shared ledger reflects today's completed and reserved work; the ADR's 90/60/30
      case and the exhausted-cost case both pass as tests.
- [ ] `npm run check`, `npm run test:rules`, simulation/diff, and the policy-drift guard all
      pass; `POLICY_VERSION` is bumped and the previous value archived.
