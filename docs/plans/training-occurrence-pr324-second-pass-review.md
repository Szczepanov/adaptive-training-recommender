# PR #324 second-pass review — transaction and read-model hardening

**Reviewed:** 2 September 2026  
**Scope:** second independent pass over PR #324 after the initial hardening review, focused on Firestore transaction read sets, merge determinism, source-cardinality enforcement, cross-timezone Activities hydration, and rollout diagnostics.

This note supplements:

- `docs/adr/0034-canonical-performed-training-occurrence-and-multisource-reconciliation.md`;
- `docs/plans/training-occurrence-implementation-checklist.md`;
- `docs/plans/training-occurrence-pr324-hardening-review.md`.

It intentionally separates correctness defects fixed in this pass from rollout gates that remain intentionally blocked.

## Primary specifications re-checked

### Firestore transaction contention semantics

Firestore retries a transaction when a document read by that transaction changes before commit. Therefore a source-link document that is about to be re-pointed must be part of the transaction's read set; updating a source-link document without first reading/validating its current owner does not provide the same compare-and-set protection.

Primary references:

- https://firebase.google.com/docs/firestore/manage-data/transactions
- https://firebase.google.com/docs/firestore/transaction-data-contention

### ADR-0034 invariants used as review gates

The second pass treated the following as persistence invariants rather than orchestration conventions:

- one source identity belongs to at most one live canonical occurrence;
- one canonical occurrence has zero-or-one structured execution and zero-or-more provider activities;
- duplicate occurrences use a deterministic survivor;
- a loser already merged elsewhere must not be reported as if a different requested survivor won;
- public read-model hydration must preserve already-linked telemetry across midnight/travel/timezone disagreement;
- Stage-2 dual-read diagnostics must be recorded regardless of which asynchronous read resolves first.

## Correctness findings fixed in this pass

### 10. Merge and unlink could overwrite a source claim that moved concurrently

`mergeOccurrences` and `unlinkSource` re-pointed source-link documents with `transaction.update(...)`, but the source-link documents were not part of those transactions' read sets. If another transaction moved the same claim between occurrence reads and commit, the later update could overwrite the newer owner.

**Fix:** every source-link claim that will be moved is now read and validated before any writes. The persisted `sourceKey` must equal the requested canonical key and the link must still point to the occurrence being modified. A changed claim therefore causes a transaction retry/conflict instead of a blind overwrite.

The same exact-key check also makes the long-key hashed document-ID fallback fail closed if a corrupt or extremely unlikely colliding document is encountered.

### 11. Re-merging a loser already merged elsewhere could return a false success

The previous idempotence shortcut returned the requested survivor whenever `loser.status === 'merged'`, without checking where the loser had actually been merged.

That is correct only for a retry of the same merge. Under competing repair operations it could report survivor A even though the loser had already become part of survivor B.

**Fix:** an already-merged loser is followed to its active terminal occurrence transactionally. The call is idempotent only when that terminal ID equals the requested survivor. Otherwise `OccurrenceMergeConflictError` is raised and no write occurs.

### 12. Structured-execution cardinality was enforced by candidate filtering, not the repository

Candidate generation prevented an automatic structured source from targeting an occurrence that already had one, but `attachSource` / `mergeOccurrences` are public persistence primitives and could still be called from manual/admin/repair code with two structured executions.

**Fix:** the repository now enforces the invariant itself and rejects any attach/merge that would leave more than one `structured_execution` source on a canonical occurrence.

### 13. Equal `createdAt` values made the documented merge tie-break query-order dependent

The duplicate-repair comment promised an earlier-`createdAt`, then-ID deterministic survivor. The implementation only compared `createdAt`; equal timestamps selected whichever record happened to be the current sweep item.

**Fix:** merge ordering is centralized in `mergeIdentity.ts`: compare `createdAt` first, then `performedOccurrenceId`. Tests assert the same survivor regardless of argument/query order.

### 14. Exact-day Garmin hydration could drop telemetry from a correctly linked occurrence

