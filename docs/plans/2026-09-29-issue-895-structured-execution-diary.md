# Issue #895 — Structured execution as the canonical lossless training record

| | |
|---|---|
| **Status** | **In progress** — WP0–WP3 implemented; WP4–WP7 remain |
| **Source** | [Issue #895](https://github.com/Szczepanov/adaptive-training-recommender/issues/895) |
| **Baseline** | `origin/main` at `e63517a7` (fetch 2026-09-29; includes #901, #910, #911, #912, #913, #914). The local checkout at plan-writing time was behind by 4 commits; all findings below were verified against the fetched tip (`git show FETCH_HEAD:<path>`), not the stale worktree. |
| **Blocked by** | No code blocker for WP1–WP3 design. WP4–WP5 reuse the emulator harness from WP0. Per-item dependencies are listed below. |
| **Unlocks** | Closure of #895; a lossless diary substrate that later history/fatigue cutovers (owned by TO, not this plan) can consume without re-litigating write authority. |
| **Policy effect** | None. All work is persistence/reconciliation/observability plumbing. `POLICY_VERSION` must not change unless scope is explicitly widened in a separately reviewed policy change. |

## 1. Goal

Make the structured SessionRunner the lossless, resumable, auditable source of truth for performed session semantics, with Garmin/provider activities attached as secondary measurement evidence for the same physical occurrence.

The 2026-09-29 audit identified durable entry, correction and rest-write gaps. WP1 now batches diary targets, immutable audit records and execution touches into the SDK persistent-cache queue. Tombstones and durable receipts retain deletion and rejected intent across reload. Lifecycle and exact prescription resume are delivered by WP2/WP3. Ordering convergence, diagnostic UI and consumer inventory remain with WP4–WP7.

## 2. Non-goals

This plan does not (all inherited from #895):

- make Garmin the canonical strength diary;
- estimate physiological training cost from HR alone;
- activate unvalidated strength-load costing in recommendation policy (D-STRCOST stands);
- solve every SessionRunner visual/interaction issue (#723, #724, #727 own those);
- cut broad history/fatigue/microcycle reads over to canonical facts (owned by the TO plan; WP6 only closes the per-consumer double-count inventory);
- persist raw 1 Hz FIT traces or add a new telemetry schema;
- reintroduce the legacy Strength runner or its `useElapsedSeconds` as a second authority (removed by #906; #911 deliberately fixed the canonical path instead).

## 3. Baseline reconciliation — what already landed

The issue body (written 2026-09-29T06:45Z, never edited) predates same-day merges. The following slices are **done and must not be re-planned**:

- **Concurrent-start / double-complete arbitration (#663).** `sessionExecutionService` `claimExecutionSlot` + `executionSlotKey` + `session_execution_locks` transaction; loser receives the winner or `ExecutionSlotConflictError` (`ALREADY_COMPLETED_MESSAGE`). Rules forbid create outside `in_progress` and any transition out of a terminal state. Proofs: `sessionExecutionConcurrentStart.emulator.test.ts`, `firestoreRules.emulator.test.ts`.
- **Prescription snapshot pinning.** `hashSessionDefinition` / `hashExecutionPrescription` (`sessions/sessionDefinitionHash.ts`), content-addressed write-once `executionPrescriptionService` `savePrescription`, `PreparedSessionLaunch` binding (`sessions/sessionLaunch.ts`) carrying `prescriptionHash` onto the execution doc. Later catalog/plan edits cannot rewrite a started session; fixture launches now carry a self-contained pinned prescription too.
- **Wall-clock timers (#908/#911).** `restDeadlineMs` / `restSecondsRemainingAt` / `sessionElapsedSecondsAt` (`sessions/restEventTiming.ts`); interval callbacks are repaint triggers only. Reload **never** reconstructs an in-flight rest — recorded in `docs/architecture/session-execution.md`. #895 must keep that contract, not revisit it.
- **Reconciliation authority (ADR-0034, PR #324/#331).** `projectionBuilder` `buildProjection` picks structured first and never erases with `undefined`; `deriveFactsFromOccurrence` (`engine/performedTrainingFacts.ts`) takes modality/timing from structured and identity fields only from hydrated structured; `completedWorkoutView.ts` marks `garminExerciseSetsAreDiagnosticOnly` when structured exists. Never auto-links on date alone (`AUTO_LINK_CONFIDENCE` 0.75, runner-up ≥ 0.4 forces `ambiguous`).
- **Sticky manual decisions.** `withStickyReconciliation`, `unlinkSource` bilateral `excludedSourceKeys`, `ManualExclusionConflictError` on re-merge attempts, `manualLinkCandidatesFor` suppressing separated pairs both directions.
- **Planning/diagnostic dedup (#901, contract v2).** `renderCanonicalTrainingTable` renders one canonical occurrence once with explicit raw-provenance fallback and pending-reconciliation warnings. Morning D-1 and broad history intentionally remain on legacy paths (TO-owned follow-up).
- **Guardrails:** #906 removed the orphaned legacy Strength code; #910 added training-response authority tests; #885 advanced runner progression through prescribed work (required-only auto-selection, per-side holds via `SessionEntry.side`).

## 4. Decisions fixed by this plan

### D1 — The execution service is the sole write authority; the hook is glue

`useSessionRunner` keeps optimistic UI and single-flight guards, but durability, idempotency and arbitration live in `sessionExecutionService` + Firestore rules. No second outbox, no component-level retry queues.

### D2 — Entry identity is client-generated and retry-stable

The outbox (WP1) assigns the entry id once at log intent and reuses it across retries, so a retried write converges instead of duplicating. Rest events already follow this pattern (deterministic `rest-{startedAt}-{afterEntryId}`); entries are brought under the same discipline.

### D3 — Corrections are auditable updates, not silent rewrites

`correctEntry` gains a revision/tombstone discipline (append revision or preserve prior values) instead of the current shallow merge + `updatedAt` bump; `deleteEntry`/`undo` survive reload via the outbox instead of `lastRemovedEntry` memory.

### D4 — Reload restores entries and prescription, never fabricates rest

The #911 contract stands: restore rehydrates execution identity, prescription snapshot, entries and current-step derivation, and clears (never reconstructs) in-flight rest. "Running rest state only when truthfully reconstructable" in #895 means: from a durably closed `restEvents` record, not from set timestamps.

### D5 — Occurrence reconciliation stays link-only and false-negative-biased

No destructive merges of `SessionExecution` / `NormalizedGarminActivity`; ambiguous stays ambiguous (`mergeDuplicatesInWindow` keeps skipping it); manual `link`/`unlink`/`keep_separate` survive rebuilds and background sweeps.

### D6 — No big-bang history cutover in this plan

WP6 inventories per-consumer authority (canonical vs legacy) and closes double-count acceptance **per consumer already migrated** (coverage, planning/diagnostic brief). History/fatigue/microcycle migration stays with TO and #872-gated activation.

## 5. Work packages

## WP0 — Harness: offline / reload / concurrency fixtures

**Status:** Implemented — diary/ordering fixtures, offline replay and actual browser reload proofs; full reconciliation convergence belongs to WP4
**Blocked by:** None
**Purpose:** prove the current gaps and every later WP against the Auth/Firestore emulator before changing write paths.

### Changes

- Emulator fixtures exercise entry retry, correction/deletion history, closed rest, terminal-write rejection and service-instance restore. Existing concurrent-start tests cover slot arbitration; browser tests additionally prove actual offline reload and undo.
- Thin occurrence fixtures pin distinct source keys, single-source identity and same-document updates. They do not invoke reconciliation or prove arrival-order convergence; those proofs remain in WP4.
- WP0 pinned the original behavior before WP1 replaced the diary-gap assertions with lossless-write regressions. Lifecycle and prescription-resume hardening are delivered in WP2/WP3.

### Files

- `app/src/emulator/sessionExecutionDiary.emulator.test.ts` (new)
- `app/src/emulator/reconciliationOrdering.emulator.test.ts` (new)
- `app/tests/e2e/session-diary-offline.pw.ts` (new)

### Acceptance

- The WP1 acceptance criteria have emulator regressions and actual browser-reload proofs. Thin lifecycle/ordering fixtures establish the remaining work-package boundaries.
- The emulator suite runs inside the existing rules-emulator workflow, with no live API.

---

## WP1 — Durable entry outbox with idempotent retry

**Status:** Implemented — atomic SDK queue, immutable mutation audit, tombstones, durable undo and receipt-based failure detection
**Dependency:** WP0 — satisfied by the reused harness commit
**Purpose:** close the core gap — entries, corrections and rest closes survive offline and retry without duplicates.

### Changes

1. The runner retains the once-minted `entry-<ts>-<uuid>` intent id. Entry/rest mutations atomically queue their target, immutable `diaryMutations` record and execution timestamp through Firebase persistent cache. Successful starts seed the complete execution document cache before offline timestamp merges.
2. Retry retains the entry/rest identity; replay of an initial log never overwrites a later correction. Same-entry mutation serialization prevents rapid delete/undo from reading stale local state.
3. Corrections preserve complete before/after values. Rules reject stale competing corrections. Deletion retains a `deletedAt` tombstone; restore uses an audited mutation, and the latest deleted entry remains discoverable after reload. Normal service and TO4 evidence reads exclude tombstones.
4. Local snapshot acceptance releases the runner form without waiting for the server. Metadata distinguishes queued from synced; failures stay unavailable. Owner-scoped receipts retain attempted values until exact server audit confirmation, including server rejection after reload when original callbacks no longer exist. Receipts never replay writes; the SDK remains the sole queue.
5. Unit/emulator tests cover same-id replay, auditable correction, tombstone/restore, overlapping delete/undo, offline sets and closed rest, ownership, immutable audit and stale-conflict rejection. Browser tests prove three offline sets plus correction/delete/undo survive a real reload and persist once, and a two-client stale correction remains visibly failed with retained values after reload/reconnect.

### Acceptance

- Log N sets offline, reload, reconnect → each set persists exactly once;
- retrying the same write never duplicates;
- correction history is auditable (prior identity recoverable), not a silent overwrite.

---

## WP2 — Lifecycle hardening and regression lock-in

**Status:** Implemented

`transitionExecutionTerminal` admits one persisted winner, batches canonical completion evidence
with 1RM updates, and returns proven terminal state to race losers. Completion projections repair
from that evidence without overwriting subsequent response corrections. Terminal executions cannot
reopen or be deleted; explicit redo retains the predecessor and claims one successor. Abandonment
retains performed entries. Emulator tests cover simultaneous clients and sibling-write atomicity.

## WP3 — Resume contract

**Status:** Implemented

New launches, including fixtures, pin self-contained executable snapshots and populate their
persistent cache before returning. Resume restores the same execution and causally consistent
queued diary, excluding failed intents. Shared progression accounts for rounds, per-side holds,
warm-ups, optional work and recorded choices. Missing or conflicting evidence enters a degraded
state that pauses logging and new starts. An in-flight rest is cleared on reload.

The scoped delivery record is
[`2026-10-05-issue-895-wp2-wp3-lifecycle-resume.md`](./2026-10-05-issue-895-wp2-wp3-lifecycle-resume.md).
WP4–WP7 and related #723/#724/#896/#952 remain separate.

---

## WP4 — Arrival-ordering convergence

**Status:** Not started
**Blocked by:** WP0 fixtures; implementation likely test-plus-sweep-ordering only
**Purpose:** reconciliation converges to one stable occurrence regardless of arrival order.

### Changes

- Prove (emulator): structured-first, Garmin-first, late provider detail, device-sync update, offline execution arriving later. `reconcileStructuredCompletion` / `reconcileGarminActivity` / `reconcileDateRangeForUser` converge without changing the stable user-visible identity; two genuine same-day workouts stay separate (date/modality alone never merges).
- Manual `link`/`unlink`/`keep_separate` survive every ordering including background sweeps (`triggerGarminShadowReconciliationSweep`).
- No matcher threshold changes without evidence review (`AUTO_LINK_CONFIDENCE` / `AMBIGUOUS_CONFIDENCE` stay unless a dedicated calibration plan moves them).

### Acceptance

- All five orderings converge to one occurrence with stable identity;
- ambiguous candidates remain explicitly ambiguous, never force-merged.

---

## WP5 — Failure observability

**Status:** Not started
**Blocked by:** WP1 (needs queued/acknowledged/failed states), WP4 (needs outcome vocabulary)
**Purpose:** the diagnostic surface can name which of the 8 #895 failure states holds, instead of "no data".

### Changes

- A diagnostic projection (read-model + UI/export, detail design in implementation) distinguishing: execution absent / entry pending-or-failed / Garmin absent / detail unavailable / detail valid-but-empty / no candidate / ambiguous candidates / projection failed — plus outbox depth from WP1 and `ReconciliationOutcome` (`created_single_source` / `attached_auto_link` / `ambiguous` / `already_linked` / `error`).
- Read-model failure stays fail-closed and explicit (`activitiesReadable`, `canonicalWorkoutWindow.error`, shadow-diff `null` on `UNAVAILABLE` — already the pattern; extend to the new surface).
- No false certainty: unknown stays unknown; never rendered as empty or zero (same missingness discipline as #901).

### Acceptance

- Every incomplete canonical view can explain its source/reconciliation state;
- export supports debugging without exposing fabricated certainty.

---

## WP6 — Per-consumer double-count closure

**Status:** Not started
**Blocked by:** WP4 (identity must converge first)
**Purpose:** satisfy the #895 double-count criterion for each consumer already under canonical authority, without a big-bang migration.

### Changes

- Inventory with tests: coverage (`resolveCoverageHistory`), planning/diagnostic brief (`renderCanonicalTrainingTable`), ledger (`dedupeByOccurrence`) — each proves one occurrence renders/counts once with structured + provider attached.
- Explicitly out of scope (TO-owned): broad history, fatigue/objective/microcycle, morning D-1 — recorded as residual dual-authority monitored by `historyShadowDiff`, not silently claimed.

### Acceptance

- No migrated consumer double-counts structured + provider records for one occurrence;
- unmigrated consumers are labeled, not asserted canonical.

---

## WP7 — Documentation, governance and issue closure

**Status:** Not started
**Blocked by:** WP1–WP6
**Purpose:** make the diary contract hard to regress and close #895 honestly.

### Update

- `docs/architecture/session-execution.md` (outbox, resume, rest-cleared contract);
- `docs/architecture/` occurrence/reconciliation reference (arrival-ordering + stickiness guarantees);
- `docs/plans/README.md` status board and `docs/README.md` hub index;
- #895 acceptance checklist, one box per proven criterion with PR links.

### Architecture tests

- Structure guards that fail if: a second execution write authority appears beside `sessionExecutionService`; response/recommendation modules import diary-write internals; provider exercise recognition overrides structured identity where structured exists; raw traces enter planning payloads.

### Close #895 only when

Every acceptance box is checked against `origin/main` behavior with emulator + unit evidence, and residual TO-owned work is linked — not absorbed.

## 6. Recommended PR sequence

1. **PR1** — WP0 harness (failing/thin fixtures, no behavior change).
2. **PR2** — WP1 outbox + idempotent retry.
3. **PR3** — WP2 lifecycle + WP3 resume (both ride the outbox).
4. **PR4** — WP4 ordering convergence + WP5 observability.
5. **PR5** — WP6 per-consumer closure + WP7 docs/guards/closure.

Keep review units narrow; do not squash the outbox with the diagnostics.

## 7. File-level change map

Expected; exact names may evolve.

- `app/src/services/sessionExecutionService.ts` (outbox, revision discipline)
- `app/src/hooks/useSessionRunner.ts` (id-once intents, outbox drain, `syncStatus` states)
- `app/src/sessions/sessionDefinitionResolver.ts`, `app/src/sessions/sessionLaunch.ts` (fixture snapshot gap)
- `app/firestore.rules` (outbox/tombstone/revision gates — needs `test:rules`)
- `app/src/training-occurrence/reconciliationService.ts`, `repository.ts`, `reconciliationCandidates.ts` (ordering/stickiness proofs; threshold changes out of scope)
- `app/src/emulator/*.emulator.test.ts` (WP0/WP2/WP4 proofs)
- new diagnostic read-model + surface (WP5; name decided in implementation)
- `docs/architecture/session-execution.md`, `docs/plans/README.md`, `docs/README.md`, this plan

## 8. Verification matrix

- `make verify` before declaring done (scope-aware handoff gate);
- `npm run test:rules` for any rules change (emulator + Java);
- browser E2E for reload/offline resume paths where practical (`session-lifecycle.pw.ts` family);
- `make simulate` expected to show **zero recommendation-plan change** — diary plumbing must not move decisions; any simulation delta stops the line for unintended policy coupling;
- `node scripts/check-policy-drift.mjs` — `POLICY_VERSION` unchanged;
- knowledge validators untouched (no decision-authority constants change; ADR-0033 §2 check on demand).

## 9. Rollback strategy

- WP1's queue uses existing SDK persistence, with additive mutation audit and entry metadata. No historical backfill is required. Deploy compatible rules before the new frontend.
- Keep audit/tombstone records on rollback. Old clients may be unable to edit audited entries under the integrity rules; prefer a forward fix instead of removing the audit protection. Readers tolerate absent metadata on legacy entries.
- WP4/WP5 are additive diagnostics; rollback removes the surface, not the data.
- No raw-telemetry persistence changes, so rollback deletes no large data.

## 10. Review checklist

- Does a logged set survive offline + reload + reconnect exactly once?
- Can a retry, double-tap, or double-complete duplicate anything?
- Does abandonment keep evidence? Can completion be accidentally reopened?
- Does reload restore execution + entries + starting prescription and nothing fabricated?
- Does structured identity win over Garmin recognition everywhere structured exists?
- Does every arrival ordering converge to one stable occurrence?
- Do manual link/unlink decisions survive sync, sweep and rebuild?
- Can diagnostics name the failure instead of saying "no data"?
- Does any migrated consumer double-count? Are unmigrated ones labeled?
- Is `POLICY_VERSION` unchanged? Is there exactly one execution write authority?
