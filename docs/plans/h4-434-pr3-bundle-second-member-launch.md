# H4 / issue #434 PR 3 — Intraday bundle second-member launch & athlete confirmation capture

**Status:** In progress — **Phases 1-4 delivered and merged** (#448, #450, #451, #454,
#465); **Phases 5-6 remain** and are the gate on a live dependent-member H4 release.
**Tracks:** [GitHub issue #434](https://github.com/Szczepanov/adaptive-training-recommender/issues/434)
(historical issue, now closed), PR 3.
**Blocked by:** nothing. Phase 5 can start from current `main`.
**Unlocks:** dependent non-primary bundle members that can move from `pending` to a fresh
launchable verdict after real post-predecessor evidence, followed by the cumulative H4
policy transition.
**Governs:** [ADR-0036](../adr/0036-intraday-training-windows-and-reassessment.md)
D-WINDOW / D-LEDGER / D-REASSESS / D-PLACEMENT.
**Builds on:** [`h4-external-plan-execution-binding-pipeline.md`](./h4-external-plan-execution-binding-pipeline.md),
[`h4-dreassess-analysis.md`](./h4-dreassess-analysis.md),
[`h4-daudit-analysis.md`](./h4-daudit-analysis.md).

> This is a mutable implementation plan. Delivered phases are summarized as outcomes rather
> than left as a live work list; the merged PRs remain the detailed historical implementation
> record. The executable work in this document is Phase 5 and Phase 6.

---

## Current verified state

Re-verified against `main` at `78a2e11` (PR #468), after #465/#466/#467 and the rules-budget
follow-up #468.

A v4 intraday bundle's non-primary member is now:

1. resolved into a real window placement;
2. represented by an external-plan occurrence with transactional window exclusivity;
3. reserved against the persisted date-level `daily_ledgers` aggregate;
4. reassessed through D-REASSESS rather than the ordinary post-training recovery envelope;
5. recorded through D-AUDIT with deterministic/idempotent decision identity;
6. surfaced as an `additionalSessions` entry;
7. given a Start control only for `proceed` + a valid binding; and
8. atomically claimed against the occurrence/ledger state before execution starts, with
   rollback if definition resolution or runner start fails.

The remaining release gap is narrower: **`useSessionRunner.completeSession` does not write an
`immediate` `SessionResponse`.** It persists completion and tissue feedback, but no response
record exists for D-REASSESS's post-predecessor confirmation gate. A dependent PM member
therefore stays `pending` even after a successful AM completion.

### Current authoritative implementation map

| Capability | Current implementation | State |
|---|---|---|
| v4 primary launch binding | `services/sessionAuthoringService.ts` `prepareExternalPlanSessionLaunch` | Delivered (#440) |
| External-plan occurrence identity/lifecycle | `sessions/models.ts`, `services/sessionOccurrenceService.ts` | Delivered (#445) |
| Per-window exclusivity | `session_occurrence_windows`, `windowBinding`, `getOrCreateExternalPlanOccurrence` | Delivered (#448) |
| Atomic re-import supersession | `getOrCreateExternalPlanOccurrence` transaction | Delivered (#448) |
| Date-level reservation serialization | `users/{userId}/daily_ledgers/{date}`, `dailyLedgerAggregateService.ts` | Delivered (#448) |
| Ledger read-side mapping | `engine/intradayLedgerInputs.ts` | Delivered (#448) |
| Canonical reassessment revision type | `engine/intradayReassessment.ts` exported `ReassessmentInputRevision` | Delivered (#450) |
| Transaction-composable provisional decision write | `services/intradayDecisionService.ts` | Delivered (#450) |
| Reject → later recovery identity | generation counter in the date aggregate | Delivered (#451) |
| Non-primary member adjudication | `services/intradayBundleMemberAdjudication.ts` + `Home.tsx` | Delivered (#454) |
| Additional-session launch UI | `components/session/AdditionalSessionsCard.tsx` | Delivered (#465) |
| Atomic launch claim + rollback | `services/intradayLaunchClaim.ts`, `sessionOccurrenceService.releaseOccurrenceClaim`, `Home.tsx` | Delivered (#465) |
| Post-AM immediate response | `services/sessionResponseService.ts` is reusable, but completion has no caller | **Open — Phase 5** |
| Confirmation revision from submitted evidence | `postPredecessorConfirmationRevision` exists in the revision contract | **Open — Phase 5** |
| Cumulative H4 policy transition | `engine/policy.ts` | **Open — Phase 6** |

### Phase-4 implementation decisions that supersede older plan text

PR #465 intentionally settled three details differently from the original step-by-step draft:

1. **Claim from `Home.tsx`, not unconditionally from `App.tsx`.** The primary v4 session uses
   the shared start callback too, but does not have the non-primary member's ledger reservation
   and provisional decision record. Claiming every start there would reject valid primary
   launches. `App.tsx` only propagates definition-resolution failure so the `Home` rollback
   path can observe it.
2. **Validate the D-REASSESS input fingerprint instead of re-running the pure evaluator inside
   the Firestore transaction.** An unchanged `ReassessmentInputRevision` means the verdict's
   consumed inputs are unchanged; a mismatch fails closed and the dashboard recomputes.
3. **Treat sibling `reserved` rows as soft holds at hard-claim time.** Capacity concurrency is
   serialized by the date aggregate. The first eligible claim becomes `in_progress`; the
   second then observes committed consumption and fails if the remainder is insufficient.
   Counting every sibling soft hold as already-spent capacity could deny both candidates.

PR #465 also found and fixed a real rollback mismatch: Firestore rules had to permit
`active -> scheduled` for a claim whose execution never starts. The service guards rollback
with the stronger condition that no execution references that occurrence.

### Lifecycle compatibility after Phase 4

Phase 4 strengthens the **eligible non-primary intraday bundle-member** path to
`scheduled -> active -> completed/abandoned`, with `active -> scheduled` rollback on launch
failure. It did **not** make `claimOccurrenceLaunch` unconditional for the primary v4 session
or every other occurrence-backed execution path. Therefore the existing direct
`scheduled -> completed/abandoned` transitions remain valid compatibility edges after #465;
they should not be removed merely because the non-primary H4 path now claims first.

---

## Delivered phase record

### Phase 1 — occurrence/window correctness — delivered in #448

- adopted #445's discriminated external-plan occurrence contract;
- added date-scoped external-plan occurrence retrieval;
- removed the unused `queueOccurrenceTransition` API;
- persisted `windowBinding` for replay/history **and** enforced D-WINDOW uniqueness through a
  deterministic `session_occurrence_windows/{date-window}` reservation document in the same
  transaction as occurrence creation;
- made re-import supersession atomic and excluded `superseded` / `skipped` occurrences from
  live date reconstruction.

**Settled design choice:** the old “windowBinding vs reservation document” question is no
longer open. The implementation uses both for different purposes: occurrence snapshot for
history plus a per-window reservation document for cross-document exclusivity.

### Phase 2 — shared ledger truth — delivered in #448

- `engine/intradayLedgerInputs.ts` maps occurrence/execution state to D-LEDGER entries;
- `dailyLedgerAggregateService.ts` owns the named date-level serialization document required
  because a Firestore Web transaction cannot query all occurrences for a date;
- the selected storage is `users/{userId}/daily_ledgers/{date}`;
- active member state/existing window bindings are threaded back into placement so started
  history is not moved.

**Settled design choice:** the old “daily recommendation vs dedicated daily ledger” question
is closed. `daily_ledgers/{date}` is the shipped aggregate.

### Phase 3 — adjudication and durable provisional decisions — delivered in #450/#451/#454

- `ReassessmentInputRevision` was unified in #450; `intradayDecision.ts` imports the canonical
  type rather than declaring a divergent copy;
- decision records gained predecessor execution/occurrence identity and deterministic,
  transaction-composable create-if-absent writes;
- #451 added the generation-counter recovery path so a terminal `skipped` occurrence can stay
  immutable while a later `pending`/`proceed` decision creates one new identity;
- #454 landed the non-primary member adjudication loop, reservation/update transaction,
  decision persistence, `additionalSessions` bindings and `Home.tsx` composition.

**Settled design choice:** `ReassessmentInputRevision` unification is no longer an open
question and must not be re-versioned just to solve a problem already closed in #450.

### Phase 4 — launch affordance and atomic claim — delivered in #465

- `AdditionalSessionsCard.tsx` renders window/status and exposes Start only when the binding is
  launchable;
- `services/intradayLaunchClaim.ts` validates the stored provisional decision, current input
  fingerprint and date-ledger revision in one transaction;
- the claim moves the reservation to in-progress without double-charging it and transitions
  the occurrence to `active`;
- concurrent claims serialize through `daily_ledgers/{date}`;
- failures after claim release both the ledger/occurrence state back to launchable scheduled
  state when no execution exists;
- emulator coverage exercises real Firestore transactions/rules; component coverage protects
  the pending/no-Start UI contract.

---

## Remaining release gap

D-REASSESS invariant 3 needs an **actually submitted post-predecessor confirmation**. The
current completion path has the raw ingredients but stops short of creating that record:

- `SessionCompletionSheet` submits `sessionRpe`, optional notes and at most one selected tissue
  region through a `tissueFeedback[]` payload;
- `useSessionRunner.completeSession` writes tissue feedback into the canonical daily check-in,
  commits the execution as `completed`, then best-effort transitions the linked occurrence;
- `sessionResponseService` already supports deterministic `(sourceSession, window)` ids,
  `recordResponse`, `getResponseForWindow`, `updateResponseFacts`, and the fields
  `sessionRpe`, `completedFraction`, `unexpectedFatigue`, `note`;
- no production completion caller currently records `window: 'immediate'`.

Per ADR-0023 D-MRESP, **missing must stay distinct from answered-normal**. Do not fabricate an
immediate response on abandon, restore, provider sync, or a completion path that did not
actually submit the completion sheet.

---

## Phase 5 — post-AM confirmation capture

### 13. Capture the immediate response from a submitted completion

**Files:** `app/src/hooks/useSessionRunner.ts`, focused tests.

After the execution batch commits successfully, persist the submitted completion facts as:

```ts
sourceSession: { kind: 'execution', id: execution.executionId, date: execution.date }
window: 'immediate'
date: execution.date
checkinDate: execution.date
occurrenceId: execution.occurrenceId
facts: {
  sessionRpe,
  completedFraction,
  unexpectedFatigue,
  note: payload.notes,
}
```

Requirements:

- write only when a real `SessionCompletionPayload` was submitted;
- map `payload.notes` explicitly to `SessionResponse.note` -- the two persisted contracts use
  different field names;
- tissue values remain exclusively in `DailySubjectiveCheckin.tissueResponses`; the response
  record stores non-tissue facts + linkage only;
- use `getResponseForWindow` and `updateResponseFacts` for a pre-existing deterministic
  response rather than producing a second record;
- a failed response write must **not** roll back or fail the already-committed workout
  completion; log/surface the missing confirmation and leave the dependent member `pending`
  (fail closed);
- abandon must not create an `immediate` response.

**Why after the execution commit:** response evidence must never claim a completed workout when
the execution transition itself failed. Occurrence bookkeeping can remain best-effort; if it
fails, D-REASSESS still sees the predecessor occurrence as incomplete and therefore remains
pending rather than launching from contradictory state.

### 14. Add the two missing completion facts

**File:** `app/src/components/session/SessionCompletionSheet.tsx`.

Extend `SessionCompletionPayload` and the submitted UI with:

- `completedFraction?: number` (bounded `0..1`);
- `unexpectedFatigue?: boolean`.

Do not infer either silently from set count or elapsed time. The completion sheet already knows
that required steps may be incomplete, but that is not the same evidence as the athlete's
whole-session completion fraction, and `unexpectedFatigue` is explicitly subjective.

The payload type already permits an array of tissue responses, while the current UI emits at
most one selected region. **Phase 5 does not need a multi-region UI redesign to satisfy the
H4 release contract.** Keep the current single-region control unless that UX change is taken as
a separate explicit scope item; D-REASSESS must still fingerprint every canonical tissue
response linked to the predecessor that actually exists.

### 15. Populate `postPredecessorConfirmationRevision`

**Files:** the Phase-3 adjudication input assembly / reassessment-revision helper and focused
reassessment/adjudication tests.

Derive a deterministic confirmation fingerprint from the evidence that can invalidate a
pending PM approval:

- predecessor `immediate` `SessionResponse` identity + `updatedAt`;
- canonical tissue responses whose `sourceSessionRef` points to that predecessor execution,
  including the relevant response values/revision signal;
- absence remains a distinct state and must not hash to the same value as “answered normal”.

Feed that value into the already-shipped optional
`ReassessmentInputRevision.postPredecessorConfirmationRevision`. A later edit to completion
facts or linked tissue evidence must therefore change the input fingerprint and make a stale
launch fail closed/recompute.

### Phase-5 acceptance tests

Add focused tests proving at least:

- completing with a submitted sheet creates one deterministic `immediate` response with the
  execution source, occurrence link and `notes -> note` mapping;
- an existing response is updated rather than duplicated;
- a response-write failure does not fail execution completion;
- completion without a submitted payload and abandonment create no fabricated response;
- missing immediate response keeps the dependent member `pending`;
- favorable submitted evidence can clear the confirmation gate **without increasing authored
  dose**;
- `unexpectedFatigue` / adverse tissue evidence tightens or rejects according to the existing
  D-REASSESS contract;
- editing response/tissue evidence changes `postPredecessorConfirmationRevision`, making an
  earlier launch decision stale.

---

## Phase 6 — policy and contract reconciliation

### 16. Reassessment revision type — already delivered

No work remains here. #450 made `engine/intradayReassessment.ts` the canonical
`ReassessmentInputRevision` declaration and `intradayDecision.ts` imports it. Do not recreate
an obsolete schema-unification task.

### 17. Bump the cumulative policy version from the then-current value

**File:** `app/src/engine/policy.ts`.

The old draft assumed `2026-09-h4-intraday-reassessment-v1` would still be active when Phase 6
landed. That is false: as of `main` at `78a2e11`, the current value is
`2026-09-recommender-recovery-calibration-v1`, and
`2026-09-h4-intraday-reassessment-v1` is already present in
`HISTORICAL_POLICY_VERSIONS`.

When Phase 6 is implemented:

1. read the actual `POLICY_VERSION` on the Phase-6 base commit;
2. append **that then-current value** to `HISTORICAL_POLICY_VERSIONS` if it is not already
   present;
3. set a new cumulative policy id representing the now-live H4 post-predecessor launch
   contract;
4. preserve every existing historical id; do not duplicate the already-historical H4
   reassessment id;
5. run `node scripts/check-policy-drift.mjs <actual-phase6-base-sha>` plus the normal
   simulation/replay checks.

The exact new string is an implementation naming choice, not an unresolved architecture
decision. The required invariant is the ancestry/history transition above.

### 18. Reconcile docs in the same change

This PR (#469) already reconciles the plan index, evaluation, implementation handoff, this PR
3 plan, and the older execution-binding roadmap. There is **no separate outstanding task** to
reconcile that roadmap's historical PR-3 wording after #469.

When Phase 5/6 lands, update these documents again from the implementation that actually
merged rather than pre-declaring the final status.

---

## Non-gating H4 follow-ups outside PR 3

These are real H4 work, but they are **not** blockers for Phase 5/6 and should not be folded
into the completion-response PR merely because they are nearby.

### Ledger remainder/admission in the broader planner

`planner.ts` / `rules.ts` still have separate dedup/accounting mechanisms outside the intraday
bundle path. Unifying those onto D-LEDGER's occurrence/revision identity and using
`computeDailyLedger` remainder / `admitsCandidate` as a real ranking/admission input remains a
separate decision-affecting change.

### Persist resolved bundle placement for display

The earlier D-PLACEMENT wiring attempted to persist resolved bundle placement in the
recommendation audit, but Firestore's rule-expression budget rejected the extra validation.
That **historical blocker is now resolved**: PR #468 reduced recommendation-audit evaluation
cost and closed #435.

The feature itself is still unimplemented. A follow-up can now revisit
`decisionTrace.externalPlan.intradayBundle`, with:

- explicit persisted shape/versioning;
- Firestore rules validation and budget regression coverage;
- replay/tamper behavior;
- UI consumption only after persistence is authoritative.

Do not describe this work as “blocked on the Firestore ceiling” after #468, and do not describe
#468 as if it implemented placement persistence.

---

## Verification strategy

For this docs reconciliation PR, use the latest PR-head CI run as the authoritative result.
It is docs-only and should not change simulations or policy.

For Phase 5/6 implementation, the required validation set is:

```bash
cd app && npm run check
cd app && npm run test:rules
cd app && npm run simulate:scenarios
cd app && npm run simulate:diff
make check
```

Run focused Vitest/emulator targets during development, including:

- `SessionCompletionSheet` payload/controls;
- `useSessionRunner` immediate-response completion behavior;
- `intradayReassessment` confirmation gate/revision invalidation;
- `intradayBundleMemberAdjudication` pending → proceed/reject behavior;
- `intradayLaunchClaim.emulator.test.ts` for real transaction/rules staleness and
  concurrency behavior;
- `AdditionalSessionsCard.test.tsx` to retain no-Start behavior for non-launchable members.

Do not regenerate a committed scenario baseline to hide an unexplained decision diff.

---

## Risks and mitigations for remaining work

- **Completion is a critical path.** Keep `SessionResponse` persistence after the execution
  commit and non-throwing so a telemetry/evidence write cannot strand a completed workout.
- **Missing vs normal evidence.** Never synthesize the immediate response. Missing stays
  pending by design.
- **Retry/double-tap.** Reuse the deterministic response id and update an existing record
  rather than appending duplicates.
- **Tissue authority split.** Do not copy tissue values into `SessionResponse`; keep the
  daily check-in as the sole authority and fingerprint its predecessor-linked evidence.
- **Policy ancestry.** Phase 6 must archive the current global policy at implementation time,
  not an H4 value copied from an older draft.
- **Scope creep.** Do not pull planner-wide ledger unification, placement-audit persistence,
  block-level scaling, or H5 progression into Phase 5 merely because this plan references
  them.

---

## Open question that genuinely remains

1. **Completion-sheet multi-region tissue UX.** The data contract already supports multiple
   `tissueFeedback` entries, but the current UI emits one selected region. H4 can ship Phase 5
   with that existing limitation because tissue truth remains canonical and fail-closed; a
   multi-region UI is a separate UX/product decision unless there is an explicit requirement
   to expand it now.

The previous questions about the date-level lock document, `ReassessmentInputRevision`
unification, window-identity mechanism, provisional D-AUDIT persistence, and re-import
semantics are all settled by merged Phases 1-3 and must not be presented as open choices.

---

## Success criteria

- [x] A v4 bundle's non-primary member is surfaced with its resolved window/status and a Start
      affordance only when a valid `proceed` binding exists.
- [x] Launching it atomically validates current decision/ledger state and claims capacity;
      concurrent contenders cannot both spend the same remaining capacity.
- [x] A `reject` does not leave a live reservation behind, and later recovery uses a new
      generation rather than reactivating terminal history.
- [x] Re-import supersession is atomic; superseded work does not double-reserve the day.
- [x] `scale` / `pending` never receive an executable binding.
- [x] A completed/active occurrence cannot be relaunched through the non-primary claim path,
      and failed execution start rolls the claim back when safe.
- [x] The shared intraday ledger reflects reserved/in-progress/completed/unresolved work and
      serializes hard launch claims through `daily_ledgers/{date}`.
- [ ] Completing the predecessor from a submitted completion sheet records one `immediate`
      `SessionResponse` with the missing completion facts and correct provenance.
- [ ] Post-predecessor response/tissue edits change the confirmation revision and invalidate a
      stale approval.
- [ ] A dependent member can leave `pending` after valid evidence and required separation,
      while adverse/missing evidence remains fail-closed.
- [ ] The cumulative H4 policy version is bumped from the **then-current** global policy and
      that prior value is archived exactly once.
- [ ] Full checks/rules/simulations/policy-drift verification pass on the Phase 5/6
      implementation head.
