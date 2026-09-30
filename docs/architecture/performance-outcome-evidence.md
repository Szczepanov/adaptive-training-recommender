# Performance outcome evidence architecture

This document describes the **currently implemented** performance-outcome evidence boundary.
It covers OV0–OV6.1: the OV0–OV2 foundation (PR #154, PR #155), the protocol-locked
testing/familiarization/validity workflow (OV3, PR #163), progress/reliability/practical-threshold
interpretation (OV4.1–OV4.3, PR #164), and immutable block-outcome derivation, policy-version
segmentation, and deterministic report/export (OV5–OV6.1, PR #169). Only personal repeatability
estimation (OV4.4, gated on real close-spaced repeat trials), an optional progress/report UI
 (OV6.2, usage-triggered), and operational evidence on the real event/block timeline (the
 remaining OV7.1 data capture plus OV7.2–OV8) remain unimplemented; OV7.1 capture
 infrastructure is now available through the event-aware outcome-capture service. Their planned work stays in
[`performance-outcome-validation.md`](../plans/performance-outcome-validation.md).

## Authority boundary

Performance outcome evidence is a sidecar to training selection.

```text
training selection / adjudication
        |
        v
session execution
        |
        +------------------------------+
        |                              |
        v                              v
process / response evidence      outcome evidence
                                       |
                                       v
                         protocol-aware observation store
```

The evidence vocabulary keeps three planes distinct:

* `decision` — what the recommendation/adjudication system decided;
* `process_response` — what training was delivered and how the athlete responded;
* `outcome` — standardized performance observations and ecological competition results.

The observation intent vocabulary is `training | testing | competition`. Outcome evidence has
**no automatic selection authority**. Architecture tests reject runtime reachability between
OV/outcome evidence and optimizer/planner/rules/weekly-allocation modules in either direction
where that would grant outcome evidence production selection authority. A future
outcome-to-planning rule requires a separate ADR/ship decision.

## Metric registry (app/src/observations/registry.ts)

The outcome metric registry is bounded and strongly typed:

| Metric | Unit | Direction | Domain |
|---|---|---|---|
| `cycling_tt_20m_mean_power_w` | `W` | higher is better | cycling |
| `cycling_tt_4m_mean_power_w` | `W` | higher is better | cycling |
| `cycling_submax_mean_hr_bpm` | `bpm` | context only | cycling |
| `cycling_submax_rpe` | `rpe` | context only | cycling |
| `strength_1rm_kg` | `kg` | higher is better | strength |
| `sprint_elapsed_time_s` | `s` | lower is better | field |
| `cycling_5s_peak_power_w` | `W` | higher is better | cycling |
| `standing_broad_jump_distance_cm` | `cm` | higher is better | field |
| `wall_touch_cmj_height_cm` | `cm` | higher is better | field |
| `seated_medball_throw_distance_m` | `m` | higher is better | field |
| `cycling_sprint_1s_peak_power_w` | `W` | higher is better | cycling |
| `cycling_sprint_5s_mean_power_w` | `W` | higher is better | cycling |

Raw 20-minute mean power is stored as the raw metric. It is not named or persisted as FTP. Context-only metrics cannot be promoted to primary/secondary outcome bindings by the registry contract.

**Pre-existing rules/registry drift fix:** prior to Issue #897 / ADR-0046, `strength_1rm_kg`, `sprint_elapsed_time_s`, `cycling_5s_peak_power_w`, and dimension `timing_method` existed in TypeScript but were omitted from the production `firestore.rules` allowlist, preventing bundled persistence of those metrics. The rules and TypeScript registry now share strict parity via `firestore.rules` `outcomeMetricUnits()` and `comparisonDimensionIds()`, verified by `firestoreRulesParity.test.ts`.

## Measurement protocols and comparison series

`MeasurementProtocol` revisions are immutable evidence-collection contracts. A protocol names:

* the metric IDs it can produce;
* instructions and optional warm-up reference;
* required comparison-context dimensions;
* which required dimensions are series-defining;
* which dimensions are context-only;
* familiarization requirements;
* burden/recovery metadata;
* invalidation rules;
* the comparison canonicalization version.

A series-defining dimension must also be required. A dimension cannot simultaneously be
series-defining and context-only.

Comparison-series construction is deterministic and versioned. V1:

1. validates the observation against the exact protocol revision;
2. selects only series-defining dimensions;
3. normalizes them according to their registered dimension type;
4. sorts by stable dimension ID;
5. canonicalizes metric/protocol/revision/version/dimensions;
6. hashes the canonical payload with SHA-256.

Input object key ordering therefore does not change the series key, while a material
series-defining setup/device change does. Existing observations keep their original
canonicalization version and key if the algorithm changes later.

## Firestore records

All records are user-scoped below `users/{uid}`.

### Protocol revisions

```text
measurement_protocols/{protocolId}/revisions/{revision}
```

Protocol revision documents are create-once and immutable. The document identity must agree
with `protocol.id` and `protocol.revision`.

### Assessment attempts

```text
assessment_attempts/{attemptId}
```

An attempt binds one exact protocol revision to one lifecycle:

```text
scheduled -> in_progress -> completed
                        \-> abandoned
```

Purpose is one of `familiarization | baseline | checkpoint | post_block`. Competition is not
an assessment-attempt purpose.

### Raw assessment trials (ADR-0046)

```text
assessment_attempts/{attemptId}/trials/{trialId}
```

Multi-trial protocols retain repeated attempts and load/velocity evidence as immutable raw trial records below the assessment attempt:

* **Deterministic document identity:** `trialId` is computed by `assessmentTrialIdFor(ordinal, correctionIndex)`. The original attempt for an ordinal is `trial-{ordinal}` (`correctionIndex: 0`); corrections take `trial-{ordinal}-c{correctionIndex}` (`correctionIndex >= 1`). Concurrent corrections for the same ordinal collide on the same document identity instead of silently forking the chain.
* **Attempt lifecycle binding:** enforced by `assertAssessmentTrialWriteAllowed` and Firestore rules `hasValidAssessmentTrial`:
  * `scheduled` — no trial writes allowed;
  * `in_progress` — normal capture window; both new ordinals and corrections are admitted;
  * `completed` — only append-only supersessions/corrections (`correctionIndex > 0`, non-empty `correctionReason`, referencing an existing superseded trial) are admitted; new ordinals are rejected;
  * `abandoned` — no trial writes allowed; any previously recorded trials remain for audit but are never reduced into canonical benchmarks.
* **Capture contract on the protocol revision:** multi-trial protocols declare an immutable `MeasurementProtocol.capture` specification on the protocol revision document (ADR-0046 D-AT-PROTOCOL). This carries `plannedTrials`, `maxTrials`, raw `fields` (`AssessmentTrialFieldDefinition[]`), deterministic `reducers` (`AssessmentReducer[]`), and `reducerVersion` (`ASSESSMENT_REDUCER_VERSION_V1`).
* **Deterministic reducers:** `reduceAssessmentTrials` transforms active trial evidence into canonical benchmark outcomes:
  * `max_valid`: best valid attempt (standing broad jump, medicine-ball throw, cycling sprint 1 s peak power, cycling sprint 5 s mean power);
  * `highest_successful_load`: highest valid successful attempt (bench press 1RM, back squat 1RM);
  * `max_valid_difference`: maximum difference between two fields within a trial (wall-touch CMJ touch height minus standing reach).
* **Typed derivation provenance:** `deriveTrialObservationRevisions` creates canonical `MetricObservationRevision` records with `source: 'derived'`, `algorithmVersion: 'assessment-reducer-v1'`, and `derivedFromEvidenceRefs` containing `{ kind: 'assessment_trial', assessmentAttemptId, trialId }` references per metric. Trial IDs never enter `derivedFromObservationIds` (which is reserved for observation-to-observation derivations).
* **Trial-capture protocols are derive-only:** a protocol revision that declares `capture` cannot receive hand-typed canonical values. `adaptManualObservation` refuses it, and the `hasValidTrialCaptureBinding` Firestore rule requires `source: 'derived'`, `derivedFromEvidenceRefs`, an `algorithmVersion` equal to the protocol's `capture.reducerVersion`, and an `in_progress` or `completed` parent attempt. Summary-only protocols keep manual entry.
* **Capture orchestration (`assessmentCaptureService`):** coordinates the multi-step persistence transaction for trial assessments:
  1. `createTrials` writes all trial rows atomically (idempotent on exact retry);
  2. `listTrialsForAttempt` loads every stored trial (including superseded records); on an `in_progress` attempt, a resubmission that omits an already-stored trial fails closed, because stored trials cannot be removed;
  3. `deriveTrialObservationRevisions` evaluates deterministic reducers and emits canonical revisions with typed trial evidence refs;
  4. `metricObservationService.createInitialRevision` creates head and revision-1 for each derived metric (or skips metrics without valid trials if `allowMissingBenchmark` is explicitly confirmed);
  5. `assessmentAttemptService.completeAttempt` finalizes the attempt.
  A `scheduled` attempt is refused (trials are only recorded once the linked execution has started it), and an unconfirmed missing benchmark returns without completing, keeping the athlete in capture.
  Post-completion trial corrections derive the candidate trial set (stored trials plus the superseding record, `correctionIndex + 1`) in memory first. If that would leave a previously benchmarked metric without any valid trial, the service fails closed *before any write*. Otherwise it persists the superseding trial, then appends corrections via `metricObservationService.appendCorrection` only for metrics whose value or evidence refs changed. Corrected revisions inherit the superseded revision's `sourceRef` execution provenance.
* **Diagnostic JSON export (`assessmentExport` / `assessmentExportService`):** exports the athlete's complete assessment evidence in a deterministic, byte-stable JSON format (`assessment_diagnostic_export_v1`):
  * excludes the athlete's Firebase UID, but remains personal health data (trial values, free-text notes and reasons, device identifiers);
  * retains all measurement protocols and attempts;
  * retains every trial, including superseded corrections with the full chain;
  * includes full observation revision chains (not just latest heads);
  * computes longitudinal progress via `deriveProgress()` across comparable attempts;
  * formats keys with canonical recursive code-unit sorting (`canonicalJson.ts`).
* **Rules parity and immutability:** rules deny trial `update` and `delete` (`allow update, delete: if false`). Parity between rules allowlists/bounds and domain constants is verified by `firestoreRulesParity.test.ts` and `assessmentTrialRules.emulator.test.ts`.

### Metric observations

A logical protocol observation has deterministic identity:

```text
observationKey = `${assessmentAttemptId}:${metricId}`
```

Persistence is split into a mutable selector and immutable evidence:

```text
metric_observations/{observationKey}                  # head
metric_observations/{observationKey}/revisions/{N}    # immutable revision
```

Revision `1` has no predecessor. A correction keeps the same `observationKey`, creates
revision `N+1` with `supersedesRevision: N`, and advances the head from `N` to `N+1` in the
same transaction. Readers resolve the current value through `headRevision`; historical
revisions remain available for audit/replay and cannot be mutated or deleted.

Each revision carries the raw metric/value/unit, observation time, source/device provenance,
exact protocol reference, comparison-series key and canonicalization version, assessment
attempt ID, validity, context and creation time. `invalid`, `practice` and `questionable`
observations remain stored rather than being erased. Derived observations additionally require
source observation IDs and an algorithm version.

### Competition outcomes

```text
competition_outcomes/{competitionOutcomeId}
```

Competition outcomes are immutable ecological evidence. They intentionally have no
`protocolRef`, `comparisonSeriesKey` or `assessmentAttemptId`. A race result therefore cannot
silently enter a protocol time-trial comparison series.

## Manual observation adapter

Manual entry is the first write adapter. The adapter:

1. validates the exact protocol revision;
2. validates that the metric belongs to the protocol and that its unit matches the registry;
3. validates required comparison context;
4. computes the deterministic comparison-series key;
5. emits an immutable observation revision with `source: 'manual'` and explicit
   source/device/validity provenance.

The adapter is platform-neutral. The athlete-facing phone completion/correction workflow
(protocol-locked testing intent, familiarization/validity UX, completion-to-observation write)
is the OV3 slice, implemented in `app/src/observations/protocols.ts` and
`app/src/services/measurementProtocolService.ts`.

## Security rules

Firestore rules enforce the persistence invariants independently of client validation:

* authenticated user-path isolation;
* known top-level keys and enum/value shapes;
* known metric/unit pairs;
* immutable protocol and observation-revision documents;
* protocol and assessment-attempt identity for protocol observations;
* atomic initial head + revision-1 creation;
* atomic `N -> N+1` head advance plus matching immutable correction revision;
* predecessor/supersession consistency and stale-writer rejection;
* required source IDs + algorithm version for derived observations;
* ecological competition records cannot add protocol-only fields.

The dedicated Firestore emulator suite covers valid initial/manual writes, valid correction
chains, stale/skipped correction rejection, malformed units/shapes, protocol immutability,
cross-user denial, assessment lifecycle provenance and competition-outcome isolation.

## Reliability provenance

Reliability metadata is explicit evidence rather than a synthetic confidence probability:

```text
source: literature_reference | personal_repeatability | manual
statistic: cv_pct | typical_error_pct | typical_error_abs | sem_abs
```

Progress comparison, reliability/error interpretation, and practical-threshold interpretation are
implemented (OV4.1–OV4.3, `app/src/observations/progress.ts`, `app/src/outcomes/evaluationSpec.ts`).
Personal repeatability estimation (OV4.4) remains unimplemented — it requires suitable repeated
comparable trials that do not yet exist for a real athlete, and stays gated behind that evidence.

## Block outcome derivation and reporting (OV5–OV6.1)

Immutable block outcome-evaluation specifications and block verdicts are implemented in
`app/src/outcomes/blockOutcome.ts`, with policy-version segmentation in
`app/src/outcomes/policySegments.ts` and a deterministic evaluation-content hash in
`app/src/outcomes/evaluationHash.ts`. Deterministic block report/export (CSV/JSON) is
implemented in `app/src/outcomes/blockOutcomeReport.ts`, with supporting process/response
evidence assembled by `app/src/outcomes/blockProcessEvidence.ts`. `app/src/outcomes/feedbackLoopEvidence.ts`
(added 2026-08-26 as part of SV4/SV5) is a further additive extension over this evidence — it is
tested to never move the block verdict, preserving the authority boundary below.

## Not implemented yet

The following are deliberately absent from the current architecture:

* personal repeatability estimation (OV4.4) — gated on real close-spaced repeat trials;
* any progress/report dashboard UI (OV6.2) — usage-triggered, not yet justified by real report use;
* operational evidence on the real event/block timeline (the remaining OV7.1 data capture plus OV7.2–OV8);
* automatic recommendation changes based on outcome evidence.

The last item is not merely unfinished UI. It is an explicit architecture boundary: adding
selection authority to outcome evidence requires a separate evidence-backed decision. Architecture
tests (`app/src/outcomes/blockOutcomeArchitecture.test.ts`) enforce it by asserting no runtime
reachability between the outcome/OV modules and `rules.ts`, `optimizer.ts`, `planner.ts`, or
`trainingIntent.ts` in either direction.
