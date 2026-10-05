# Issue #895 WP2 + WP3 — lifecycle idempotence and exact-resume implementation plan

| | |
|---|---|
| **Status** | **Ready after architecture review** — WP0/WP1 landed in #993; append-only choice replay landed in #995 |
| **Source** | [Issue #895](https://github.com/Szczepanov/adaptive-training-recommender/issues/895) |
| **Analysis** | [`2026-10-05-issue-895-wp2-wp3-lifecycle-resume.md`](../analysis/2026-10-05-issue-895-wp2-wp3-lifecycle-resume.md) |
| **Baseline** | `origin/main` `007602f8e5be5901509e9aba1803dd2b21620988` (2026-10-05) |
| **Blocked by** | None for scoped WP2/WP3 implementation. Coordinate completion-evidence storage with #896; do not absorb its UX/missingness policy. |
| **Unlocks** | #895 WP2/WP3; exact/degraded resume substrate for #723; lifecycle invariant reused by #724/#952 |
| **Policy effect** | None. No recommendation authority; `POLICY_VERSION` must not change. |

## 1. Goal

Deliver #895 WP2 and WP3 together so that:

- terminal transitions are deliberate, race-safe and application-idempotent;
- terminal state has exactly one winner while retryable downstream projections converge safely after crash/retry;
- explicit redo remains the only way to create a new execution after completion;
- every newly started execution is bound to an immutable prescription hash, including fixtures;
- new prescription snapshots are self-sufficient for executable replay rather than depending on current fixture bytes;
- reload restores the same execution, exact pinned executable content and locally acknowledged **queued** diary state;
- failed local intents remain visible as failures but never become canonical performed work;
- definition-resolution failure produces a typed degraded resume, never a fallback to current source content;
- reload never reconstructs an in-flight rest.

## 2. Non-goals

This PR must not:

- redesign the completion sheet or abandonment confirmation (#724);
- decide default values or UI semantics for missing sRPE/completion-fraction/unexpected-fatigue (#896);
- fix external-plan placement/recommendation replay unless a direct lifecycle bug is discovered (#952);
- add resume navigation/discoverability UX (#723);
- add a second **diary** outbox/retry queue beside Firebase persistent cache;
- change Garmin reconciliation authority;
- change recommendation, progression, load-cost or allocation policy;
- reopen or mutate historical completed executions in place;
- claim exact recovery of a manually selected but never logged cursor position that has no durable evidence.

## 3. Fixed design decisions

### D1 — lifecycle authority stays in `SessionExecutionService`

The hook may use local single-flight refs for UX protection, but it must not infer persisted lifecycle from React state or Firestore error text.

The service returns a persisted-state result:

```ts
export type TerminalTransitionOutcome =
    | { kind: 'transitioned'; execution: SessionExecution }
    | { kind: 'already_completed'; execution: SessionExecution }
    | { kind: 'already_abandoned'; execution: SessionExecution };
```

Names may vary; the discriminated semantics must not.

### D2 — rules remain the final terminal-state backstop

Do not weaken terminal immutability in `firestore.rules`.

The client preflights persisted state for ordinary retry, attempts one atomic terminal commit, and rereads after a rejected racing commit. A failure is translated to an already-terminal result only when persisted state proves another terminal transition won. If execution remains `in_progress`, the original failure is rethrown.

### D3 — preserve 1RM + completion atomicity

The existing deterministic 1RM derivation + execution-completion batch remains one atomic unit. A race loser never re-runs 1RM derivation.

### D4 — terminal winner and downstream convergence are different concepts

Only one caller may transition the execution. Do **not** equate that with “only one caller may ever run post-terminal repair”.

Occurrence state and structured reconciliation are already idempotent/repeat-safe and may be retried from persisted terminal state.

Immediate response facts are different because a stale caller can hold different local completion payload bytes. Retry may project a response only from canonical durable completion evidence, never from the retrying caller's stale local payload.

### D5 — submitted completion evidence needed for crash recovery is durably pinned

Current completion commits the execution before writing `SessionResponse`. That creates a crash window.

WP2 must add one durable, idempotent source for the submitted completion facts used by the immediate response. Preferred shape:

- a deterministic immutable `completion`/terminal-evidence record written in the **same atomic commit** as the execution terminal transition and 1RM derivations; or
- an equally strong batch-safe representation approved during implementation.

The evidence record contains only actually submitted fields. Missing remains missing. Tissue responses remain owned by the daily check-in.

This is **not** a second diary replay queue. It is a terminal-transition fact/intent that allows an `already_completed` retry to converge downstream projections without guessing.

If implementation instead makes the deterministic immediate `SessionResponse` itself part of the same atomic terminal commit, it must preserve response provenance/created-at semantics and prove safe behavior when a response document unexpectedly already exists. Do not introduce blind overwrite semantics merely to avoid the terminal-evidence record.

### D6 — explicit redo keeps current lock semantics

`allowDuplicateCompleted` remains a start-time opt-in. The completed predecessor stays immutable; the lock pointer moves to one successor. A retry while that successor is already in progress returns the same successor.

### D7 — every new execution carries a prescription hash

The fixture launch path joins the prepared-launch model. Legacy hash-less executions remain readable/degraded, but new runner executions after WP3 must not be created unpinned.

### D8 — new execution prescriptions are self-sufficient for executable replay

ADR-0023 D-MSNAP requires the immutable prescription to own the exact normalized executable content. The current v1 shape (`blocks` + partial `displayMetadata`) is not sufficient to reconstruct every hash-covered field in reviewed fixtures.

WP3 must add a backward-compatible snapshot shape that contains every top-level `SessionDefinition` field required to reconstruct `hashSessionDefinition` content. Prefer an explicit executable/definition snapshot rather than overloading presentation-oriented metadata.

Old prescriptions retain their v1 resolver behavior. New prescriptions must not require current fixture/template/catalog bytes to reconstruct executable content.

### D9 — resume never falls back to live/current content

Exact resolution returns ready; missing/invalid/unavailable historical reconstruction returns degraded. It never silently substitutes today's catalog/template/fixture content.

### D10 — Firebase persistent cache remains the only diary writer replay queue

WP3 reads cache state and receipts. It never resends receipt mutations.

### D11 — failed receipt is not performed work

Queued receipts may participate in a read-only effective-state overlay when the initial latency-compensated query has not surfaced them yet. Failed receipts are diagnostic/recovery evidence only and must never be materialized into canonical `entries` or progress.

### D12 — same-target queued mutations replay causally

`localStorage` enumeration order is not an execution log. Resume applies same-target queued mutations only when their immutable before/after mutation identities form a valid causal chain. Unorderable/conflicting chains degrade rather than guess.

### D13 — live and resumed progression share one pure projection

Required/optional work, effective choice branch, rounds, per-side holds and next required cursor must not have separate live-vs-resume algorithms.

### D14 — in-flight rest is intentionally not resumable

Keep the existing clear-before-restore behavior. Closed rests remain durable history; a running rest is intentionally lost on reload.

## 4. Work breakdown

## WP2.1 — typed terminal transition contract

**Files**

- `app/src/services/sessionExecutionService.ts`
- `app/src/services/sessionExecutionService.test.ts`
- `app/src/emulator/sessionExecutionDiary.emulator.test.ts`
- `app/firestore.rules` only if tests reveal a missing backstop; no relaxation planned

**Implementation**

1. Add a service helper that loads/parses the exact execution by id for lifecycle classification.
2. Classify persisted state:
   - complete + completed → `already_completed`;
   - complete + abandoned → `already_abandoned` conflict;
   - abandon + abandoned → `already_abandoned`;
   - abandon + completed → `already_completed` conflict;
   - in-progress → eligible transition;
   - missing/invalid/unavailable → fail closed.
3. Replace blind terminal orchestration with a service API that:
   - preflights persisted state;
   - lets deterministic derived writes participate in the same batch;
   - writes the terminal evidence from WP2.2 in that same batch when completing;
   - adds the execution terminal transition;
   - commits once;
   - on racing rejection, rereads and returns the observed terminal state only when another terminal writer demonstrably won;
   - rethrows unrelated failures.
4. Keep generic non-terminal patching out of this API.
5. Preserve current timestamp, notes and sRPE semantics; #896 owns broader missingness policy.

**Tests**

- direct second complete → `already_completed`;
- direct second abandon → `already_abandoned`;
- complete after persisted abandon → conflict result, no rewrite;
- abandon after persisted complete → conflict result, no rewrite;
- missing/invalid/unavailable execution fails closed;
- race loser rereads and classifies the winner;
- failure while execution remains in-progress is rethrown;
- terminal transition cannot be used as a general patch API.

## WP2.2 — persist canonical terminal completion evidence

**Files**

- choose a narrow model/service path during implementation, e.g. `app/src/sessions/sessionTerminalEvidence.ts` + service/parser/rules, or an equivalent strongly typed existing record
- `app/src/hooks/useSessionRunner.ts`
- focused unit + emulator tests

**Required content**

Persist only facts submitted by the athlete that are needed to project the immediate response after the terminal write, for example:

```ts
interface CompletionEvidence {
    executionId: string;
    submittedAt: string;
    sessionRpe?: number;
    completedFraction?: number;
    unexpectedFatigue?: boolean;
    note?: string;
}
```

Exact type/name may differ.

**Rules**

- deterministic identity per execution completion;
- create/write atomically with `in_progress -> completed`;
- immutable after completion;
- fields absent from submission stay absent;
- no tissue data duplication;
- source execution id/user binding is verified;
- retries read this evidence; they do not replace it with caller-local payload.

If implementation can safely make `SessionResponse` itself the terminal-atomic record without weakening its existing edit/provenance contract, that is acceptable and removes the extra projection. Prove it with tests before choosing it.

## WP2.3 — hook terminal single-flight and outcome-aware orchestration

**Files**

- `app/src/hooks/useSessionRunner.ts`
- existing runner/hook tests

**Implementation**

1. Add one `terminalTransitionInFlightRef` covering complete and abandon.
2. Keep `closeActiveRest('session_ended')` before the terminal write because rules allow rest writes only while execution is in progress.
3. Keep tissue feedback ordering unless explicitly coordinated with #896; test same-execution idempotence/conflict safety.
4. For completion, reread persisted entries and contribute deterministic 1RM writes to the terminal service API.
5. On `transitioned`, align local execution to the returned persisted completion.
6. On `already_completed`, align local execution and continue to **post-terminal convergence** (WP2.4); do not rerun 1RM and do not reuse caller-local completion facts.
7. On `already_abandoned` during complete, align state and surface lifecycle conflict.
8. Mirror semantics for abandon.
9. Release the local in-flight ref in `finally` on all paths.

**Tests**

- two same-tick completes invoke one terminal commit;
- two same-tick abandons invoke one terminal commit;
- same-tab complete + abandon race is serialized;
- already-completed does not rerun terminal/1RM writes;
- conflict aligns local state rather than overwriting terminal state.

## WP2.4 — convergent post-terminal effects

**Files**

- `app/src/hooks/useSessionRunner.ts` or a small dedicated completion-convergence service if orchestration becomes too large
- `app/src/services/sessionResponseService.ts` only as required to project canonical terminal evidence
- `app/src/services/sessionOccurrenceService.ts` likely tests only
- training-occurrence tests likely reuse current idempotence contract

**Completion convergence**

Given a persisted completed execution and canonical completion evidence:

1. project/write the deterministic immediate response from canonical evidence only;
2. transition linked occurrence to `completed` (same-state retry is already supported);
3. run `reconcileStructuredCompletion` (already source-key idempotent/concurrent-safe).

These operations may run after either `transitioned` or `already_completed`.

The user-visible terminal operation should not fail merely because reconciliation is temporarily unavailable, but missing/failed post-terminal projections must remain observable and retryable. Do not pretend that “already completed” proves every projection succeeded.

**Abandon convergence**

- transition linked occurrence to abandoned idempotently;
- no response is fabricated unless an existing contract explicitly requires one.

**Crash tests**

Inject failure after the terminal commit but before each downstream effect. A subsequent retry/reload must converge to the same final state without duplicate response documents, occurrence transitions or canonical occurrences.

## WP2.5 — emulator proof for cross-client lifecycle races and redo

**Files**

- `app/src/emulator/sessionExecutionDiary.emulator.test.ts`
- optionally `app/src/emulator/sessionExecutionConcurrentStart.emulator.test.ts`

**Scenarios**

1. Two clients complete the same execution:
   - one terminal transition;
   - loser observes completed;
   - one canonical completion-evidence record;
   - convergence can be called by both without state duplication.
2. Complete vs abandon:
   - first terminal commit wins;
   - loser observes that terminal state;
   - terminal document cannot be rewritten.
3. Abandon with existing entries:
   - all entry/audit/tombstone evidence remains readable.
4. Explicit redo:
   - ordinary start after completion reports already-completed;
   - `allowDuplicateCompleted: true` creates one successor;
   - predecessor stays unchanged;
   - lock points at successor;
   - concurrent/retried redo returns that same successor.

## WP3.1 — make the immutable prescription snapshot complete

**Why this precedes fixture pinning**

A fixture prescription containing only blocks + today's `displayMetadata` cannot replay reviewed fixtures exactly. Fixture 01 already uses hash-covered `modalities`, `sessionTargets` and `prohibitedAdditions`; `hashSessionDefinition` also covers `importWarnings` and `movementComposition`.

**Files likely affected**

- `app/src/sessions/models.ts`
- `app/src/sessions/sessionDefinitionHash.ts`
- `app/src/services/executionPrescriptionService.ts`
- Firestore rules for `execution_prescriptions`
- prescription writers in `sessionAuthoringService.ts` / catalog adapter
- resolver tests

**Recommended shape**

Introduce a backward-compatible executable snapshot, conceptually:

```ts
interface SessionExecutableSnapshot {
    schemaVersion: number;
    title: string;
    summary?: string;
    intent: SessionIntent;
    modalities?: string[];
    dominantModality?: string;
    duration?: NumericRange;
    sessionTargets?: Array<{ kind: string; [key: string]: unknown }>;
    prohibitedAdditions?: string[];
    importWarnings?: string[];
    movementComposition?: SessionMovementCompositionRequirement[];
    blocks: SessionBlock[];
}
```

This mirrors exactly the content set `hashSessionDefinition` hashes. Exact naming/versioning may differ.

Two acceptable migration strategies:

- **Preferred:** a new versioned prescription/snapshot representation with explicit parser dispatch;
- additive optional snapshot fields under the current prescription version, only if old hashes remain byte-for-byte valid and parser/rules tests prove compatibility.

Do not silently change the hash domain for already persisted v1 prescriptions.

**Required properties**

- new prescription hash includes the full executable snapshot;
- read path recomputes/verifies prescription hash;
- reconstructed definition recomputes to `definitionHash`;
- source identity remains provenance, not executable fallback;
- old v1 prescriptions remain readable via existing source-assisted path;
- new snapshots can replay without current source bytes.

## WP3.2 — pin fixture launch to the complete snapshot

**Files**

- `app/src/services/sessionAuthoringService.ts` or a narrowly named fixture-preparation module
- `app/src/hooks/useSessionRunner.ts`
- authoring tests

**Implementation**

1. Add `prepareFixtureSessionLaunch` (name may vary):
   - validate the fixture;
   - source = `{ kind: 'unplanned_fixture', fixtureId }`;
   - compute `definitionHash`;
   - create complete executable snapshot;
   - compute content-addressed prescription hash;
   - save write-once;
   - return `PreparedSessionLaunch`.
2. Change `startFixtureSession` to start the prepared binding, not a hash-less raw definition.
3. Keep fixture provenance as `unplanned_fixture`.

**Tests**

- every new fixture execution stores a prescription hash;
- identical preparation is content-addressed/idempotent;
- material fixture change produces a different prescription hash;
- new-format stored fixture replays after live fixture content changes;
- new-format stored fixture replays even if the current fixture is removed from `FIXTURES_BY_ID`.

## WP3.3 — make resolver snapshot-first for new prescriptions

**Files**

- `app/src/sessions/sessionDefinitionResolver.ts`
- resolver tests

**Implementation**

For new complete snapshots:

1. read and verify the prescription by hash;
2. verify stored source identity equals execution source;
3. reconstruct `SessionDefinition` from the immutable snapshot plus stable source identity fields where required;
4. recompute `definitionHash`;
5. validate the reconstructed definition;
6. return it without reading current fixture/catalog/template bytes as executable authority.

For legacy v1/incomplete prescriptions, retain current source-assisted resolution and fail degraded if the historical source cannot be verified. Do not rewrite old prescription documents.

This intentionally changes the first draft's assumption that `sessionDefinitionResolver.ts` would be “tests only”. Fixture exact replay requires real resolver behavior changes.

## WP3.4 — focused resume aggregate/read model

**Files**

- suggested `app/src/sessions/sessionResume.ts` for pure types/projection and/or
- suggested `app/src/services/sessionResumeService.ts` for Firestore/service composition
- `app/src/hooks/useSessionRunner.ts`
- focused tests

Do not make the hook itself the recovery algorithm.

**Recommended result**

```ts
type ResumeDegradedReason =
    | 'missing_prescription_hash'
    | 'prescription_missing'
    | 'prescription_invalid'
    | 'prescription_unavailable'
    | 'legacy_source_unresolvable'
    | 'diary_unavailable'
    | 'receipt_chain_invalid';

type SessionResumeState =
    | { status: 'none' }
    | {
        status: 'ready';
        execution: SessionExecution;
        definition: SessionDefinition;
        entries: SessionEntry[];
        lastDeletedEntry: SessionEntry | null;
        diarySync: 'synced' | 'queued' | 'unavailable';
        failedIntents: readonly DiaryReceipt[];
        progress: SessionProgressProjection;
      }
    | {
        status: 'degraded';
        execution: SessionExecution;
        entries: SessionEntry[];
        lastDeletedEntry: SessionEntry | null;
        diarySync: 'synced' | 'queued' | 'unavailable';
        failedIntents: readonly DiaryReceipt[];
        reason: ResumeDegradedReason;
        detail?: unknown;
      };
```

Exact names may differ. Execution identity and durable/canonical entries survive definition failure.

**Read sequence**

1. `findInProgressExecution(userId)`.
2. If none, return `none`.
3. Read entries/tombstone state from the latency-compensated Firestore view.
4. Read owner-scoped diary receipts.
5. Partition receipts into queued vs failed.
6. Overlay only queued mutations missing from the initial view, applying same-target mutations through a validated causal chain.
7. Keep failed receipts separately as `failedIntents`; force `diarySync = 'unavailable'` without applying their `after` state.
8. Require `execution.prescriptionHash` for normal ready resume.
9. Resolve through the snapshot-first resolver for all source kinds.
10. Build progress only from pinned definition + effective successful/queued entries.
11. Existing `watchDiarySync` remains the live server-ack/failure convergence path after mount.

## WP3.5 — deterministic receipt overlay

**Files**

- `app/src/services/sessionDiaryReceipts.ts` only if a pure ordered/validated projection helper belongs there; do not add writes
- resume service / pure helper tests

**Rules**

For each target entry:

- a log establishes the initial `diaryMutationId`;
- a correction/delete/restore may apply only when its `before` matches the current effective target identity/state;
- its `after.diaryMutationId` becomes the next link;
- duplicate receipt for the same mutation id is ignored after equality verification;
- conflicting branches, malformed before/after links or cycles fail degraded;
- cross-target ordering is irrelevant unless choice-governing provenance creates an explicit dependency, which must be validated separately.

Choice events remain append-only after #995 and are replayed through normal effective-choice resolution; do not retrofit in-place choice correction.

**Tests**

- log → correct;
- log → delete;
- delete → restore;
- log → correct → delete → restore;
- two targets interleaved in storage order;
- failed final correction leaves prior canonical entry unchanged and exposes failed intent;
- malformed/unorderable chain degrades instead of choosing latest timestamp.

If emulator/browser evidence proves the initial Firestore query always exposes all locally accepted queued target writes after reload, the overlay may become a consistency assertion. Receipt-based failure classification and the failed-vs-canonical separation remain mandatory.

## WP3.6 — share progress/cursor derivation between live execution and restore

**Files**

- `app/src/sessions/workSets.ts`
- `app/src/sessions/choiceResolution.ts` only if current exports are insufficient
- suggested `app/src/sessions/sessionProgress.ts`
- `app/src/hooks/useSessionRunner.ts`
- tests

**Projection responsibilities**

Given `(definition, effectiveEntries)`, compute:

- effective choice chain;
- required/optional step state;
- completed prescribed-set counts;
- per-side hold completion/next side;
- block rounds;
- sequential/rotating completion state;
- current/next **required** step when derivable;
- completed/remaining required work;
- session-ended choice state.

The projection must not mutate persisted entries or definition bytes.

Do not invent a precise cursor for a manually selected optional step when the athlete has not logged anything that identifies that selection. Use the issue's “where known” boundary.

**Migration order**

1. characterize current live behavior with tests;
2. extract pure logic with no behavior change;
3. wire live runner to the projection;
4. use the same projection during restore.

## WP3.7 — replace fixture restore special-case and expose degraded state

**Files**

- `app/src/hooks/useSessionRunner.ts`
- `app/src/components/session/SessionRunner.tsx` only for a minimal safe degraded surface
- focused UI tests

**Implementation**

1. Remove restore code that searches caller-provided `fixtures` and bypasses the resolver.
2. Call the resume aggregate.
3. On `ready`:
   - exact execution;
   - immutable reconstructed definition;
   - effective entries/tombstone state;
   - shared progress/cursor;
   - elapsed time from `startedAt` + wall clock;
   - initial sync state from resume aggregate, then watchers converge it.
4. On `degraded`:
   - retain execution and canonical entries;
   - expose typed read-only/degraded condition;
   - show failed intents distinctly if relevant;
   - do not fabricate a definition;
   - do not start a new execution.
5. On `none`, preserve no-active-session behavior.

Full discoverability/navigation remains #723.

## WP3.8 — preserve no-rest-reconstruction contract

**Files**

- `app/src/hooks/useSessionRunner.ts`
- focused hook/browser tests
- `docs/architecture/session-execution.md` after implementation

Before any async resume read:

```text
activeRestRef = null
manualRestDeadlineRef = null
restSecondsRemaining = 0
isRestRunning = false
```

Never infer rest from entry timestamps or prior countdown deadlines. Closed rest events remain durable history only.

## 5. Test matrix

### Unit/service

- terminal state/request classification matrix;
- rejected race → persisted-state classification;
- unrelated/non-race failures rethrow;
- terminal evidence preserves only submitted fields;
- race loser cannot overwrite terminal evidence;
- fixture snapshot completeness/hash stability;
- new snapshot reconstructs after source drift/removal;
- legacy prescription fallback/degraded cases;
- failed receipt separated from effective entries;
- causal receipt-chain projection;
- shared progress: optional/required, rounds, rotating, per-side, append-only choice supersession.

### Firestore emulator

- two-client complete;
- complete vs abandon;
- terminal evidence + completion + 1RM are atomic;
- abandon preserves entries/audits;
- terminal immutability remains enforced;
- explicit redo advances lock once and preserves predecessor;
- new fixture execution carries complete prescription snapshot;
- queued local diary mutation survives service-instance reload where supported by existing WP0 harness.

### Crash/convergence tests

Inject a failure after terminal commit before:

- immediate response projection;
- occurrence transition;
- structured reconciliation.

Retry from persisted `already_completed` and canonical terminal evidence. Assert one final response document, one terminal occurrence state and one canonical performed occurrence. Assert a different retry-local payload cannot replace terminal evidence.

### Browser E2E

Extend the existing #895 offline diary journey:

1. start a prescription-pinned session;
2. log multiple entries and choice state;
3. force offline;
4. log/correct/delete/restore while locally accepted;
5. reload;
6. verify same execution id;
7. verify exact pinned definition/progress and queued status;
8. verify failed intent, when injected, is shown separately and does not change performed progress;
9. verify no running rest is restored;
10. reconnect and verify one persisted copy;
11. exercise same-tab terminal single-flight.

Add a separate exact-fixture-replay fixture that mutates/removes the live fixture after the prescription is created and proves the stored snapshot remains executable.

### Regression

- #995 append-only choice tests remain green;
- WP1 diary/tombstone/receipt tests remain green;
- concurrent-start tests remain green;
- external-plan/catalog/manual start/resume tests remain green;
- completion-sheet tests remain green without changing #896 missingness policy;
- ADR-0034 reconciliation idempotence tests remain green.

## 6. File-level change map

Expected, subject to cohesion:

- `app/src/services/sessionExecutionService.ts` — typed terminal commit/classification;
- `app/src/hooks/useSessionRunner.ts` — terminal single-flight, convergence, resume aggregate, fixture prepared launch;
- terminal completion-evidence model/service/parser/rules — exact name chosen in implementation;
- `app/src/services/sessionAuthoringService.ts` — fixture preparation + complete snapshot writer;
- `app/src/sessions/models.ts` — backward-compatible complete prescription snapshot type;
- `app/src/sessions/sessionDefinitionHash.ts` — versioned/additive hash semantics without invalidating old prescriptions;
- `app/src/services/executionPrescriptionService.ts` — snapshot parser/verification;
- `app/src/sessions/sessionDefinitionResolver.ts` — snapshot-first replay for new prescriptions, legacy source-assisted fallback;
- `app/src/services/sessionResumeService.ts` — resume aggregate/read model if chosen;
- `app/src/sessions/sessionProgress.ts` — shared pure progress projection if current helpers cannot be composed;
- receipt projection helper — read-only causal chain validation; no writer/replay queue;
- emulator + runner + resolver + browser tests;
- `docs/architecture/session-execution.md` after code lands;
- master `docs/plans/2026-09-29-issue-895-structured-execution-diary.md` status update only after implementation delivery.

## 7. Implementation order

1. Characterization tests for current lifecycle, terminal crash window, fixture replay limitation and live progress.
2. WP2 typed terminal service contract.
3. WP2 canonical terminal evidence in the atomic completion commit.
4. Hook terminal single-flight/outcome handling.
5. Post-terminal convergence + crash-injection tests.
6. Cross-client lifecycle/redo emulator proofs.
7. Define backward-compatible complete prescription snapshot.
8. Make all new prescription writers emit complete snapshots.
9. Fixture prepared launch.
10. Snapshot-first resolver for new prescriptions; legacy fallback remains.
11. Resume aggregate with queued/failed receipt separation.
12. Causal queued-receipt projection.
13. Shared progress extraction and live wiring.
14. Restore/degraded UI wiring; remove fixture special-case.
15. Browser offline/reload/exact-fixture coverage.
16. Architecture docs + master #895 plan update.
17. Full CI and independent diff review.

Do not combine WP4 arrival-ordering or WP5 diagnostics into this implementation merely because resume exposes richer state.

## 8. Validation gates

Use repository-standard commands discovered from `package.json`/CI. At minimum the implementation PR must pass:

- frontend typecheck;
- lint/hygiene;
- focused Vitest lifecycle/resolver/resume/progress tests;
- Firestore emulator rules/session tests;
- Playwright #895 offline/reload journey;
- full repository CI gate on final head.

A green focused suite is insufficient if aggregate CI is red.

## 9. Review checklist

### Lifecycle

- [ ] No terminal path remains a blind hook-level merge.
- [ ] Same-tab duplicate complete/abandon is single-flight.
- [ ] Cross-client races are classified from persisted state.
- [ ] Completed and abandoned states cannot overwrite one another.
- [ ] 1RM derivation remains atomic with completion and runs only for the transition winner.
- [ ] Canonical completion evidence needed for response recovery is committed with terminal state.
- [ ] Retry after terminal crash converges occurrence/reconciliation.
- [ ] Immediate response retry uses canonical terminal evidence, never retry-local bytes.
- [ ] Abandon retains all prior diary evidence.
- [ ] Redo requires explicit `allowDuplicateCompleted` and creates one successor.

### Prescription/resume

- [ ] Every new start path carries `prescriptionHash`.
- [ ] New prescription snapshot contains every executable field covered by `hashSessionDefinition`.
- [ ] Old prescription hashes remain valid/readable.
- [ ] Fixture start is prescription-pinned.
- [ ] New fixture replay works after current fixture drift/removal.
- [ ] Resume is snapshot-first for new prescriptions.
- [ ] No fallback to current source content on failure.
- [ ] Degraded resume retains execution id + canonical entries.
- [ ] Queued receipt state survives reload.
- [ ] Failed receipts are exposed separately and never counted as performed work.
- [ ] Same-target queued mutations are projected via a validated causal chain.
- [ ] Shared progress handles #995 choice lineage, rounds, per-side and required/optional work.
- [ ] In-flight rest is never reconstructed.

### Architecture

- [ ] `SessionExecutionService` remains sole execution/diary lifecycle writer.
- [ ] Firebase cache remains sole diary replay queue.
- [ ] Terminal evidence is narrow completion provenance, not a general second outbox.
- [ ] No recommendation-policy imports/writes are added.
- [ ] `POLICY_VERSION` unchanged.
- [ ] `docs/architecture/session-execution.md` reflects final implemented behavior.

## 10. Merge and rollback notes

### Rollout

No historical migration should be required.

- legacy hash-less executions use degraded resume;
- legacy/incomplete prescriptions use existing source-assisted resolver behavior;
- new prescriptions use complete self-verifying snapshots;
- new fixture executions become prescription-pinned;
- terminal evidence is created only for new terminal completions after deployment.

If Firestore rules change, deploy additive-compatible rules before the frontend begins writing the new shape.

### Rollback

Do not delete execution prescriptions, terminal evidence, diary mutations, tombstones or receipts as rollback cleanup. They are historical/integrity evidence. A frontend rollback may lose new convergence/degraded-resume UX but must not rewrite terminal documents or immutable prescription snapshots.

## 11. Definition of done

WP2 + WP3 can be marked implemented in the master #895 plan only when:

1. lifecycle race/idempotence tests pass;
2. explicit redo is proven exactly-once under retry/concurrency;
3. a crash after terminal commit cannot permanently strand retry-safe downstream lifecycle/reconciliation state;
4. immediate-response retry cannot replace canonical completion facts with stale caller-local bytes;
5. all new starts are prescription-pinned;
6. new prescription snapshots are self-sufficient for executable replay and retain hash compatibility for legacy records;
7. fixture replay survives current fixture drift/removal;
8. queued diary state survives reload without another writer queue;
9. failed receipts remain visible but never affect canonical performed progress;
10. degraded prescription resolution retains execution/entries and fails closed;
11. no-rest-reconstruction has regression coverage;
12. #724/#896/#952 remain correctly scoped rather than silently absorbed;
13. full CI is green on final head;
14. architecture docs and #895 work-package status are updated in the implementation PR.
