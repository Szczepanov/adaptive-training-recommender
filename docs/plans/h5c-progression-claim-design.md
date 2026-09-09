# H5c — athlete-scoped singleton progression-claim design

**Status:** Approved (design agreed) — not `Ready`: this document specifies the
confirmation/singleton-claim contract; no code exists yet.
**Blocked by:** Investigated 2026-09-09: no `IntentBlock` persistence exists yet at all (H5a
delivered only the in-memory validation/replay model). Runtime implementation must first
**build** that persistence as a transaction-composable primitive (there is no existing
boundary to adapt -- see "Authoring-boundary implementation gate" below for what was checked
and why `PlanBlockService`/`ExternalPlanService` are each a mismatch) so the accepted plan
revision, singleton claim and activation audit are committed by the **same caller-owned
Firestore transaction**. A primitive that starts its own transaction or calls `setDoc` out of
band does not satisfy this design.
**Unlocks:** H5c implementation (athlete-confirmed bounded progression revisions);
cumulative `external-plan@5` acceptance, which the cycling hybrid evaluation plan already
notes is otherwise unblocked now that H4's v4 contract has landed.
**Governs:** [ADR-0037](../adr/0037-block-intent-and-controlled-progression.md) D-AUTHORITY,
D-CHANGE's one-active-experiment rule.
**Builds on:** H5a (`engine/blockIntent.ts`, `engine/blockIntentReplay.ts`) and H5b
(`engine/progressionReview.ts`), both delivered. The compare-and-clear/revision discipline
is modeled on H4's `services/intradayLaunchClaim.ts` and
`services/dailyLedgerAggregateService.ts`, but H5c additionally needs a deterministic
activation record because confirmation must be idempotent across client/network retries.

## Goal

Specify, before any code is written, how confirming a `progressionReview.ts` proposal
(`advance_proposal` / `reduce_proposal` / `redirect`) can create exactly one new bounded
progression revision per athlete at a time — atomically, without a query-then-create race,
idempotently under retry, and without ever losing or double-applying an increment.

## Preconditions

- H5a's `IntentBlock`/`BlockProgressionContract` domain model and H5b's
  `evaluateProgressionReview` are delivered (they are) -- as pure, in-memory/import-time
  logic only. Neither delivery included any Firestore persistence for `IntentBlock`; see
  "Authoring-boundary implementation gate" below.
- ADR-0037 is Accepted (it is); this document does not reopen its decisions, only fills in
  the transaction/schema detail it deliberately left to implementation.
- Before runtime activation, `IntentBlock` persistence must be built (not merely adapted --
  it does not exist yet) as a primitive that can enqueue its reads/writes on a **transaction
  supplied by the H5c caller**. No nested `runTransaction`, `setDoc`, network side effect,
  telemetry emission or other non-transactional mutation may occur from inside the retriable
  callback.

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

### 1. Singleton claim document

**Literal path:** `users/{userId}/progression_experiment_claim/current`.

`current` is part of the invariant, not an example id. Using
`progression_experiment_claim/{singleton}` would let multiple differently named documents
exist and would leave "singleton" enforcement to application convention. A literal path
lets both application code and Firestore rules address exactly one athlete-scoped claim.

```ts
interface ProgressionExperimentClaim {
    userId: string;
    state: 'held' | 'released';
    experimentId: string;
    blockId: string;
    proposalId: string;
    sourcePlanRevision: number;
    activationKey: string;
    activationRevisionId: string;   // id of the created forward-only plan/definition revision
    acquiredAt: string;
    revision: number;               // bumped by exactly 1 on every mutation
    createdAt: string;
    updatedAt: string;
}
```

Why one fixed id rather than a per-block or per-date document (unlike H4's
`daily_ledgers/{date}`): the rule being enforced is per-*athlete*, not per-*day* or
per-*block* — a per-block claim would let two blocks each acquire their own claim and both
proceed, exactly the race ADR-0037 prohibits.

### 2. Deterministic activation/idempotency document

**Path:** `users/{userId}/progression_experiment_activations/{activationKey}`.

`activationKey` must be a deterministic, bounded, Firestore-safe encoding/hash of
`(blockId, proposalId)` produced by one shared helper. It must not contain a random UUID or
request timestamp. The same logical confirmation on another tab/device therefore resolves
to the same document reference without a collection query.

