# H5c — athlete-scoped singleton progression-claim design

**Status:** Approved (design agreed) — not `Ready`: this document specifies the
confirmation/singleton-claim contract; no code exists yet.
**Blocked by:** Nothing for the design itself. Implementation additionally needs "the
existing authoring boundary" that produces a new plan/definition revision to be named
concretely (see Work item 3) — that boundary already exists elsewhere in the codebase but
has not yet been identified as the specific integration point H5c's confirmation writes
through.
**Unlocks:** H5c implementation (athlete-confirmed bounded progression revisions);
cumulative `external-plan@5` acceptance, which the cycling hybrid evaluation plan already
notes is otherwise unblocked now that H4's v4 contract has landed.
**Governs:** [ADR-0037](../adr/0037-block-intent-and-controlled-progression.md) D-AUTHORITY,
D-CHANGE's one-active-experiment rule.
**Builds on:** H5a (`engine/blockIntent.ts`, `engine/blockIntentReplay.ts`) and H5b
(`engine/progressionReview.ts`), both delivered. The transaction shape below is modeled
directly on H4's `services/intradayLaunchClaim.ts` (`claimIntradayMemberLaunch` /
`releaseIntradayMemberClaim`) and `services/dailyLedgerAggregateService.ts` — the closest
existing "one addressable claim document + revision-gated transaction + compare-and-clear
release" precedent in this codebase.

## Goal

Specify, before any code is written, how confirming a `progressionReview.ts` proposal
(`advance_proposal` / `reduce_proposal` / `redirect`) can create exactly one new bounded
progression revision per athlete at a time — atomically, without a query-then-create race,
idempotently under retry, and without ever losing or double-applying an increment.

## Preconditions

- H5a's `IntentBlock`/`BlockProgressionContract` and H5b's `evaluateProgressionReview` are
  delivered (they are).
- ADR-0037 is Accepted (it is); this document does not reopen its decisions, only fills in
  the transaction/schema detail it deliberately left to implementation.

## Design

### The invariant, quoted from the ADR

ADR-0037 D-CHANGE: *"At most one confirmed active progression experiment is allowed per
athlete across active blocks in the initial release... Pending proposals are not active
experiments and do not acquire the singleton slot; they may coexist until one is confirmed,
rejected, superseded or withdrawn."*

D-AUTHORITY states the atomicity bar directly: confirmation must, in one Firestore
transaction (or equivalent serializable compare-and-set), either (1) observe no competing
non-terminal claim, validate the proposal against the still-current source revision, write
the forward-only revision/activation records, and acquire the claim — or (2) fail
deterministically without activating anything or applying any dose revision. It explicitly
forbids establishing uniqueness by querying active block/proposal collections and then
creating an experiment outside that same atomic operation, "because that check can race
across blocks."

### 1. Claim document

