# ADR-0051: Cross-source workout-step identity for activity-response segments

- **Status:** Accepted (implementation gated by D7)
- **Date:** 2026-10-17
- **Related:** ADR-0023, ADR-0026, ADR-0031, ADR-0034, issues #814, #850, #895, #919, PR #917

## Context

`activityResponse` segments (`activity_response.py`, persisted as `ActivitySegmentSummary`)
carry FIT or manual-lap identity. The activity-response architecture reserves a stronger tier,
"reconciled Adaptive-authored occurrence/step", but no producer exists. PR #917 keeps
`reconciled_workout_step` out of `ActivitySegmentIdentitySource` and rejects it during
hydration in `trainingHistory.ts`. Issue #919 asks whether a deterministic, explicit
segment-to-step contract is possible, or whether the boundary should stay fail-closed.

An end-to-end audit of the current code found:

| Hop | What it carries | Step reference? |
|---|---|---|
| Authored step (`SessionStep.id`, `sessions/models.ts`) | Stable id within one `SessionDefinition` revision; occurrence binding carries `prescriptionHash` | Yes, but Adaptive-only |
| Canonical export (`CanonicalWorkoutExport`, `workoutJsonExport.ts`) | `CanonicalExportStep.id` is optional; catalog export is produced separately from the execution adapter (`exportWorkoutPrescriptionToJson` vs `adaptCatalogPrescriptionToSessionDefinition`) | Optional, and not guaranteed to equal `SessionStep.id` |
| Garmin upload (`workout_export.py` `canonical_workout_to_garmin_payload`, mirrored by `fitWorkoutIdentity.ts` `canonicalWorkoutToGarminPayload`) | `stepId: None`, sequential `stepOrder`, generated rest/recovery steps, repeat groups | **No.** The Adaptive step id is dropped here |
| Recorded FIT (`fit_activity.py`) | Workout Step `message_index` plus Lap/Record `wkt_step_index` | Provider index only |
| Session-level identity (`fit_workout_identity.py`, `fitWorkoutIdentity.ts`) | `fit-workout-v2` semantic fingerprint over the flattened FIT step definition, including each `messageIndex`. Execution side gets it from the exact export payload at launch (`sessionAuthoringService.ts` `computeCatalogFitIdentity`); only **catalog** launches produce it today | Proves the *whole definition* matches, not which step a segment is |
| Persisted segment (`ActivitySegmentSummary`) | `segmentIndex`, semantic type, offsets | **No.** The FIT step index is used during derivation and then discarded |
| Execution entries (`SessionEntry`) | `stepId`, `completedAt` wall-clock instants | Adaptive step id; no shared clock contract with segment offsets |

So no stable explicit step reference survives end to end today. Two transport facts make one
achievable without a new provider request:

1. The semantic fingerprint hashes every normalized step, and `messageIndex` is one of the
   hashed fields (`normalizeStep` / `_normalized_step`). So when the execution's fingerprint
   equals the activity's, the recording's FIT Workout Step list matches, index for index, the
   list Adaptive predicted from its export payload.
2. Garmin flattens the uploaded payload into FIT steps on its side. Adaptive models that
   flattening in TypeScript only (`garminPayloadToFitSteps`). Python never flattens: it reads
   the recorded FIT steps and fingerprints them, and the shared
   `tests/fixtures/contracts/fit_workout_identity_v2.json` vectors keep the two hash
   implementations in step. In the model, each flattened index comes from exactly one
   canonical export step, one generated rest or recovery step, or one repeat-control step.
   Fingerprint equality, not the model, is what proves a given recording followed that layout.

The missing pieces are therefore a **producer-side manifest** from flattened FIT index to
Adaptive step, and **persisting the FIT step index** on each segment. Occurrence membership
and timestamps remain inadmissible.

## Decision

### D1 — Identity target is an authored step slot, not an execution entry

A reconciled segment identifies `(occurrenceId, prescriptionHash, stepId, roundOrdinal)`: which
authored step, and which repetition of it, produced the segment. It does **not** identify a
`SessionEntry`. Entries have wall-clock `completedAt` instants, segments have elapsed offsets,
and no clock-alignment contract joins them. Entry-level correspondence stays out of scope and
is never inferred from timestamps.

### D2 — The only admissible shared reference

A segment may receive `reconciled_workout_step` only when **all** of the following hold:

