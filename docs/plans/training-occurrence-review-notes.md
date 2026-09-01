# Training occurrence reviewer focus notes

Status: review aid

This note highlights the decisions that should receive explicit reviewer agreement before implementation starts.

## Decisions that should be treated as blocking

1. **Planning occurrence != performed occurrence.**
   `SessionOccurrence` remains an authority/scheduling object. The new canonical completed-workout identity is separate.

2. **Canonical identity is provider-neutral.**
   Do not key the physical workout by Garmin `activityId`, `SessionExecution.executionId`, or `SessionOccurrence.occurrenceId`.

3. **Source authority is field-specific.**
   Adaptive owns known structured execution semantics; Garmin owns measured wearable physiology. Neither source globally overwrites the other.

4. **A source may belong to only one live canonical occurrence.**
   This must be enforceable under repeated sync and concurrent arrivals, not merely assumed by UI code.

5. **Ambiguity favors non-merge.**
   Temporary duplicates are preferable to false-positive identity fusion that corrupts completed-training evidence.

6. **Established links are stable.**
   Provider metadata refreshes do not silently rematch. Matcher upgrades require explicit versioned replay/migration.

7. **Raw/detail data remains reconstructable.**
   The canonical collection is derived state, not a new raw source of truth.

8. **Do not duplicate full HR traces into the canonical document.**
   Keep lightweight summaries/source refs in the projection and load detailed telemetry from the appropriate source representation.

9. **Activities cutover and engine cutover are separate releases.**
   The UI can be correct while evidence semantics are still wrong; history/coach activation requires shadow diffs and regression gates.

10. **Performed rest requires real events.**
    Do not infer actual rest from consecutive set completion timestamps.

## Questions PR 1 should answer in code, not leave implicit

- What is the exact code type and Firestore collection name for the performed occurrence?
- What is the exact source-ref schema?
- How is source-link uniqueness enforced atomically?
- What happens when Garmin-first and Adaptive-first canonical records both already exist before reconciliation?
- What is the survivor/tombstone rule for such merges?
- Which matcher features are persisted for audit/replay?
- What thresholds/policy distinguish auto-match, ambiguous, and unmatched?
- How are manual link/unlink decisions represented and preserved during rebuild?
- Which fields are materialized versus lazy-loaded from source data?
- Which Firestore rules and indexes are required?
- How is shadow reconciliation enabled/disabled?
- Which metrics gate Activities cutover?

## Reviewer red flags

Request changes if an implementation:

- simply merges objects in `ActivityTelemetry.tsx` without canonical identity;
- creates a canonical document keyed by Garmin `activityId`;
- assumes exactly one provider activity forever;
- copies Garmin sets over athlete-entered structured sets;
- matches automatically on same date alone;
- treats a successful empty Garmin set list as equivalent to unavailable detail;
- rematches existing links on every sync;
- deletes the whole occurrence when one source disappears;
- introduces a new Firestore collection without rules/index tests;
- switches training-history evidence in the same PR as the first occurrence persistence;
- calculates performed rest from set completion deltas;
- duplicates the full HR sample series into the occurrence projection.

## Suggested first representative fixtures

Before broad implementation, preserve anonymized fixture-level scenarios for:

- structured strength + Garmin strength, one obvious match;
- same day, two separate strength sessions;
- structured strength with Garmin `exerciseSets=[]`;
- structured strength with Garmin strength-detail unavailable;
- Garmin arrives first;
- Adaptive execution arrives first;
- watch + second device duplicate recording;
- manual unlink followed by provider resync.

These fixtures should be reusable across reconciliation, Activities, backfill, and engine-history tests so the same identity expectations are asserted end to end.
