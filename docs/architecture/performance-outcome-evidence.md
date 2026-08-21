# Performance outcome evidence architecture

This document describes the **currently implemented** performance-outcome evidence boundary.
It covers the OV0–OV2 foundation delivered by PR #154 and PR #155. Progress classification,
block verdicts, outcome-evaluation specifications and athlete-facing testing UI are not yet
implemented; their planned work remains in
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

## V1 metric registry

The current registry is deliberately cycling-first and bounded:

| Metric | Unit | Direction |
|---|---|---|
| `cycling_tt_20m_mean_power_w` | `W` | higher is better |
| `cycling_tt_4m_mean_power_w` | `W` | higher is better |
| `cycling_submax_mean_hr_bpm` | `bpm` | context only |
| `cycling_submax_rpe` | `rpe` | context only |

Raw 20-minute mean power is stored as the raw metric. It is not named or persisted as FTP.
Context-only metrics cannot be promoted to primary/secondary outcome bindings by the registry
contract.

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

The adapter is platform-neutral. The athlete-facing phone completion/correction workflow is
not part of OV2; it is the next OV3 testing-workflow slice.

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

The current foundation stores and validates provenance only. Personal repeatability estimation
and progress interpretation are later OV4 work and require suitable repeated comparable trials.

## Not implemented yet

The following are deliberately absent from the current architecture:

* runner-integrated protocol-locked testing/familiarization/validity UX (OV3);
* comparable progress labels and error/practical-threshold interpretation (OV4);
* immutable block outcome-evaluation specifications and block verdicts (OV5);
* block report/export and any progress dashboard (OV6);
* automatic recommendation changes based on outcome evidence.

The last item is not merely unfinished UI. It is an explicit architecture boundary: adding
selection authority to outcome evidence requires a separate evidence-backed decision.