**Path:** `users/{userId}/progression_experiment_claim/{singleton}` — one fixed-id document
per athlete, independent of block/proposal storage (per the ADR's own requirement that the
claim's identity not be derivable by querying blocks).

```ts
interface ProgressionExperimentClaim {
    userId: string;
    state: 'held' | 'released';
    experimentId: string;
    blockId: string;
    proposalId: string;
    sourcePlanRevision: number;
    activationRevisionId: string;   // id of the created forward-only revision record
    acquiredAt: string;
    revision: number;               // bumped by exactly 1 on every mutation
    createdAt: string;
    updatedAt: string;
}
```

Why one fixed id rather than a per-block or per-date document (unlike H4's
`daily_ledgers/{date}`): the rule being enforced is per-*athlete*, not per-*day* or
per-*block* — a `daily_ledgers`-shaped per-block claim would let two blocks each acquire
their own claim and both proceed, which is exactly the race the ADR prohibits.

### 2. Confirmation transaction

`confirmProgressionRevision(userId, blockId, proposalId, expectedSourcePlanRevision, proposedChange)`,
modeled directly on `claimIntradayMemberLaunch`'s structure:

1. **Reads before writes** (Firestore's own rule, and the pattern H4 already follows):
   read the claim document by direct reference; read the block/plan document at
   `expectedSourcePlanRevision`'s path to confirm it is still current; read any existing
   activation record for `(blockId, proposalId)` for idempotency.
2. **Branch, inside the same transaction:**
   - Existing activation record for this exact `(blockId, proposalId)` already exists →
     return it unchanged (idempotent replay; no second increment, no second claim write).
   - Claim `state == 'held'` and `experimentId` belongs to a *different* block/proposal →
     fail with `active_progression_experiment_exists` (a typed conflict, not a thrown
     Firestore error — mirror `StaleDecisionCode`'s pattern in `intradayLaunchClaim.ts`).
   - Current source plan revision does not match `expectedSourcePlanRevision` → fail with a
     **distinct** conflict, e.g. `stale-source-revision` (never collapse this into the same
     code as the previous branch — a caller needs to know whether to re-fetch the proposal
     or tell the athlete someone else is mid-experiment).
   - Otherwise: write the new forward-only revision/activation record through "the existing
     authoring boundary" (name the concrete function once identified — see Work item 3) and
     `transaction.set` the claim to `{ state: 'held', experimentId, blockId, proposalId,
     sourcePlanRevision: expectedSourcePlanRevision, activationRevisionId, revision:
     current.revision + 1, ... }` in the same transaction.
3. **No query-then-create, ever.** Step 1 reads the claim by direct document reference
   only. Nothing in this function runs a collection query across blocks or proposals before
   acquiring the claim.

### 3. Release (compare-and-clear)

`releaseProgressionClaim(userId, experimentId)`, modeled on `releaseIntradayMemberClaim`:
read the claim; if `state !== 'held'` or `claim.experimentId !== experimentId`, no-op /
return `{ released: false }` — a delayed cleanup for an old experiment must never clear a
newer one's claim, exactly as `releaseIntradayMemberClaim` refuses to reverse a reservation
that isn't in the exact state it expects. Only when the stored identity matches does the
transaction set `state: 'released'` and bump `revision`.

Called when an experiment reaches a terminal state: completed its bounded run, was
cancelled, or was redirected per D-CHANGE's `redirect` action.

### 4. Firestore rules sketch

Model on `daily_ledgers`'s revision-gated update, in the same shallow/structural style PR
#468 established (detail validation at the TS boundary, not in rules):

```
match /users/{userId}/progression_experiment_claim/{singleton} {
  allow read: if isOwner(userId);
  allow create: if hasValidProgressionClaim(userId);
  allow update: if hasValidProgressionClaim(userId)
    && keepsOwnership(userId)
    && request.resource.data.revision == resource.data.revision + 1;
  allow delete: if false;
}
```

`hasValidProgressionClaim` checks `state in ['held', 'released']`, required-key shape, and
bounded string sizes only — no cross-field business logic in rules, matching the lesson
`recommendationAudit`'s budget failure already taught this codebase.

### 5. Idempotency and failure-mode table

| Scenario | Required outcome |
|---|---|
| Two concurrent confirmations for two *different* blocks/proposals | Exactly one commits and acquires the claim; the other fails with `active_progression_experiment_exists` |
| The same confirmation retried (network retry, double-tap) | Returns/reuses the existing activation; claim revision does not increment a second time |
| Source plan revision moved since the proposal was generated | Fails with the stale-source conflict; no claim/activation write |
| Release racing a newer confirmation for a different experiment | The stale release's `experimentId` no longer matches; it no-ops, never clearing the newer claim |
| Failure between validation and commit (e.g. transaction abort) | Neither an orphan claim nor a partial activation record exists — Firestore transactions already give this atomicity by construction; no custom two-phase cleanup is needed *inside* the transaction, only correct ordering of what the transaction writes |

## Tests to add (at implementation time)

- Concurrent-confirmation test: two parallel `confirmProgressionRevision` calls for
  different experiments against an empty claim — assert exactly one activation and exactly
  one `active_progression_experiment_exists` conflict (a real emulator transaction-race
  test, not a mocked sequential call — the guarantee being tested is Firestore's own
  transaction serialization).
- Idempotent-retry test: same `(blockId, proposalId)` confirmed twice — second call returns
  the first's activation, claim revision unchanged after the second call.
- Stale-source test: source plan revision bumped between proposal generation and
  confirmation — confirmation fails with the distinct stale-source conflict, no claim/
  activation written.
- Compare-and-clear test: release called with a stale `experimentId` after a newer
  experiment has already acquired the claim — release no-ops, newer claim intact.
- Rules emulator test mirroring the `daily_ledgers` pattern: revision-jump rejection,
  cross-user denial, delete always denied.

## Acceptance criteria

- [ ] Exactly one athlete-scoped claim document model exists, independent of block storage.
- [ ] Confirmation acquires the claim and writes the forward-only revision in one
      transaction; no code path queries blocks/proposals before acquiring the claim.
- [ ] Two distinct, typed conflict codes exist for "claim held by another experiment" vs.
      "stale source revision."
- [ ] Repeated confirmation of the same proposal is provably idempotent (test above).
- [ ] Release is compare-and-clear and cannot clear a claim it does not own.
- [ ] `POLICY_VERSION` is bumped only if/when H5c's confirmation path is wired into daily
      recommendation selection — this design doc's scope (confirmation/claim mechanics) does
      not by itself change decision behavior.

## Risks & rollback

- **Getting the claim scope wrong (per-block instead of per-athlete)** would silently
  reintroduce the exact race the ADR prohibits. The design fixes this by making the claim
  document's path athlete-scoped only, with no block/date segment.
- **Reusing `StaleDecisionCode`-style stringly-typed conflicts without keeping them
  distinct** would make callers unable to tell a "someone else is experimenting" state from
  a "your proposal is stale" state, which the ADR explicitly requires to stay separate.
- Rollback is simple because nothing is implemented yet: this document can be revised or
  superseded without any migration, since no claim documents exist in production.

## Out of scope (for this design; left for implementation or a later document)

- The confirmation review UI (before/after dose, tradeoffs, affected future sessions
  display).
- Naming the concrete "existing authoring boundary" function that creates the new plan/
  definition revision — an implementation-time task, not a design decision.
- Cumulative `external-plan@5` (depends on this design, but is separately scoped).
- Wiring `progressionReview.ts`'s output into any live recommendation-selection path — H5b
  remains report-only until H5c's confirmation path is built and separately policy-reviewed.

## Docs to update once this lands

- `docs/plans/README.md`'s H5 row — link this document, note H5c now has an accepted design.
- `docs/plans/cycling-primary-hybrid-evaluation.md`'s H5 section — replace "H5c needs the
  athlete-scoped singleton progression-claim transaction design" with a link here.
