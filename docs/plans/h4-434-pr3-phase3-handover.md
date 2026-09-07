# H4 #434 PR 3 — Phase 3 handover: the adjudication loop and `Home.tsx` wiring

**Status:** Handover document for the next implementing agent. Not itself part of the plan's
numbered steps; superseded by whichever PR actually builds the pieces described below (update
or delete this file once that PR merges).

**Read first:** [`h4-434-pr3-bundle-second-member-launch.md`](./h4-434-pr3-bundle-second-member-launch.md)
Phase 3 (steps 8, 8/2a, 9) is the authoritative spec. This document is a map of what already
exists, what's genuinely left, and the traps already found and fixed in adjacent code — it
does not restate the plan's own reasoning.

## Where things stand right now

| PR | State | What it delivered |
|---|---|---|
| [#448](https://github.com/Szczepanov/adaptive-training-recommender/pull/448) | Merged (`ee6d132b`) | Phase 1 (window exclusivity, re-import supersession) + Phase 2 (`intradayLedgerInputs.ts`, `daily_ledgers` aggregate, real `started`/`existingBinding` wiring into `Home.tsx`) |
| [#449](https://github.com/Szczepanov/adaptive-training-recommender/pull/449) | Merged | Docs-only: corrected `docs/plans/README.md`'s stale H4 status |
| [#450](https://github.com/Szczepanov/adaptive-training-recommender/pull/450) | Merged (`eddacc09`) | Unified `ReassessmentInputRevision`; `IntradayDecisionRecord` gained required `predecessorExecutionId`/`predecessorOccurrenceId`; `intradayDecisionService.ts` gained `deterministicIntradayDecisionId`, `decisionRecordsMatch`, `writeProvisionalDecisionInTransaction` |
| [#451](https://github.com/Szczepanov/adaptive-training-recommender/pull/451) | Open, reviewed, believed close to merge | Step 8 item 2a: `daily_ledgers`' `generations` map, `rejectReservationAndIncrementGeneration`, `currentGeneration`, and a backward-compatible `generation` parameter on `deterministicExternalPlanOccurrenceId` (bounded by `MAX_RECOVERY_GENERATION`, added during review) |

**Before starting new work: `git fetch origin main` and confirm #451 is actually merged.**
Everything below assumes its API surface (`rejectReservationAndIncrementGeneration`,
`currentGeneration`, the `generation` parameter) exists on `main`.

## What genuinely remains

Everything else in Phase 3 (the bulk of step 8, and step 9's atomicity requirement) plus all
of Phase 4 (the claim), Phase 5 (`SessionResponse` capture) and Phase 6 (policy bump). This
document only covers the immediate next unit: **the adjudication loop and its `Home.tsx`
wiring** — step 8's actual glue logic, which is what turns four merged PRs of primitives into
something an athlete can see.

The plan itself flags this as the highest-risk remaining piece: *"Dependencies: steps 5-7.
Risk: High (blast radius in a 1,400-line component)"* and separately, for the atomicity
requirement, *"Risk: Low for the record itself; Medium for the atomicity requirement above."*
Four PRs' worth of prior work on this exact plan each found a genuine bug in the PR before it
— budget for the same iterative scrutiny here, not a single freehand pass.

## Every primitive that already exists and is tested

Do not rebuild any of these — compose them.

| Primitive | File | Signature (current, post-#451) |
|---|---|---|
| Reassess one dependent member | `engine/intradayReassessment.ts` | `reassessDependentBundleMember(params: ReassessDependentBundleMemberParams): ReassessmentResult` |
| Compute the input-revision fingerprint | `engine/intradayReassessment.ts` | `computeReassessmentInputRevision(params): ReassessmentInputRevision` |
| Resolve the day's bundle placement | `services/activeExternalPlanService.ts` | `resolveIntradayBundlePlacement(active, date, context: IntradayBundlePlacementContext): BundlePlacementProposal \| null` — `context.memberState` now wired from real occurrence state (via `buildIntradayMemberState`) |
| Map occurrences+executions to ledger entries | `engine/intradayLedgerInputs.ts` | `buildLedgerEntries(inputs: OccurrenceLedgerInput[]): LedgerEntry[]` |
| Create/supersede/window-claim an occurrence | `services/sessionOccurrenceService.ts` | `getOrCreateExternalPlanOccurrence(userId, date, ref, options?: { placementOrder?, windowBinding?, now? })` — **this is generation-0 only**; recovery needs a new call shape, see below |
| Deterministic occurrence id (now generation-aware) | `services/sessionOccurrenceService.ts` | `deterministicExternalPlanOccurrenceId(date, ref, generation = 0): Promise<string>` |
| Bundle-member occurrence query | `services/sessionOccurrenceService.ts` | `getExternalPlanOccurrencesForDate(userId, date): Promise<ExternalPlanSessionOccurrence[]>` — excludes `superseded`/`skipped` |
| Seed/read the day's reservation aggregate | `services/dailyLedgerAggregateService.ts` | `seedIfAbsent(transaction, userId, date, existing, ceilings, inputs, now?)`, `.get(userId, date)` |
| Add/remove one reservation | `services/dailyLedgerAggregateService.ts` | `applyReservation(transaction, userId, date, current, occurrenceId, reservation \| null, now?)` |
| Reject: drop reservation + bump generation, one write | `services/dailyLedgerAggregateService.ts` | `rejectReservationAndIncrementGeneration(transaction, userId, date, current, occurrenceId, sessionId, now?): { aggregate, generation }` |
| Read the current recovery generation | `services/dailyLedgerAggregateService.ts` | `currentGeneration(aggregate, sessionId): number` |
| Deterministic decision id | `services/intradayDecisionService.ts` | `deterministicIntradayDecisionId(occurrenceId, reassessmentInputRevision): Promise<string>` |
| Ambiguous-retry match predicate | `services/intradayDecisionService.ts` | `decisionRecordsMatch(a, b): boolean` |
| Write the decision inside a caller's transaction | `services/intradayDecisionService.ts` | `writeProvisionalDecisionInTransaction(transaction, userId, existing, record): IntradayDecisionRecord` |
| Prepare a v4 session's execution binding | `services/sessionAuthoringService.ts` | `prepareExternalPlanSessionLaunch(userId, externalPlan, options?: { date?, occurrenceId?, placementOrder?, windowBinding? })` |

## What step 8's loop actually has to do, per member

Re-reading the plan's own numbered sub-steps (8.1–8.5, 8/2a) against what exists:

1. **Adjudicate before creating anything.** Call `reassessDependentBundleMember` first. Its
   `dailyLedger` param must be built from **all of today's occurrences except the target's
   own** — if the target already has a `scheduled` reservation from an earlier load, and you
   don't exclude it, `admitsCandidate` measures the candidate against a remainder its own
   reservation already reduced (a member admitted at 09:00 flips to rejected at 09:05 with
   every real input unchanged). Filter it out of the `OccurrenceLedgerInput[]` before calling
   `buildLedgerEntries`/`computeDailyLedger`.
2. **`reject`** → create nothing. If a `scheduled` occurrence already exists for this member
   (from an earlier load whose verdict has since flipped), call
   `rejectReservationAndIncrementGeneration`. If it's `active`/`completed`, touch nothing —
   `active → skipped` isn't even a legal transition, and the work is real.
3. **Recovery (2a).** If the existing occurrence for this `(planId, sessionId)` is `skipped`
   and the new verdict is `pending`/`proceed`, this is a recovery: read
   `dailyLedgerAggregateService.currentGeneration(aggregate, sessionId)` and pass it to
   `deterministicExternalPlanOccurrenceId(date, ref, generation)` to mint the successor's id
   — **do not** call the existing generation-0-only `getOrCreateExternalPlanOccurrence` as-is
   for this path; either give it an optional `generation` parameter (mirroring how
   `windowBinding` was threaded through in #448) or build a small dedicated recovery
   constructor. Either way, the skipped record must never be touched or reactivated.
4. **`pending`/`scale`** → create the occurrence (generation-aware per above), add its
   reservation to the aggregate, emit **no binding**.
5. **`proceed`** → create the occurrence, add its reservation, call
   `prepareExternalPlanSessionLaunch`, attach `{ ...binding, occurrenceId }`.

**The atomicity requirement (step 9):** for `proceed`/`pending`/`scale`, the occurrence
create + aggregate reservation + decision-record write must be **one transaction**. None of
`getOrCreateExternalPlanOccurrence`, `dailyLedgerAggregateService`'s methods, or
`writeProvisionalDecisionInTransaction` currently compose themselves — they're designed to be
called from a shared caller-owned transaction (see how `getOrCreateExternalPlanOccurrence`
already does its own multi-document transaction internally as a model to follow, then extend
it to also call `aggregate.seedIfAbsent`/`applyReservation` and
`writeProvisionalDecisionInTransaction` against the *same* `transaction` object before
returning). Remember Firestore's reads-before-writes rule: every `transaction.get` this
combined operation needs (occurrence, prior-revision occurrence, window reservation,
aggregate, existing decision record) must happen before any `transaction.set`.

**The revision stored in the decision record must be the post-reservation one, not the
pre-create one** — compute `reassessmentInputRevision` before creating anything, but only
*write* the decision record after the aggregate's reservation write is queued in the same
transaction, storing the resulting (already-incremented) `ledgerRevision`. Storing the
pre-create value makes the claim reject the member on its own reservation write; see the
plan's step 9 for why.

## Where this plugs into `Home.tsx`

The manual-additional-session loop at `Home.tsx` (search for `additionalOccurrences`, around
where `additionalBindings`/`additionalNotices` are built) is the model to extend, not the
`externalPlanContextForDate` call earlier in the same function (that call only ever resolves
the *primary* session). At that point in the function you already have in scope, unmodified:

```ts
envelopeState   // from evaluateReadinessAndSafetyEnvelope(...)
availability    // from resolveAvailability(...)
subjective, objective, context, input.subjectiveBaseline  // == DailyReadiness's own shape
baseRecommendation.executionDose
acceptedSameDaySystemicCost, acceptedSameDayMinutes
input.date
```

`DailyReadiness` (`engine/models.ts`) is exactly `{ subjective, objective, subjectiveBaseline? }`
— the same object literal already constructed inline at several existing call sites in this
function. No new readiness-shape mapping is needed.

To get the non-primary bindings, call `resolveIntradayBundlePlacement` directly (the same
`bundleContext` already built for `externalPlanContextForDate`) and take every entry in
`result.bindings` after `bindings[0]` (the primary, already handled). Per the plan: extract
the whole loop into `app/src/services/intradayBundleMemberAdjudication.ts` returning
`{ bindings, statuses, notices }` — keep `Home.tsx`'s own addition to a call plus attaching
the result to `additionalSessions`/rationale, not the adjudication logic itself.

**Guard rails carried over from PR 1 (`h4-external-plan-execution-binding-pipeline.md`) —
still apply here:** `isV4Plan` discriminator before touching any session; reject `isEvent`
sessions; never bind `rest_01`; never launch on a `scale` verdict (no block-level transformer
exists — advice only, no binding); cap total `additionalSessions` at 4
(`validationCore.ts`), counting the manual additional-session bindings already produced
earlier in the same function.

## Traps already found and fixed in adjacent code — do not reintroduce these

These are documented in file/PR-review history; re-derive them here rather than assuming
they're solved elsewhere:

- **`alreadyTrainedOverride`.** Once the AM execution completes, `objective.today_training`
  is non-null and `evaluateReadinessAndSafetyEnvelope` forces `mode = 'recover'`, which
  `adjudicateAuthoredSession` then rejects outright. **Never call `adjudicateAuthoredSession`
  for a bundle member** — `reassessDependentBundleMember` is the authority that bypasses this
  correctly (same-day load is already accounted for via the ledger, not the single-session
  circuit breaker).
- **Self-consumption.** Covered above (step 8.1) — exclude the target's own reservation from
  its own reassessment.
- **Firestore rules reject same-window reservation handoff via plain `update`.** Already
  fixed (#448 follow-up) — `session_occurrence_windows` allows a constrained update
  (`date`/`windowId` immutable, `occurrenceId`/`createdAt` may change). If you build a
  dedicated recovery path that reuses a window, this rule already supports it; verify against
  the real emulator if you change the reservation-handoff logic at all — this exact bug
  shipped once behind passing mocked-transaction tests.
- **Deterministic ids must stay backward-compatible.** `deterministicExternalPlanOccurrenceId`'s
  `generation = 0` default must keep hashing identically to pre-#451 output. Same principle
  applies to any further id-scheme extension: default parameters, never change what's already
  hashed for the common case.
- **`predecessorExecutionId`/`predecessorOccurrenceId` are a required pair, both-or-neither
  null.** An order-0 bundle member (no `afterSessionId`) has no predecessor — both `null`.
  Any dependent member must supply both.
- **Ambiguous-acknowledgement retries.** `writeProvisionalDecisionInTransaction` already
  handles this (exact-match-or-throw on `occurrenceId`, predecessor identity, `verdict`,
  `reassessmentInputRevision`) — do not add a second retry mechanism on top of it.

## Verification bar to match

Every prior PR in this chain was verified with, at minimum:

```bash
cd app && npm run typecheck && npx eslint <changed files>
```
```bash
cd app && npx vitest run
```
```bash
cd app && npx firebase emulators:exec --only firestore --project demo-adaptive-training "npx vitest run src/emulator/<relevant files>"
```
```bash
cd app && node scripts/simulate-scenarios.mjs && node scripts/check-policy-drift.mjs origin/main
```

Two environment notes from this session, not this codebase's own documentation:

- The full 14-file emulator suite (`npm run test:rules`) has shown session-level
  resource-contention flakiness after many consecutive full-suite invocations in one sitting
  — unrelated pre-existing files fail with hook/test timeouts under load that have nothing to
  do with the change being tested. A scoped run of just the files you touched plus
  `firestoreRules.emulator.test.ts` is reliably clean and much faster; use the full suite once
  per PR, not once per iteration.
- `@firebase/rules-unit-testing`'s `.firestore()` is typed as the legacy compat SDK but
  actually returns a modular-SDK-compatible instance at runtime; a real service class
  constructed with it needs `as unknown as Firestore` at the call site (see
  `emulator/sessionOccurrenceService.emulator.test.ts` for the precedent — the first
  real-service-against-emulator test in this codebase, as opposed to raw rules-only
  `assertSucceeds`/`assertFails` calls).

## Not covered by this document

Phase 4 (the atomic claim wired to `daily_ledgers`, the new `AdditionalSessionsCard` UI,
release-on-failed-start), Phase 5 (`SessionResponse` capture in `useSessionRunner.ts` on AM
completion — without it, every dependent bundle member stays `pending` forever, since nothing
currently writes an `immediate`-window response), and Phase 6 (`POLICY_VERSION` bump, once
this wiring actually changes a live recommendation decision — `check-policy-drift.mjs` will
tell you the moment it does).