1. The activity is a canonical source of exactly one performed occurrence (ADR-0034), and that
   occurrence has exactly one linked structured execution. An ambiguous or partial source set
   fails closed, as the response layer already does.
2. The execution and the activity both carry `fitWorkoutFingerprintKind: semantic_definition`
   with the same fingerprint version, and the fingerprints are equal.
3. The execution carries a launch-time step manifest (D3) whose embedded fingerprint equals
   that same fingerprint, and whose `prescriptionHash` equals the execution's.
4. The segment's identity source is `fit_workout_step`, and it carries a persisted FIT step
   index (D4) that the manifest maps to an authored step.
5. The segment's round ordinal is established by the program walk in D5.

Occurrence membership alone, ordered occurrence position, duration or role similarity, step
names, and timestamp proximity never qualify, individually or combined.

### D3 — Producer: an export-time step manifest bound to the fingerprint

The same code path that computes the semantic fingerprint from the exact canonical export
payload also emits a bounded, versioned **step manifest**:

```text
workoutStepManifest {
  manifestVersion: 'fit-step-manifest-v1'
  fitWorkoutFingerprint, fitWorkoutFingerprintVersion
  prescriptionHash
  entries[]: { messageIndex, kind: 'authored' | 'generated_rest' | 'repeat_control',
               stepId?, repeatIterations? }
}
```

- `stepId` is the `SessionStep.id` in the frozen definition snapshot. The producer must resolve
  canonical export step to `SessionStep.id` explicitly. A positional guess across the two
  adapters is not enough. For catalog launches, both `exportWorkoutPrescriptionToJson` and
  `catalogSessionAdapter` copy the catalog step `id`, so the producer can resolve by equal id
  and must assert that it is one-to-one. If any authored export step cannot be resolved
  one-to-one, no manifest is emitted.
- `generated_rest` and `repeat_control` entries are provider-only. Segments on them keep FIT
  identity.
- The manifest is written once at launch, next to the fingerprint on the `SessionReferenceBinding`
  and `SessionExecution`, and is immutable afterwards. It names the `prescriptionHash` it was
  built against instead of being folded into that hash, which would be circular: the
  prescription is hashed before export identity is computed. It is never rebuilt from the live
  definition or from current settings, such as FTP.
  The fingerprint producer already refuses to run without the exact upload context, and the
  manifest inherits that refusal.
- Size is bounded by the flattened FIT step count of one workout.
- Only TypeScript produces the manifest. The real Garmin upload, however, is built by Python
  `canonical_workout_to_garmin_payload`, while the manifest is derived from its TypeScript
  mirror `canonicalWorkoutToGarminPayload`. A shared contract vector must therefore pin the
  two payload builders to the same step layout, including repeat groups, generated rest and
  block recovery. Fingerprint equality catches drift on any one recording, and the vector
  catches it before release.
- The TypeScript flattening model handles one level of repeat group. A payload with a nested
  repeat group gets no manifest.

Only launch paths that produce a semantic fingerprint can produce a manifest. Today that is
catalog launch only. External-plan, manual and unplanned sessions stay unavailable until their
own export-to-launch path computes both from one payload.

### D4 — Ingestion: persist the FIT step index on segments, no new request

`activity_response.py` already resolves each lap or record group to a `workout_step_index`. A
new `derivationVersion` adds an optional `fitWorkoutStepIndex` to `fit_workout_step` segments
only. A segment whose records span more than one step index already resolves to no index,
and it stays without one. This is additive, so older documents simply have no reconciled tier. It uses the
original-FIT acquisition already performed for HR fidelity. Historical activities gain it only
through the existing operator `backfill-activity-response` command. No provider request,
source or retained raw payload is added.

### D5 — Round ordinals come from a program walk; deviations fail closed

Repeated children share one FIT index, so the index alone cannot say which repetition a
segment is. A pure function expands the manifest into the full expected index sequence,
honouring repeat-control iterations. It then compresses the performed segments into runs of
equal consecutive `fitWorkoutStepIndex`, so a step recorded as more than one lap merges into
one run. Each run must match the expected sequence in order.

- The **longest matching prefix** is reconciled, with each run's round ordinal taken from its
  position in the expansion. A step outside any repeat group has round ordinal 1. That covers
  an early stop or partial workout. A step cut short, for example by advancing it early with
  the lap button, still matches because only the index order is compared.
