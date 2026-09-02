# PR #324 hardening review — ADR-0034 performed-training occurrence

**Reviewed:** 2 September 2026  
**Scope:** PR1–PR5 implementation in PR #324, with emphasis on identity safety, manual reconciliation durability, deterministic merge authority, rebuild behavior, and FIT structured-workout evidence.

This note records the post-implementation review so later rollout work can distinguish **fixed correctness defects** from **deliberate rollout gates / remaining scope**. It supplements ADR-0034 and the implementation checklist; it does not replace either document.

## External specifications checked

The review cross-checked two implementation assumptions against primary documentation:

- Firestore transactions are atomic and retry when a document read by the transaction changes concurrently. This supports the source-link claim document pattern used by `PerformedTrainingOccurrenceRepository`, provided all identity-claim reads happen before the corresponding writes.
- Garmin's FIT Activity profile allows embedded `Workout` and `Workout Step` messages. `Workout.wkt_name` identifies the workout; `Workout Step` carries indexed duration/target/intensity semantics; completed workout steps are typically linked from `Lap.workout_step_index`.

Primary references:

- https://firebase.google.com/docs/firestore/manage-data/transactions
- https://developer.garmin.com/fit/file-types/activity/
- https://developer.garmin.com/fit/file-types/workout/

## Correctness findings fixed in this hardening pass

### 1. Manual unlink was only sticky in one reconciliation orientation

Before hardening, `unlinkSource` wrote the detached source key into the survivor's `excludedSourceKeys`, but the detached occurrence did not exclude the survivor's remaining source keys. A later duplicate-repair sweep is free to encounter either occurrence first, so the detached record could become the incoming side and be re-merged despite an explicit athlete/admin unlink.

**Fix:** the separation is now symmetric. The survivor excludes the detached key and the detached occurrence excludes every source key that remained on the survivor. Candidate filtering therefore rejects the same pair regardless of iteration/query order.

### 2. Later attach/merge could erase sticky reconciliation provenance

`attachSource` and `mergeOccurrences` previously replaced the reconciliation object with the newest automatic result. That could silently discard an earlier `manualDecision` or `excludedSourceKeys` while processing a different legitimate source.

**Fix:** automatic reconciliation may advance state/confidence/features, but persistence now carries forward manual decisions and the union of exclusion keys. Merge also inherits exclusions from the loser so tombstoning does not destroy a prior keep-separate boundary.

### 3. Deterministic survivor selection could violate structured field authority

The duplicate sweep intentionally picks a stable survivor by creation time / ID. If Garmin created the older occurrence and the structured execution was the loser, the old merge path kept the Garmin-derived top-level projection even after the structured source was attached.

That violates ADR-0034's separation between **canonical identity selection** and **field-level authority**.

**Fix:** the survivor ID stays stable, but when a provider-only survivor absorbs a structured loser it adopts the structured projection for canonical timeline/modality fields. Source identity remains deterministic while Adaptive/structured semantics retain authority.

### 4. Manual detach could make the new occurrence undiscoverable to rebuild

The detached occurrence was created with an empty projection. Without `localDate`, it could disappear from date-window queries and provider-source rebuild could not discover its underlying activity.

**Fix:** detachment carries the previous canonical projection as a temporary fallback. Rebuild remains the authority for recomputing source-derived fields. Provider rebuild discovery was also widened to the day before/after the fallback local date so crossing-midnight or timezone disagreement does not make an activity unreachable; `activityId` remains the identity check.

### 5. The v1 Activities DTO treated the first arbitrary provider as Garmin

The domain correctly supports multiple providers, but `CompletedWorkoutView.garmin` is deliberately Garmin-specific in v1. Selecting the first `provider_activity` source meant a future non-Garmin provider appearing first could suppress a later Garmin source or be misrepresented as Garmin telemetry.

**Fix:** the v1 hydration path now selects `provider === "garmin"` explicitly. Provider-neutral provenance remains in the source badge.