```ts
interface ProgressionExperimentActivation {
    userId: string;
    activationKey: string;
    experimentId: string;
    blockId: string;
    proposalId: string;
    sourcePlanRevision: number;
    activationRevisionId: string;
    claimRevision: number;
    activatedAt: string;
    // Minimal before/after values needed to explain/replay the accepted bounded change.
    priorSettings: ProgressionSettingsSnapshot;
    acceptedSettings: ProgressionSettingsSnapshot;
}
```

The activation document is **create-once and immutable**. It is the durable idempotency
answer: if it already exists and its stored block/proposal identity matches the requested
activation, confirmation returns that record unchanged and performs no claim or plan write.
An identity mismatch at the deterministic key is an invariant/data-integrity failure, not a
reason to overwrite it.

### 3. Confirmation transaction

`confirmProgressionRevision(userId, blockId, proposalId, expectedSourcePlanRevision, proposedChange)`:

Before `runTransaction`, compute the literal claim reference, deterministic activation
reference, and any deterministic identifiers/timestamps needed by the attempted activation.
They stay stable if Firestore retries the transaction callback.

Inside one caller-owned Firestore transaction, with **all reads before writes**:

1. Read the activation document by direct deterministic reference.
   - If it exists and matches `(blockId, proposalId)`, return it unchanged. This is the
     idempotent replay path: no second dose increment, plan revision or claim revision.
   - If it exists but the identity does not match, fail with an invariant-conflict result.
2. Read `progression_experiment_claim/current` by direct reference.
3. Read the current authored block/plan state and revision required to revalidate the
   proposal. Do not read a historical path and infer that it is still current.
4. Branch before any write:
   - Claim `state == 'held'` for a different block/proposal → return
     `active_progression_experiment_exists`.
   - Current source revision differs from `expectedSourcePlanRevision`, or the proposal no
     longer validates against the current block state → return the distinct
     `stale-source-revision`/typed revalidation conflict. No claim/activation/plan write.
5. Invoke the shared **transaction-aware authoring primitive** with this same transaction to
   enqueue the normal forward-only plan/definition revision. The primitive must preserve
   every invariant of ordinary authoring; H5c must not invent a parallel storage format.
6. Enqueue claim create/update at the literal `/current` document with
   `revision = previous.revision + 1` (or `1` on first create), the same experiment identity,
   source revision and deterministic `activationKey`.
7. Enqueue **create-only** activation evidence at the deterministic activation document,
   recording the resulting authored revision id and claim revision.
8. Commit. Firestore serialization/retry is the concurrency boundary; no external side
   effect is allowed from inside the retriable callback.

This ordering is deliberate. A transaction retry can rerun validation/application logic, so
random ids, `Date.now()`-style evidence timestamps that change on each callback run,
telemetry, toasts, navigation, or independent writes belong outside the callback. Only the
transaction's own reads/writes may determine committed state.

### 4. Release (compare-and-clear)

`releaseProgressionClaim(userId, experimentId)`, modeled on `releaseIntradayMemberClaim`:
read `/progression_experiment_claim/current`; if `state !== 'held'` or
`claim.experimentId !== experimentId`, no-op / return `{ released: false }` — a delayed
cleanup for an old experiment must never clear a newer one's claim. Only when the stored
identity matches does the transaction set `state: 'released'` and bump `revision`.

The immutable activation record is **not** deleted or mutated on release. It remains the
historical/idempotency evidence for that accepted proposal.

Release is called when an experiment reaches a terminal state: completed its bounded run,
was cancelled, or was redirected per D-CHANGE's `redirect` action.

### 5. Firestore rules sketch

Use a literal claim path and an immutable activation collection. Keep rules shallow and
structural, following PR #468's rule-budget lesson; proposal business validation remains in
the transaction service/authoring boundary.

```text
match /users/{userId}/progression_experiment_claim/current {
  allow read: if isOwner(userId);
  allow create: if hasValidProgressionClaim(userId)
    && request.resource.data.revision == 1;
  allow update: if hasValidProgressionClaim(userId)
    && keepsOwnership(userId)
    && request.resource.data.revision == resource.data.revision + 1;
  allow delete: if false;
}

match /users/{userId}/progression_experiment_activations/{activationKey} {
  allow read: if isOwner(userId);
  allow create: if hasValidProgressionActivation(userId, activationKey);
  allow update, delete: if false;
}
```