- From the first deviation onward, every segment keeps FIT identity. Deviations include a
  skipped step, a reorder, an extra round, an index the manifest lacks, and a segment with no
  `fitWorkoutStepIndex` (including manual-lap segments) in the middle of the sequence.
- When `segmentsTruncated` is set, the walk sees only the persisted segments. They are a
  prefix, so the same rule applies, and nothing past the cap is reconciled.
- A repeat group with a single child step cannot separate rounds from splits, so it fails
  closed for that group.
- Duplicate manifest indexes, unknown manifest versions, or a fingerprint or `prescriptionHash`
  mismatch fail the whole activity closed. In that case no segment is reconciled.

The function is pure, with no Firestore, `fetch` or `Date.now()`. It runs at read time in the
response layer. The upgraded identity is never written back to the activity document.

So `reconciled_workout_step` is never a valid **persisted** `identitySource`. The #917
hydration guard in `trainingHistory.ts` keeps rejecting it permanently, not just until this
ADR is implemented. The reconciled tier exists only on the in-memory projection the join
returns. That projection gets its own type, separate from the persisted
`ActivitySegmentSummary`, so the persisted identity union is never widened.

### D6 — Authority is unchanged

Reconciled identity is display and context-brief evidence only. It lets the response layer say
"round 3 of the 4×4 work step". It does not grant recommendation, readiness, load or safety
authority, and it does not select `semantic_protocol_match`, which stays reserved. No
`POLICY_VERSION` change is needed. The architecture import guard that isolates response
comparability from recommendation modules also covers the new function.

### D7 — Feasibility gate before implementation

Code lands only after both checks pass:

1. **Real-data evidence.** A new read-only diagnostic shows real completed catalog executions
   whose semantic fingerprint equals a linked activity's. The existing workout-source
   diagnostics do not report fingerprints, so this has to be added. If the count is zero, then
   watch-edited or renamed workouts, Garmin re-canonicalization or missing FTP context defeat
   the premise. The workout name is part of the fingerprint. In that case the feature stays
   unavailable, and the reason is recorded.
2. **Vendor round-trip check.** At least one real Garmin recording of an Adaptive-exported
   workout with a repeat group confirms that Lap `wkt_step_index` follows the flattened
   `messageIndex` order assumed here.

Until then, the reconciled tier is unavailable. When it ships, the producer, ingestion, join
and tests land **together**. The persisted-value guard stays either way (D5).

## Alternatives considered

- **Timestamp alignment of entries to segment offsets.** Rejected. There is no shared clock
  contract, and close timestamps are not identity. #919 forbids this explicitly.
- **Encoding the Adaptive step id in the Garmin step description or name.** Rejected as the
  identity carrier. The athlete sees it, can edit it on the device or in Garmin Connect, it may
  be truncated, and it changes the semantic fingerprint input, so it would invalidate existing
  fingerprints. The manifest uses the definition the fingerprint already proves.
- **Index-only mapping without fingerprint equality.** Rejected. The same index means different
  steps across definitions or revisions.
- **Persisting the reconciled identity at ingestion.** Rejected. Python ingestion does not own
  the execution prescription, and a read-time pure join keeps ADR-0034's canonical execution
  authority in one place.

## Consequences

- When the gate passes, catalog-launched structured endurance workouts gain step-level response
  provenance, such as per-round work-step comparison, with no new provider traffic.
- Every other source stays at FIT or manual identity, with an explicit reason. That includes
  provider-authored workouts, watch-edited workouts, non-catalog launches, single-child repeat
  groups and legacy activities.
- Strength workouts are out of scope for v1. Their FIT exercise and set structure does not map
  to laps the same way, and ADR-0034 already gives exercise, load and repetition authority to
  the structured execution.
- Implementation is multi-layer: the launch-time manifest producer, the TS/Python payload
  parity vector, the `activityResponse` derivation bump, and the pure read-time join with its
  separate projection type. All of these land in one change, together with negative fixtures
  for reordered, repeated, skipped, partial, split-lap, truncated and provider-only segments,
  and for timestamps that are close but share no reference.
- If D7 fails, `docs/architecture/activity-response-telemetry.md` and the status board record
  the concrete missing capability, and this ADR moves to Rejected.