The canonical occurrence query used the requested local-date window and the provider fetch used that same exact window. A matched occurrence can legitimately keep the structured/Warsaw display day while its Garmin source is stored on the adjacent provider-local day because of midnight, travel, or timezone disagreement.

The canonical row would still appear, but `CompletedWorkoutView.garmin` could be missing despite a valid attached Garmin source.

**Fix:** the canonical occurrence window remains exact, while provider data used only for source-ID hydration is fetched one local day wider on each side. Hydration still joins by `activityId`; the wider range cannot introduce additional canonical rows.

### 15. Dual-read diagnostics depended on asynchronous UI fetch ordering

`DataView` logged the Stage-2 comparison only when the raw Activity read had already completed at the instant the canonical read resolved. If canonical resolved first, its state caused the effect's subsequent run to short-circuit, so the comparison could be skipped permanently.

**Fix:** `getCompletedWorkoutsInRange` now owns the comparison because it has both the canonical result and the provider payload. The widened provider payload is filtered back to the exact requested range before calculating current-vs-canonical row counts. The existing UI-level defensive log is retained temporarily; identical back-to-back diagnostics are coalesced over a 250 ms window so this compatibility path does not double-log normal reads.

## Regression coverage added

Focused tests now cover:

- unlink refusal when a source claim already points elsewhere;
- merge refusal when a loser source claim already points elsewhere;
- an already-merged loser resolving to a different survivor;
- repository-level rejection of two structured execution sources;
- fail-closed source-key verification for encoded source-link lookups;
- deterministic survivor choice when `createdAt` timestamps are equal;
- adjacent-local-day Garmin hydration while canonical query bounds stay exact.

These tests complement the first hardening pass's coverage for sticky unlink decisions, structured field authority, durable ambiguity, provider normalization, and semantic FIT workout fingerprints.

## Deliberate rollout gates that remain

### PR3: open rest is not crash-resumably durable

The closed rest event is durable, but an in-progress rest exists only in memory until close. Reloading intentionally discards it rather than fabricating elapsed time. This is safe, but it is not equivalent to persisting rest start at rest-begin. Keep actual-rest history non-authoritative until the product decides whether crash-resumable open-rest state is required.

### PR4: full history activation diff is incomplete

The current shadow path compares exposure count, evidence-tier distribution, matched/ambiguous counts, and activity-ID coverage. It still does not run the checklist's training-load/dose delta and recommendation-output delta under canonical history. Coach/history cutover remains blocked.

### Source lifecycle: linked provider refresh is only partially projected

The raw Garmin record is refreshed normally and the Activities hydration reads current raw telemetry, but `reconcileSourceFacts` short-circuits when the source key already exists. Therefore lightweight canonical projection fields (`startedAt`, `endedAt`, `localDate`, `modality`) are not yet explicitly refreshed from an already-linked provider source.

This does not justify rematching the source and does not affect current raw Garmin detail hydration, but ADR-0034 requires provider metadata refresh without routine rematch. Add an idempotent **refresh-linked-source projection** primitive before canonical occurrences become an authoritative source for those lightweight fields.

### Source deletion/revocation remains implicit

Rebuild can ignore an unavailable underlying source and preserve remaining valid evidence, but source refs do not yet carry an explicit availability/deleted/revoked lifecycle marker. Keep this as a pre-authoritative lifecycle task rather than implying PR1–PR5 are fully production-activated.

## Recommended rollout state after this pass

1. Keep `VITE_TRAINING_OCCURRENCE_ACTIVITIES_POLICY=off` by default.
2. Keep completed-training/coach history on the existing authoritative path.
3. Gather shadow reconciliation + dual-read diagnostics and review ambiguity/conflict distributions.
4. Implement load/dose + recommendation-output history shadow comparison before any engine cutover.
5. Add linked-source projection refresh and explicit provider lifecycle state before treating the canonical projection as source-of-truth metadata.
6. Decide the crash-resumable open-rest requirement before advertising performed rest as fully durable.
7. Keep FIT workout fingerprint diagnostic until an Adaptive-side comparable correlation identity exists.