### 6. FIT fingerprint used step indexes, not the workout definition

The original PR5 implementation hashed only `workout_name + observed step indexes`. Two materially different workouts with the same name and step count could therefore receive the same fingerprint, while an early-stopped workout could be conflated with a different observed-step shape.

Garmin's FIT profile provides stronger evidence directly in `Workout` / `Workout Step` messages.

**Fix:**

- decode FIT-standard `Workout.wkt_name`;
- decode `Workout Step` message index, step name, duration type/value, target type/value, custom target bounds, intensity, and equipment;
- decode `Lap.workout_step_index` as execution linkage;
- normalize/canonicalize semantic step fields before hashing;
- bump the algorithm to `fit-workout-v2`;
- make the semantic workout definition authoritative for the fingerprint when present;
- retain the previous sorted observed-index behavior as a weaker fallback when definitions are absent;
- keep the existing sync service call shape compatible by carrying semantic definition metadata on the tuple-compatible observed-index value.

The fingerprint remains **diagnostic/additive** and is still not a reconciliation-scoring input because Adaptive does not yet produce a comparable Garmin-device workout identity.

## Added regression coverage

New focused tests cover:

- manual unlink rejection in both candidate orientations;
- preservation of sticky exclusions/manual decision after a later attach;
- structured projection authority when the deterministic merge survivor was provider-only;
- semantic FIT fingerprints distinguishing same-name/same-index workouts with different step prescriptions;
- semantic fingerprint stability when only the executed subset of a workout differs;
- backward-compatible two-argument fingerprint calls consuming decoded semantic metadata;
- FIT-standard `Workout`, `Workout Step`, and `Lap.workout_step_index` decode;
- refusal to blend multiple invalid Workout definitions into one semantic fingerprint.

## Remaining rollout gates / known limitations

These are intentionally recorded rather than hidden behind a broad "PR1–PR5 complete" statement.

### PR3 — interrupted open rest is fail-safe but not resumably durable

A rest event becomes durable when it closes. The runner deliberately clears an in-memory open rest on reload, which prevents fabricated duration, but the rest **start itself is not persisted before close**. Therefore a reload during a rest loses that open interval instead of resuming it.

This satisfies the safety requirement "do not fabricate duration" but does **not** yet provide crash-resumable open-rest persistence. If the checklist item "persist rest start/end explicitly" is interpreted as durable start-at-rest-begin, a follow-up schema/state transition is still required before calling that item complete.

### PR4 — history shadow is not yet the full activation gate

The current shadow diff compares:

- exposure count;
- evidence-tier distribution;
- matched/ambiguous canonical counts;
- activity-ID coverage gaps.

It does **not yet** calculate the checklist's full:

- training load/dose delta; or
- recommendation-output delta under canonical history.

Accordingly PR4 remains **shadow/diagnostic only** and completed-training/coach activation must remain blocked until those comparisons are implemented and reviewed on real shadow data.

### Source deletion/correction lifecycle remains conservative

Rebuild ignores a source whose underlying record is unavailable and reconstructs from remaining valid evidence, but the canonical source reference is not yet annotated with an explicit availability/revocation state. That is non-destructive and safe for the current shadow phase, but a later lifecycle slice should make provider deletion/revocation/correction auditable rather than only inferred during rebuild.

## Rollout recommendation

1. Keep Activities policy default `off`.
2. Keep canonical completed-training/coach history non-authoritative.
3. Collect shadow reconciliation metrics after this hardening pass.
4. Inspect ambiguity, source-link conflict, and manual-unlink replay behavior before read-model activation.
5. Implement PR4 load/dose + recommendation-output shadow comparison before coach/history cutover.
6. Decide whether PR3 requires crash-resumable open-rest persistence before exposing actual-rest history as authoritative.
7. Only wire FIT fingerprint into matching after an Adaptive-side comparable identity/correlation key exists.
