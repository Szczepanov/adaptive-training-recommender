# Issue #895 WP2 + WP3 — lifecycle and exact resume delivery

| | |
|---|---|
| **Status** | **Implemented** — scoped WP2/WP3 delivery; #895 remains in progress for WP4–WP7 |
| **Source** | [Issue #895](https://github.com/Szczepanov/adaptive-training-recommender/issues/895) |
| **Analysis** | [`2026-10-05-issue-895-wp2-wp3-lifecycle-resume.md`](../analysis/2026-10-05-issue-895-wp2-wp3-lifecycle-resume.md) — dated design evidence |
| **Predecessors** | WP0/WP1 #993; append-only choice replay #995; reviewed implementation plan #997 |
| **Policy effect** | None; no recommendation authority or `POLICY_VERSION` change |

## Delivered lifecycle contract

`SessionExecutionService.transitionExecutionTerminal` waits for queued writes and preflights
persisted state. One completion or abandonment wins. Completion evidence and derived 1RM writes
share its atomic commit. A rejected racing commit is translated only after a reread proves a
terminal winner; unrelated failures remain failures. Rules deny terminal reopening and deletion.

The hook keeps same-client terminal calls single-flight, closes rest before completion, and saves
submitted tissue feedback to the daily check-in before attempting the terminal commit. Completion
facts used for response repair are pinned as immutable `completionEvidence`; missing submitted
fields remain absent. A retry never projects stale caller payloads or undoes a later athlete
response correction.

`convergeCompletedExecution` repairs response, occurrence and reconciliation independently. Mount
and reconnect recovery cover terminal history across dates, including predecessors when a successor
is active. Explicit redo advances the existing slot lock to one successor and retains all historical
records. Competing redo callers return the same in-progress successor. Abandonment keeps the diary.

## Delivered resume contract

New fixture, manual, external-plan and catalog launches pin a self-contained `definitionSnapshot`.
The snapshot freezes executable metadata and blocks; immutable source identity supplies ID/revision.
New writes include the snapshot in the content hash. Historical hashes remain readable through
exact-source compatibility checks; no backfill or historical rewrite occurs. Launch populates the
prescription's readable persistent cache before returning, enabling offline reload.

`getResumeDiaryState` reads all materialized targets, including tombstones. `overlayQueuedDiaryState`
accepts one complete before/after chain per target consistent with a persisted base, intermediate or
tail state. Timestamp ties cannot reorder causality. Failed receipts preserve attempted intent but
are excluded from performed work. Live snapshots reproject when local acceptance, acknowledgement
or rejection changes receipts, including rollback-before-failure-classification ordering.

`projectSessionProgress` reuses work-set and rotating-group accounting. Warm-ups/choices do not count
as prescribed sets; rounds, optional work, paired holds and recorded block/session endings retain
shared semantics. Live manual navigation is honored; unlogged manual cursor state is not fabricated
on reload. Rest deadlines are cleared, and completed rest records remain history.

Missing pinned bytes, invalid diary records or a causal conflict yield degraded recovery with the
execution/evidence retained. The runner pauses logging and new starts and offers Retry recovery.
Current fixtures, templates, plans and catalog content are never substituted for missing pinned bytes.

## Verification and rollout

Focused tests cover terminal races with sibling-write atomicity, explicit redo, abandonment,
immutable terminal records, snapshot/hash compatibility, queue causality, response correction
preservation and progression. Browser tests cover actual offline reload, correction, tombstone/undo,
server rejection and rest clearing. Desktop/mobile visual scenarios cover degraded recovery and
normal grouped/per-side logging. `make verify` is the handoff gate.

Deploy additive lifecycle/snapshot rules before the frontend. No data migration is required. Retain
snapshots, completion evidence, receipts and diary audit on rollback; use a forward fix when older
clients cannot satisfy the integrity rules.

## Scope retained for follow-up

WP4–WP7 ordering convergence, diagnostic/export UI and consumer inventory remain open. This delivery
does not redesign resume navigation (#723), abandonment/completion UX (#724), missingness policy
(#896), external-plan placement (#952), Garmin authority or recommendation policy. Legacy hashless
executions degrade safely. Terminal-history recovery currently scans the account's terminal records;
projection checkpoints can replace that scan if history volume makes it material.

Current behavior is documented in [`session-execution.md`](../architecture/session-execution.md)
and [`user-flows.md`](../architecture/user-flows.md).