`hasValidProgressionClaim` / `hasValidProgressionActivation` check exact required-key shape,
ownership, bounded strings/numbers, and for the activation record that the payload's
`activationKey` equals the path id. They do not query blocks or encode the progression
policy in rules.

### 6. Idempotency and failure-mode table

| Scenario | Required outcome |
|---|---|
| Two concurrent confirmations for two *different* blocks/proposals | Exactly one commits and acquires `/current`; the other retries/observes the held claim and returns `active_progression_experiment_exists` |
| Two concurrent confirmations for the *same* block/proposal | Both resolve the same deterministic activation reference; exactly one authored revision and one activation are committed, and both callers resolve to that activation |
| Same confirmation retried after network ambiguity/double-tap | Direct-read existing activation and return it; claim revision and authored plan revision do not increment again |
| Source plan revision moved since proposal generation | Typed stale/revalidation conflict; zero claim, activation or authored-plan writes |
| Release racing a newer confirmation for another experiment | Stale release identity does not match `/current`; no-op, newer claim remains held |
| Transaction callback retries | Deterministic refs/ids remain stable; callback performs no out-of-band side effects; one atomic committed state exists |
| Transaction aborts | Neither orphan claim, partial activation nor partial authored revision exists |

## Authoring-boundary implementation gate

**Investigated (2026-09-09): no such boundary exists yet.** `IntentBlock` (H5a,
`engine/blockIntent.ts`) has no Firestore document type or persistence path anywhere in the
repository today — it is a pure in-memory/import-time validation and replay model
(`validateIntentBlock`, `blockIntentReplay.ts`). There is no function anywhere that writes an
`IntentBlock` or a document literally named `PlanDefinition`; `PlanDefinition`
(`engine/planSchedule.ts`) is itself a pure computed/derived model rebuilt on every read, never
`setDoc`'d.

The two persistence paths that could plausibly have been "the" authoring boundary are both a
mismatch:

- `PlanBlockService` (`services/planBlockService.ts`) persists `AuthoredPlanBlock` -- despite
  the name, this is only the travel-calendar overlay (`phase: 'travel'`, dose-scale
  multipliers), not an objectives/progression revision. Its `create`/`update` call
  `addDoc`/`setDoc` directly with no transaction and no revision precondition at all.
- `ExternalPlanService.import` (`services/externalPlanService.ts`) is the closest analog by
  shape -- real revision numbers, `contentHash` provenance, a `revision-not-newer` precondition
  -- but that precondition is a plain `getDoc` *before* a `writeBatch`, not a transaction, so
  it is a read-then-write race today, and it owns its own batch rather than accepting a
  caller-supplied transaction.

So this is not "identify and adapt an existing primitive" -- it is **build `IntentBlock`
persistence for the first time**, transaction-composable from day one, following the
already-precedented pattern in this codebase for exactly that shape:
`DailyLedgerAggregateService`'s `applyReservation`/`seedIfAbsent`
(`services/dailyLedgerAggregateService.ts`) take a caller-supplied `Transaction` and perform
no `runTransaction`/`setDoc` of their own; `SessionOccurrenceService` is the composing owner
that opens the transaction and calls into them. H5c's authoring primitive should have the same
shape: `applyIntentBlockRevision(transaction: Transaction, userId: string, current:
IntentBlock | null, next: IntentBlock): void`-ish, with H5c's confirmation transaction as the
composing owner (not a new nested `runTransaction`).

The implementation work item is therefore:

1. Design and add the actual `IntentBlock` Firestore schema/collection (path, revision
   precondition, provenance fields) -- there is no existing shape to reuse verbatim; base it on
   `ExternalPlanService`'s revision/hash provenance discipline rather than `PlanBlockService`'s
   plain-overwrite one.
2. Add a transaction-composable write primitive for it, in the
   `DailyLedgerAggregateService`-style shape above -- no internal `runTransaction`/`setDoc`.
