# Issue #895 WP2 + WP3 — lifecycle idempotence and exact-resume implementation plan

| | |
|---|---|
| **Status** | **Ready** — WP0/WP1 landed in #993; append-only choice replay landed in #995 |
| **Source** | [Issue #895](https://github.com/Szczepanov/adaptive-training-recommender/issues/895) |
| **Analysis** | [`2026-10-05-issue-895-wp2-wp3-lifecycle-resume.md`](../analysis/2026-10-05-issue-895-wp2-wp3-lifecycle-resume.md) |
| **Baseline** | `origin/main` `007602f8e5be5901509e9aba1803dd2b21620988` (2026-10-05) |
| **Blocked by** | None for the scoped WP2/WP3 implementation. Coordinate completion-surface changes with #724/#896; do not absorb them. |
| **Unlocks** | #895 WP2/WP3; exact-resume substrate for #723; lifecycle invariant reused by #724/#952 |
| **Policy effect** | None. No recommendation authority; `POLICY_VERSION` must not change. |

## 1. Goal

Deliver #895 WP2 and WP3 together so that:

- terminal transitions are deliberate, race-safe and application-idempotent;
- retries do not duplicate completion/abandonment fan-out;
- explicit redo remains the only way to create a new execution after completion;
- every newly started execution is bound to an immutable prescription hash, including fixtures;
- reload restores the same execution, exact pinned prescription and locally acknowledged diary state;
- definition-resolution failure produces a typed degraded resume, never a fallback to today's/live source content;
- reload never reconstructs an in-flight rest.

## 2. Non-goals

This PR must not:

- redesign the completion sheet or abandonment confirmation (#724);
- decide sRPE/completion-fraction/unexpected-fatigue missingness (#896);
- fix external-plan placement/recommendation replay unless a direct lifecycle bug is discovered (#952);
- add resume navigation/discoverability UX (#723);
- add a second offline outbox/retry queue beside Firebase persistent cache;
- change Garmin reconciliation authority;
- change training recommendation, progression, load-cost or allocation policy;
- reopen or mutate historical completed executions in place.

## 3. Fixed design decisions

### D1 — terminal lifecycle authority stays in `SessionExecutionService`

The hook may use local single-flight refs for UX protection, but it must not infer persisted lifecycle from React state or Firestore error text.

The service returns a typed terminal result derived from persisted state:

```ts
export type TerminalTransitionOutcome =
    | { kind: 'transitioned'; execution: SessionExecution }
    | { kind: 'already_completed'; execution: SessionExecution }
    | { kind: 'already_abandoned'; execution: SessionExecution };
```

Names may vary during implementation; the discriminated semantics must not.

### D2 — rules remain the race backstop

Do not weaken terminal immutability in `firestore.rules`. The client should preflight persisted state for the common retry path and reread after a rejected racing commit to classify the winner's terminal state.

### D3 — preserve completion atomicity

The existing 1RM derivation + execution-completion batch remains atomic. Lifecycle refactoring must not allow derived strength writes to commit while the execution remains `in_progress`.

The preferred service shape is a terminal commit helper that owns classification/commit/reconciliation and accepts a callback or caller-supplied batch contribution for deterministic completion-derived writes.

### D4 — downstream completion fan-out is winner-only

Immediate response persistence, linked occurrence transition and structured-occurrence reconciliation run only when the lifecycle result is `transitioned`.

`already_completed` updates/aligns local state from the persisted execution and exits successfully without repeating winner-only fan-out.

### D5 — explicit redo keeps current lock semantics

`allowDuplicateCompleted` remains a start-time opt-in. The old completed execution stays immutable; the lock pointer moves to one new in-progress execution. A retry while that redo is already in progress returns the same new execution.

### D6 — every new execution carries a prescription hash

Add the missing fixture authoring path. Do not exempt fixtures from snapshot semantics.

Legacy hash-less executions remain readable/degraded, but new execution creation after this PR must not create an unpinned runner session.

### D7 — resume never falls back to live content

`resolveSessionDefinition(userId, source, prescriptionHash)` is the single definition resolver for resume, including fixtures.

Missing/invalid/unavailable resolution yields a degraded resume state with execution + diary preserved.

### D8 — Firebase cache is still the only replay queue

WP3 reads queued local state and receipts. It never resends receipt mutations and never creates another queue.

### D9 — live and resumed progression share one pure projection

Required/optional work, effective choice branch, rounds, per-side holds and next cursor must not have separate live-vs-resume algorithms.

### D10 — in-flight rest is intentionally not resumable

Keep the existing clear-before-restore behavior. Only closed rest events are durable history.

## 4. Work breakdown

## WP2.1 — introduce a typed terminal transition contract

**Files**

- `app/src/services/sessionExecutionService.ts`
- `app/src/services/sessionExecutionService.test.ts`
- `app/src/emulator/sessionExecutionDiary.emulator.test.ts`
- `app/firestore.rules` only if a test demonstrates a missing backstop; no planned relaxation

**Implementation**

1. Add a helper that loads and validates the exact execution document by id for lifecycle classification.
2. Add terminal-state classification:
   - requested `completed` + persisted completed => `already_completed`;
   - requested `completed` + persisted abandoned => `already_abandoned`;
   - requested `abandoned` + persisted abandoned => `already_abandoned`;
   - requested `abandoned` + persisted completed => `already_completed`;
   - persisted in-progress => eligible to transition;
   - missing/invalid/unavailable => fail closed.
3. Replace blind terminal orchestration with a service API that:
   - preflights persisted state;
   - returns an already-terminal outcome before writing when possible;
   - queues the requested transition into the same completion batch as deterministic derived writes when supplied;
   - commits once;
   - on rule-race rejection, rereads persisted execution and returns the observed terminal result when another caller won;
   - rethrows unrelated failures.
4. Keep generic non-terminal patching out of this API. Terminal semantics deserve a narrow contract.
5. Preserve current completion timestamps/notes/sRPE field behavior; optional evidence semantics are #896.

**Tests**

- direct second complete => `already_completed`;
- direct second abandon => `already_abandoned`;
- complete after persisted abandon => explicit conflict outcome, no rewrite;
- abandon after persisted complete => explicit conflict outcome, no rewrite;
- missing/invalid execution fails closed;
- race loser after rule rejection rereads and classifies terminal state;
- unrelated batch failure is not swallowed as idempotence.

## WP2.2 — make hook terminal actions single-flight and outcome-aware

**Files**

- `app/src/hooks/useSessionRunner.ts`
- focused hook/runner tests in the existing session-runner test location

**Implementation**

1. Add `terminalTransitionInFlightRef` (or equivalent) covering both complete and abandon so same-tab double taps cannot enter terminal orchestration twice before React state updates.
2. Keep `closeActiveRest('session_ended')` ahead of the actual terminal write because Firestore rules allow rest writes only while the execution is in progress.
3. Route completion through the new service terminal API.
4. Contribute deterministic 1RM derivations to the same completion batch.
5. On `transitioned`:
   - set local execution to the returned completed execution;
   - record immediate response;
   - transition occurrence;
   - launch structured reconciliation.
6. On `already_completed`:
   - align local execution with the persisted completed document;
   - do not repeat response/occurrence/reconciliation fan-out.
7. On `already_abandoned` during completion:
   - align local state and surface a lifecycle conflict to the UI/caller rather than pretending completion succeeded.
8. Mirror the same semantics for abandon.
9. Ensure the in-flight ref is released in `finally` for all error paths.

**Tissue feedback constraint**

Keep the current behavior unless the implementation explicitly coordinates with #896. If it remains before terminal commit, test that repeating the same execution-source upsert is non-destructive. Do not fold missingness redesign into this PR.

**Tests**

- two same-tick complete calls invoke one terminal commit;
- two same-tick abandon calls invoke one terminal commit;
- complete + abandon same-tab race is serialized;
- already-completed result does not write response/occurrence/reconciliation again;
- already-abandoned result does not overwrite state;
- winner-only fan-out occurs exactly once.

## WP2.3 — emulator proof for cross-client lifecycle races and redo

**Files**

- `app/src/emulator/sessionExecutionDiary.emulator.test.ts`
- optionally `app/src/emulator/sessionExecutionConcurrentStart.emulator.test.ts` if redo coverage fits that fixture better

**Scenarios**

1. Two clients complete the same execution:
   - one persisted completion;
   - one idempotent already-completed result after reconciliation;
   - no second completed execution document.
2. Complete versus abandon:
   - first terminal commit wins;
   - loser observes the committed terminal state;
   - terminal document is immutable thereafter.
3. Abandon with existing logged entries:
   - terminal state becomes abandoned;
   - all prior entry docs remain readable;
   - tombstone/audit semantics are unchanged.
4. Explicit redo:
   - starting normally after completion reports already-completed;
   - `allowDuplicateCompleted: true` creates one new execution;
   - original completion remains unchanged;
   - lock points at new execution;
   - a concurrent/retried redo start resolves to that same new in-progress execution.

## WP3.1 — pin fixture launches to an immutable prescription

**Files**

- `app/src/services/sessionAuthoringService.ts` or a narrowly named fixture-preparation module
- `app/src/hooks/useSessionRunner.ts`
- `app/src/services/sessionAuthoringService.test.ts` or focused equivalent
- `app/src/sessions/sessionDefinitionResolver.test.ts`

**Implementation**

1. Add a fixture launch preparation helper that:
   - validates the supplied `SessionDefinition`;
   - creates source `{ kind: 'unplanned_fixture', fixtureId }`;
   - computes the exact definition hash;
   - creates an `ExecutionPrescription` with the exact blocks and standard display metadata;
   - computes the content-addressed prescription hash;
   - saves it through `executionPrescriptionService.savePrescription`;
   - returns `PreparedSessionLaunch` with that hash.
2. Change `startFixtureSession` to start the prepared binding, not a hash-less raw fixture.
3. Keep source identity as `unplanned_fixture`; the prescription is the content snapshot, not a source-type migration.

**Tests**

- new fixture execution always stores `prescriptionHash`;
- identical fixture preparation is idempotent/content-addressed;
- changed fixture bytes produce a different prescription hash;
- resolver reconstructs the exact stored prescription.

## WP3.2 — create a focused resume aggregate/read model

**Files**

- suggested new `app/src/sessions/sessionResume.ts` for pure types/projection and/or
- suggested new `app/src/services/sessionResumeService.ts` for Firestore/service composition
- `app/src/hooks/useSessionRunner.ts`
- focused unit tests

Do not make the hook itself the data-recovery algorithm.

**Recommended result**

```ts
type ResumeDegradedReason =
    | 'missing_prescription_hash'
    | 'prescription_missing'
    | 'prescription_invalid'
    | 'prescription_unavailable'
    | 'source_unresolvable';

type SessionResumeState =
    | { status: 'none' }
    | {
        status: 'ready';
        execution: SessionExecution;
        definition: SessionDefinition;
        entries: SessionEntry[];
        lastDeletedEntry: SessionEntry | null;
        diarySync: 'synced' | 'queued' | 'unavailable';
        progress: SessionProgressProjection;
      }
    | {
        status: 'degraded';
        execution: SessionExecution;
        entries: SessionEntry[];
        lastDeletedEntry: SessionEntry | null;
        diarySync: 'queued' | 'unavailable' | 'synced';
        reason: ResumeDegradedReason;
        detail?: unknown;
      };
```

Exact names may differ, but `execution` and `entries` must survive definition failure.

**Read sequence**

1. `findInProgressExecution(userId)`.
2. If none, return `none`.
3. Read Firestore entries/tombstone state for that execution from the latency-compensated view.
4. Read WP1 diary receipts for that execution.
5. Build a read-only locally acknowledged diary overlay if a receipt is newer than/not yet visible in the initial entry snapshot.
6. Determine initial diary sync state from receipts; existing `watchDiarySync` remains the live confirmation path after mount.
7. Require `execution.prescriptionHash` for normal ready resume.
8. Resolve definition through `resolveSessionDefinition` for **all** source kinds.
9. Normalize resolver `DataState` to ready/degraded reason; never fall back to live source content.
10. Build progress projection from pinned definition + effective restored entries.

**Receipt overlay rules**

- `log`/`correct`/`restore`: materialize mutation `after` for the target entry;
- `delete`: preserve the tombstoned `after` as deleted/undo evidence and exclude it from active entries;
- choice mutations are append-only logs after #995 and replay through normal effective-choice resolution;
- failed receipts remain visible as failed intent and force `diarySync = 'unavailable'`;
- receipts are never written/replayed from resume.

If implementation proves Firestore's initial query always includes every locally accepted queued mutation in the tested browser/emulator environments, the overlay can be reduced to a consistency assertion; do not remove receipt-based failure classification.

## WP3.3 — share progress/cursor derivation between live execution and restore

**Files**

- `app/src/sessions/workSets.ts`
- `app/src/sessions/choiceResolution.ts` only if an existing pure export is insufficient
- suggested new `app/src/sessions/sessionProgress.ts`
- `app/src/hooks/useSessionRunner.ts`
- tests

**Projection responsibilities**

Given `(definition, entries)`, compute enough state for both live and resumed runner behavior:

- effective choice chain via `resolveEffectiveChoiceEntries`/`resolveEffectiveSession`;
- required/optional step state;
- completed prescribed-set counts;
- per-side hold completion/next side;
- block rounds;
- sequential/rotating completion state;
- current/next required step when derivable;
- completed/remaining required work;
- session-ended choice state.

The projection must not mutate persisted entries or definition bytes.

**Migration approach**

1. Characterize current live runner behavior with tests first.
2. Extract pure logic with no behavior change.
3. Wire live progression to the projection.
4. Use the same projection during restore.

This ordering prevents WP3 from "fixing" resume by creating behavior drift against active execution.

## WP3.4 — replace fixture restore special-case and expose degraded state

**Files**

- `app/src/hooks/useSessionRunner.ts`
- `app/src/components/session/SessionRunner.tsx` only if a minimal degraded message is required to avoid an unusable blank runner
- focused UI tests

**Implementation**

1. Remove the restore branch that searches the caller-supplied `fixtures` array and bypasses `resolveSessionDefinition`.
2. Call the new resume aggregate service.
3. For `ready`:
   - set exact execution;
   - set pinned definition;
   - set restored active entries/tombstone state;
   - set cursor/progress from shared projection;
   - set elapsed time from `startedAt` + wall clock;
   - initialize sync state from resume aggregate, then let watchers converge it.
4. For `degraded`:
   - retain execution and entries in state;
   - expose a typed degraded/read-only condition;
   - do not fabricate a definition;
   - do not start a new execution.
5. For `none`, preserve current no-active-session behavior.

A minimal degraded UI is acceptable if needed to prevent logging without a definition. Full resume-discoverability design remains #723.

## WP3.5 — preserve no-rest-reconstruction contract

**Files**

- `app/src/hooks/useSessionRunner.ts`
- focused hook/browser tests
- `docs/architecture/session-execution.md` after implementation

**Required invariant before any async resume read**

```text
activeRestRef = null
manualRestDeadlineRef = null
restSecondsRemaining = 0
isRestRunning = false
```

Do not inspect entry timestamps or a prior deadline to infer a rest.

Closed `restEvents` remain durable history and are not converted back to a live countdown.

## 5. Test matrix

### Unit/service

- terminal classification for all state/request pairs;
- race rejection re-read classification;
- non-race failures rethrow;
- fixture prescription preparation/hash stability;
- resolver exact replay after live source drift;
- resume degraded reasons;
- diary receipt overlay semantics;
- shared progress projection: required/optional, rounds, rotating, per-side, append-only choice supersession.

### Firestore emulator

- two-client complete;
- complete vs abandon;
- abandon preserves entries/audits;
- terminal immutability still enforced by rules;
- explicit redo advances lock once and preserves predecessor;
- fixture execution contains prescription hash and can be resolved after reload;
- queued local diary write is still visible after service-instance/browser reload where supported by the existing WP0 harness.

### Browser E2E

Extend the existing #895 offline diary journey rather than introducing another unrelated harness:

1. start a prescription-pinned session;
2. log multiple entries/choice state;
3. force offline;
4. log/correct an entry accepted locally;
5. reload;
6. verify same execution id;
7. verify exact pinned definition/progress and queued status;
8. verify no running rest is restored;
9. reconnect and verify one persisted copy;
10. complete twice / exercise the UI single-flight path where practical.

Add a separate degraded-resume fixture for missing/unresolvable prescription; assert no live-definition fallback.

### Regression

- existing #995 choice tests remain green;
- existing WP1 diary/tombstone/receipt tests remain green;
- existing concurrent-start tests remain green;
- external-plan and catalog start/resume tests remain green;
- completion-sheet tests remain green without changing #896 semantics.

## 6. File-level change map

Expected, subject to keeping code cohesive:

- `app/src/services/sessionExecutionService.ts` — typed terminal commit/classification;
- `app/src/hooks/useSessionRunner.ts` — terminal single-flight, outcome handling, resume aggregate consumption, fixture preparation call;
- `app/src/services/sessionAuthoringService.ts` — fixture prescription preparation;
- `app/src/sessions/sessionDefinitionResolver.ts` — likely tests only; behavior already supports fixture prescription replay;
- `app/src/services/executionPrescriptionService.ts` — likely no behavior change unless resume cache reads need a narrow helper;
- `app/src/sessions/sessionProgress.ts` — new shared pure progress projection if current helpers cannot be composed cleanly;
- `app/src/services/sessionResumeService.ts` — new resume aggregate/read model if keeping Firestore composition out of the hook;
- `app/src/services/sessionExecutionService.test.ts` — lifecycle contract;
- `app/src/emulator/sessionExecutionDiary.emulator.test.ts` — lifecycle race + resume durability;
- existing runner/session tests — single-flight/fan-out/progress;
- `app/tests/e2e/session-diary-offline.pw.ts` — reload/queued-state/no-rest proof;
- `docs/architecture/session-execution.md` — living contract after code lands;
- `docs/plans/2026-09-29-issue-895-structured-execution-diary.md` — mark WP2/WP3 implemented and link implementation PR only after delivery.

## 7. Implementation order

1. **Characterization tests first** for current terminal rules, redo and live progression.
2. **WP2 service contract** — typed persisted terminal outcomes and race reconciliation.
3. **WP2 hook wiring** — one terminal in-flight guard, winner-only fan-out.
4. **WP2 emulator proofs** — two-client race and redo.
5. **WP3 fixture pinning** — no new hash-less starts.
6. **WP3 resume aggregate** — execution + entries + receipts + resolver result.
7. **WP3 shared progress projection** — extract live logic, then restore from it.
8. **WP3 hook/UI degraded state** — remove fixture bypass, preserve execution on resolver failure.
9. **Browser offline/reload coverage** — queued diary + exact snapshot + no rest reconstruction.
10. **Architecture docs + master #895 plan update**.
11. **Full CI and independent diff review**.

Do not combine WP4 arrival-ordering or WP5 diagnostics into this PR merely because resume now exposes better state.

## 8. Validation commands / gates

Use repository-standard commands discovered from `package.json`/CI on the implementation branch; at minimum the implementation PR must pass:

- frontend typecheck;
- lint/hygiene;
- focused Vitest service/session tests;
- Firestore emulator rules/session execution tests;
- Playwright #895 offline/reload journey;
- full repository CI gate before merge.

A green focused suite is insufficient if the aggregate CI gate is red.

## 9. Review checklist

### Lifecycle

- [ ] No terminal transition path remains a blind hook-level merge.
- [ ] Same-tab duplicate complete/abandon is single-flight.
- [ ] Cross-client race is classified from persisted state.
- [ ] Completed and abandoned states cannot overwrite one another.
- [ ] Winner-only completion fan-out runs once.
- [ ] 1RM derivation remains atomic with completion.
- [ ] Abandon retains all prior diary evidence.
- [ ] Redo requires explicit `allowDuplicateCompleted` and creates one successor.

### Resume

- [ ] Every new execution start path carries `prescriptionHash`.
- [ ] Fixture start is prescription-pinned.
- [ ] Resume uses `resolveSessionDefinition` for every source kind.
- [ ] No fallback to current catalog/template/fixture on resolver failure.
- [ ] Degraded resume retains execution id + entries.
- [ ] Queued/failed receipt state survives reload and is represented honestly.
- [ ] Shared progress projection handles #995 choice lineage.
- [ ] Required/optional, rounds and per-side work restore correctly.
- [ ] In-flight rest is never reconstructed.

### Architecture

- [ ] `SessionExecutionService` remains sole execution/diary lifecycle write authority.
- [ ] No second replay queue is introduced.
- [ ] No recommendation-policy imports/writes are added.
- [ ] `POLICY_VERSION` unchanged.
- [ ] `docs/architecture/session-execution.md` reflects final behavior.

## 10. Merge/rollback notes

### Rollout

No data migration should be required. New fixture executions become prescription-pinned; legacy hash-less in-progress executions use the degraded resume path rather than being rewritten in place.

If a rules change is required, deploy additive/stricter rules in the same safe ordering used by WP1 and verify old readable records remain compatible.

### Rollback

Do not delete execution prescriptions, diary mutations, tombstones or receipts as rollback cleanup. They are evidence/history. A frontend rollback may lose the new degraded-resume/lifecycle classification UX but must not rewrite terminal documents or mutate historical prescription records.

## 11. Definition of done

WP2 + WP3 can be marked **Implemented** in the master #895 plan only when:

1. all lifecycle race/idempotence tests pass;
2. explicit redo is proven exactly-once under retry/concurrency;
3. all new starts are prescription-pinned;
4. exact resume survives live source drift;
5. locally acknowledged queued diary state survives reload without another replay queue;
6. degraded prescription resolution retains execution/entries and fails closed;
7. no-rest-reconstruction is covered by regression tests;
8. #724/#896/#952 remain correctly scoped and linked rather than silently absorbed;
9. full CI is green on the final head;
10. architecture documentation and #895 work-package status are updated in the implementation PR.
