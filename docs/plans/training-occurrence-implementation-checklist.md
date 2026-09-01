# Training occurrence implementation checklist

Status: implementation checklist

Companion documents:

- `docs/analysis/structured-strength-garmin-activity-reconciliation-analysis.md`
- `docs/plans/training-occurrence-reconciliation-and-strength-session-unification.md`
- `docs/adr/0034-canonical-performed-training-occurrence-and-multisource-reconciliation.md`

This checklist turns the architecture into reviewable delivery gates. It is intentionally stricter than a feature checklist because reconciliation changes workout identity, provenance, and eventually training-history evidence.

## PR 1 — canonical performed occurrence and reconciliation

### Domain model

- [ ] Choose a code-level name that cannot be confused with existing `SessionOccurrence`.
- [ ] Add a stable canonical performed-occurrence ID independent of all source IDs.
- [ ] Represent source refs generically enough for zero-or-more provider activities.
- [ ] Keep source provenance explicit.
- [ ] Add schema version.
- [ ] Add reconciliation/matcher version.
- [ ] Add manual-decision state.
- [ ] Add merge/tombstone state for duplicate canonical records discovered later.

### Persistence

- [ ] Store under `users/{uid}/...` in line with ADR-0002.
- [ ] Add Firestore security rules.
- [ ] Add emulator/rules tests proving cross-user denial.
- [ ] Add indexes for date/range Activities queries.
- [ ] Add source-to-occurrence lookup/index strategy.
- [ ] Enforce one source -> at most one live canonical occurrence.
- [ ] Make source attach/detach idempotent.
- [ ] Make concurrent source arrival safe.
- [ ] Add deterministic rebuild/repair path.

### Reconciliation

- [ ] Split candidate generation, scoring, and policy/threshold decisions.
- [ ] Use absolute timestamps for overlap/proximity.
- [ ] Treat local date as supporting evidence only.
- [ ] Treat modality compatibility as required when known.
- [ ] Retain duration similarity as evidence, not identity.
- [ ] Add explicit correlation/prescription-hash support where available.
- [ ] Make competing candidates lower confidence.
- [ ] Never auto-link on date-only evidence.
- [ ] Persist matcher inputs/features, score, threshold policy, and matcher version for auto-links.
- [ ] Manual link is sticky.
- [ ] Manual unlink is sticky.
- [ ] Routine provider refresh does not silently rematch established links.

### Source lifecycle

- [ ] Garmin delayed -> Adaptive-only occurrence remains valid.
- [ ] Adaptive delayed -> Garmin-only occurrence remains valid.
- [ ] Garmin detail failure -> structured semantics remain valid.
- [ ] Garmin empty strength sets -> never erase Adaptive sets.
- [ ] Provider metadata update -> refresh provider fields without routine rematch.
- [ ] Provider delete/revoke -> detach/mark unavailable without destroying remaining occurrence.
- [ ] Structured execution invalidation -> rebuild from remaining valid evidence.

### Observability

- [ ] Count structured-only, provider-only, matched, ambiguous occurrences.
- [ ] Count source-link conflicts.
- [ ] Count competing candidates.
- [ ] Export matcher score distribution/version.
- [ ] Alert/diagnose overlapping structured strength + Garmin strength with no match.
- [ ] Track manual override preservation.
- [ ] Track projection rebuilds and merge tombstones.

### Rollout

- [ ] Production writes start in shadow mode only.
- [ ] No Activities cutover in PR 1.
- [ ] No coach/history behavior change in PR 1.
- [ ] Document rollback path.

## PR 2 — unified Activities/read model

### Read model

- [ ] Activities lists canonical performed occurrences rather than provider rows.
- [ ] Adaptive-only workout is visible.
- [ ] Garmin-only workout preserves existing useful detail.
- [ ] Matched workout renders once.
- [ ] Structured semantics win for exercise/set/reps/load/warm-up fields.
- [ ] Garmin HR/device physiology enriches the same detail view.
- [ ] Provider-native exercise recognition is diagnostic/fallback, not competing canonical content.
- [ ] High-volume HR samples are lazy-loaded/referenced instead of duplicated into the canonical occurrence document.

### UX

- [ ] Source badge clearly communicates Adaptive + Garmin when matched.
- [ ] Plan vs performed is visually distinct.
- [ ] Missing telemetry is shown as unavailable, not zero.
- [ ] Ambiguous/unmatched sources do not disappear.
- [ ] Debug/admin source provenance can be inspected.
- [ ] Manual link/unlink affordance exists at least for diagnostic/admin use.

### Dual-read verification

- [ ] Compare current Activities row count vs canonical row count.
- [ ] Compare duplicate count.
- [ ] Compare Garmin-only coverage.
- [ ] Compare structured-only coverage.
- [ ] Compare matched source coverage.
- [ ] Feature flag or reversible configuration controls cutover.