3. Add matching Firestore rules (shallow/structural, per PR #468's lesson) and emulator tests
   for the new collection on its own, independent of H5c's claim/activation collections.
4. Only then wire H5c's confirmation transaction to call into it as one composing owner.
5. Prove with tests that H5c confirmation cannot create a plan revision if claim/activation
   commit fails, and cannot acquire a claim if plan revision creation fails.

Calling a hypothetical future `setDoc`-based `IntentBlock` helper from inside the H5c callback,
or starting a nested transaction, would violate D-AUTHORITY even if happy-path tests pass --
the primitive must be transaction-composable from its very first commit, not retrofitted.

## No recommendation-time query

The direct activation/claim/current-plan reads above happen only during an explicit athlete
confirmation. They must **not** be added to ordinary recommendation generation. H5b remains
report-only until H5c is separately implemented/activated, so this design adds no
recommendation-time read or latency path.

## Tests to add (at implementation time)

- Real-emulator concurrent confirmation: two different proposals against an empty claim —
  exactly one activation; the other returns `active_progression_experiment_exists`.
- Real-emulator same-proposal race: two tabs confirm identical `(blockId, proposalId)` —
  one activation document and exactly one authored revision; both callers resolve the same
  activation.
- Idempotent retry after simulated network ambiguity — existing deterministic activation is
  returned; claim and authored revision counters are unchanged.
- Stale-source test: bump source plan revision between proposal generation and confirmation —
  typed stale conflict and **zero writes** to claim/activation/accepted plan revision.
- Authoring atomicity test: force the authoring mutation/precondition to fail — claim and
  activation remain absent/unchanged; force activation/claim failure — authored revision is
  absent.
- Compare-and-clear test: stale `experimentId` cannot release a newer held claim.
- Rules emulator tests: literal `/current` ownership/shape/revision checks; differently named
  claim documents are not writable; activation create shape/key binding; activation update
  and delete are always denied; cross-user access denied.

## Acceptance criteria

- [ ] The only writable athlete-scoped claim path is
      `users/{userId}/progression_experiment_claim/current`.
- [ ] A deterministic `(blockId, proposalId)` activation key is shared by code, tests and
      rules; activation evidence is create-once/immutable.
- [ ] Confirmation reads an existing activation by direct reference first and is idempotent
      across concurrent same-proposal calls and client/network retries.
- [ ] Claim, accepted forward-only plan/definition revision and activation audit commit in
      one caller-owned transaction through the **normal transaction-aware authoring
      boundary**.
- [ ] No code path queries blocks/proposals to establish singleton uniqueness.
- [ ] Distinct typed conflicts exist for "another active experiment", stale source/revalidation,
      and deterministic-key invariant mismatch.
- [ ] Release is compare-and-clear and cannot clear a claim it does not own.
- [ ] H5c adds no recommendation-time query/read path while still report-only.
- [ ] `POLICY_VERSION` is bumped only if/when H5c is wired into live recommendation
      selection; this design/confirmation persistence alone does not change decision policy.

## Risks & rollback

- **Convention-only singleton id:** allowing `{singleton}` as an arbitrary id can create two
  claim documents. The literal `/current` path removes that ambiguity.
- **Query-based idempotency:** searching for "any existing activation" can race or require
  indexes. The deterministic activation reference makes idempotency a direct transactional
  read.
- **Nested/out-of-band authoring write:** a helper that starts its own transaction or calls
  `setDoc` breaks the atomicity promised by D-AUTHORITY. The transaction-aware authoring
  boundary is therefore an implementation blocker, not cleanup work.
- **Retry side effects:** Firestore may rerun transaction callbacks. Keeping ids/timestamps
  stable and all side effects outside the callback prevents duplicate observable actions.
- Rollback remains simple because nothing is implemented yet: this design can be revised or
  superseded without data migration.

## Out of scope (for this design; left for implementation or a later document)

- The confirmation review UI (before/after dose, tradeoffs, affected future sessions display).
- Building the `IntentBlock` persistence/authoring primitive itself -- that is the first
  implementation gate above (items 1-3), not something this design document does.
- Cumulative `external-plan@5` (depends on H5c, separately scoped).
- Wiring `progressionReview.ts` output into live recommendation selection — H5b remains
  report-only until H5c's confirmation path is built and separately policy-reviewed.

## Docs to update once runtime implementation lands

- `docs/plans/README.md` H5 row/status — distinguish accepted design from implemented H5c.
- `docs/plans/cycling-primary-hybrid-evaluation.md` H5 section — record the concrete
  transaction-aware authoring boundary and implementation evidence.