## PR 3 — performed rest and execution timeline

### Persistence

- [ ] Add reliable set `startedAt` where available.
- [ ] Persist rest start/end explicitly.
- [ ] Persist prescribed vs actual rest separately.
- [ ] Persist rest end reason.
- [ ] Preserve timer adjustments/extensions.
- [ ] Handle next-set-started and session-ended rest closure.
- [ ] Avoid inferring actual rest solely from consecutive completion timestamps.

### Tests

- [ ] Timer elapsed normally.
- [ ] Rest skipped.
- [ ] Rest extended.
- [ ] Next set starts before timer completes.
- [ ] Session ends during rest.
- [ ] App interruption/resume does not fabricate duration.
- [ ] Duplicate client event does not duplicate rest event.

### Optional descriptive enrichment

- [ ] Align HR samples to set/rest intervals only after timestamps are trustworthy.
- [ ] Keep set-level HR recovery descriptive until separate evidence policy exists.

## PR 4 — completed-training history and coach integration

### Shadow calculation first

- [ ] Build canonical-history result in parallel with current result.
- [ ] Diff completed exposure count.
- [ ] Diff evidence tier.
- [ ] Diff training load/dose.
- [ ] Diff recommendation output.
- [ ] Investigate every material regression before activation.

### Activation invariants

- [ ] Matched physical workout contributes exactly one exposure.
- [ ] Structured completion reaches the strongest appropriate structured evidence tier.
- [ ] Garmin enrichment cannot create a second exposure.
- [ ] Garmin HR/Training Effect does not replace known mechanical strength dose.
- [ ] Manual unlink remains respected by history rebuild.

### Historical backfill

- [ ] Backfill is restartable.
- [ ] Backfill is idempotent.
- [ ] High-confidence auto-links retain matcher evidence/version.
- [ ] Ambiguous pairs remain separate.
- [ ] Existing manual decisions are preserved.
- [ ] Matcher-version migration is explicit and auditable.

## PR 5 — FIT structured-workout identity

- [ ] Parse relevant Workout messages.
- [ ] Parse WorkoutStep messages.
- [ ] Parse lap/workout-step linkage where exposed.
- [ ] Normalize fields before fingerprinting.
- [ ] Version the fingerprint algorithm.
- [ ] Treat fingerprint identity as stronger evidence than generic time/duration heuristics.
- [ ] Ensure absent FIT workout metadata falls back cleanly to existing reconciliation.

## Cross-cutting regression matrix

- [ ] Two strength workouts on the same day.
- [ ] Strength + recovery bike on the same day.
- [ ] Structured workout crossing midnight.
- [ ] DST boundary.
- [ ] Travel/timezone mismatch.
- [ ] Watch + cycling computer duplicate recordings.
- [ ] Same provider activity re-imported after metadata changes.
- [ ] Garmin disconnect/reconnect.
- [ ] Provider activity deleted.
- [ ] Structured execution partially completed.
- [ ] Structured session abandoned while Garmin activity exists.
- [ ] Structured execution corrected after completion.
- [ ] Garmin exercise recognition conflicts with Adaptive exercise identity.
- [ ] Garmin reps/load conflict with athlete-entered values.
- [ ] Garmin `exerciseSets=[]`.
- [ ] Garmin detailed strength endpoint unavailable.
- [ ] Source arrival in either order.
- [ ] Concurrent source arrival.
- [ ] Repeated sync/rebuild.
- [ ] Manual link followed by sync.
- [ ] Manual unlink followed by sync.
- [ ] Matcher-version upgrade.
- [ ] Canonical projection removed and rebuilt.

## Definition of done for the reported strength case

A completed Adaptive structured strength workout recorded simultaneously on Garmin must result in:

- [ ] exactly one Activities row;
- [ ] stable canonical performed-workout identity;
- [ ] `Adaptive Coach + Garmin` provenance;
- [ ] Adaptive exercise names and order;
- [ ] Adaptive planned and performed sets/reps/load;
- [ ] warm-up vs work-set distinction;
- [ ] prescribed rest;
- [ ] actual rest once PR 3 lands;
- [ ] Garmin HR summaries/trace in the same workout;
- [ ] optional Garmin Training Effect/load/EPOC/recovery/calories kept secondary;
- [ ] no silent overwrite from Garmin exercise recognition;
- [ ] no duplicate completed-training exposure;
- [ ] idempotent repeated Garmin sync;
- [ ] reconstructable raw source provenance.

The feature is not complete if the UI merely looks merged while history still double-counts, source provenance becomes ambiguous, or reconciliation cannot be replayed/audited.
