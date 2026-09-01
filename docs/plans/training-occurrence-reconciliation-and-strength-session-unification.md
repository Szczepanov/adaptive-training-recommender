# Training occurrence reconciliation and structured strength session unification

Status: implementation plan

## Problem statement

Structured workouts and Garmin activities currently represent the same physical workout through separate data paths. For strength training in particular, this causes the Garmin activity to be the visible object in Activities while the richer Adaptive Coach execution data is not consistently surfaced as the semantic source of truth.

The repository already contains most of the required building blocks:

- structured session execution with `SessionExecution` and `SessionEntry` persistence;
- planned-versus-performed comparison logic;
- Garmin activity ingestion, including strength `exerciseSets` where available;
- Garmin physiological telemetry and training-effect/load fields;
- an occurrence reconciliation module intended to recognize when a structured execution and a Garmin activity are the same physical occurrence.

The main gap is that these pieces are not yet composed into one canonical completed-workout read model used by Activities and downstream training-history logic.

A secondary gap is performed-rest fidelity. Adaptive prescriptions retain target rest and the logger presents a rest timer, but durable session-entry data does not yet model a trustworthy performed-rest interval. That prevents the UI and coach from distinguishing prescribed rest from actual rest.

## Design principle

One physical workout should have one canonical occurrence.

For a matched structured strength session:

- Adaptive Coach is authoritative for workout identity, exercise semantics, prescribed structure, performed sets, performed repetitions, performed load, warm-up/work-set classification, skipped or modified work, and planned-versus-performed comparison.
- Garmin enriches the occurrence with measured physiology and device telemetry.
- Garmin exercise recognition and Garmin set metadata remain fallback or diagnostic evidence when a structured Adaptive execution exists; they must not silently overwrite structured execution data.

This yields the source-of-truth hierarchy below.

| Field / concept | Primary source for matched structured workout | Notes |
| --- | --- | --- |
| Workout identity and title | Adaptive | Garmin title may be retained as source metadata |
| Planned exercise order | Adaptive | Prescription snapshot |
| Planned sets / reps / load | Adaptive | Prescription snapshot |
| Prescribed rest | Adaptive | Prescription |
| Actual completed sets | Adaptive | `SessionEntry` |
| Actual reps | Adaptive | `SessionEntry` |
| Actual load | Adaptive | `SessionEntry` |
| Warm-up vs work set | Adaptive | `SessionEntry` / prescription |
| Planned-vs-performed comparison | Adaptive | Reuse existing comparison logic |
| Actual rest | Adaptive | Requires explicit durable rest events |
| HR trace / avg / max / zones | Garmin | Measured physiology |
| Timer / elapsed duration | Garmin when present | Preserve Adaptive execution timestamps too |
| Device / sensor provenance | Garmin | Useful for trust and diagnostics |
| Garmin Training Effect / training load / EPOC / recovery | Garmin, secondary | Supplemental evidence; not mechanical strength dose |
| Calories | Garmin, secondary | Supplemental |
| Garmin exercise recognition / reps / weight | Garmin fallback/diagnostic | Primary only for Garmin-only strength activities |

## Non-goals

This plan does not:

- make Garmin HR or Training Effect the primary strength-load model;
- overwrite raw Garmin activity documents with Adaptive session data;
- overwrite structured execution documents with Garmin activity payloads;
- auto-merge ambiguous historical workouts;
- require FIT workout-step decoding before the initial reconciliation path can ship.

## Current-state analysis

### Structured execution already persists useful performed data

Structured sessions already persist a session execution and per-set entries. Those entries capture the information that matters most for strength semantics, including actual repetition and load values and completion timestamps.

This means the primary defect is not that all structured execution data is absent. Rather, it is not the canonical source used by the Activities detail experience when a Garmin activity also exists.

### Garmin strength ingestion already supports set detail

The Garmin normalization path already models strength-set information such as set order/type, repetitions, weight, exercise category/name, work duration, and rest duration when Garmin exposes it.

That data is useful for Garmin-only workouts and diagnostics, but it should not be allowed to override a known structured execution because Garmin exercise recognition and rep detection can be incomplete or wrong.

### Reconciliation already exists conceptually

The repository contains occurrence-reconciliation logic intended to recognize when a structured execution and Garmin activity are the same physical workout. The implementation plan should productionize that concept and make its output the public read path rather than introduce another independent matcher.

### The Activities path is provider-centric

The Activities detail flow is currently centered on normalized Garmin activities. That explains the observed behavior: Garmin workout data is visible, while structured execution is not shown as the workout's main semantic content.

### Performed rest is not durably represented with sufficient fidelity

Prescription data can contain target rest, but an entry completion timestamp alone is insufficient to calculate performed rest. The interval between two completion timestamps includes rest, setup, next-set work, and logging delay.

Actual rest therefore needs explicit durable event/timing data.

## Target architecture

Introduce a canonical `TrainingOccurrence` domain/read model meaning "one physical workout the athlete actually performed".

```ts
interface TrainingOccurrence {
  occurrenceId: string;
  userId: string;

  modality: TrainingModality;
  startedAt: Timestamp;
  endedAt?: Timestamp;
  durationSeconds?: number;

  sources: {
    structured?: {
      sessionId: string;
      executionId: string;
    };
    garmin?: {
      activityId: string;
      provider: 'garmin';
      deviceId?: string;
    };
  };

  workout?: {
    prescription: ExecutionPrescription;
    performed: PerformedWorkout;
    comparison: PlannedPerformedComparison;
  };

  telemetry?: {
    heartRate?: HeartRateTelemetry;
    timerDurationSeconds?: number;
    elapsedDurationSeconds?: number;
    garmin?: {
      trainingEffectAerobic?: number;
      trainingEffectAnaerobic?: number;
      trainingLoad?: number;
      epoc?: number;
      recoveryTime?: number;
      calories?: number;
    };
  };

  reconciliation: {
    status: 'single_source' | 'matched' | 'ambiguous';
    method?: MatchMethod;
    confidence?: number;
    matchedAt?: Timestamp;
    manuallyConfirmed?: boolean;
    schemaVersion: number;
  };
}
```

Conceptually:

```text
SessionExecution ─┐
                  ├─> TrainingOccurrence ─> Activities
Garmin Activity ──┘                     └─> training history / coach evidence
```

Raw source records remain independently stored and reconstructable. The occurrence is a canonical projection/linkage layer, not destructive data fusion.

## Storage strategy

Recommended collection:

```text
users/{uid}/trainingOccurrences/{occurrenceId}
```

Each occurrence should persist:

- stable occurrence ID;
- source references;
- reconciliation status;
- match method and confidence;
- match algorithm version;
- timestamps for reconciliation creation/update;
- manual override/unlink state;
- schema version;
- materialized public read fields required by Activities and training history.

A materialized projection is preferred over composing every source document on every read because:

- Activities becomes simpler and faster;
- coach/history semantics become provider-agnostic;
- one-occurrence deduplication is explicit;
- the projection can still be rebuilt from source references.

## Source precedence rules

For a matched structured workout:

1. Structured execution wins for semantic/mechanical workout fields.
2. Garmin wins for measured device telemetry.
3. Garmin structured-set fields are retained as source evidence only unless Adaptive performed data is missing.
4. Missing Garmin data must never erase Adaptive data.
5. Missing Adaptive performed fields may fall back to Garmin only when provenance is explicit.

For a Garmin-only workout:

- preserve current Garmin behavior;
- use Garmin `exerciseSets` when available;
- mark the occurrence as single-source Garmin.

For an Adaptive-only workout:

- make it visible in Activities even without a wearable activity;
- mark telemetry as unavailable rather than fabricate values.

## Reconciliation strategy

Reuse and productionize the existing occurrence-reconciliation module.

### Tier 1: explicit identity

Best case: when an Adaptive workout is exported/scheduled to Garmin, persist a durable correlation identifier or prescription fingerprint that can later be recovered from the completed Garmin activity or related workout metadata.

A deterministic link should always beat heuristic matching.

### Tier 2: structured FIT/workout identity

Garmin FIT Activity files can carry structured workout definitions and workout-step references. A later enhancement should decode useful workout identity/step fields and build a normalized prescription fingerprint.

This should be treated as an enhancement, not a blocker for initial occurrence reconciliation.

### Tier 3: heuristic reconciliation

For existing data and cases without explicit identity, score candidate pairs using conservative evidence such as:

- same user;
- compatible modality;
- start-time proximity;
- actual time overlap;
- duration similarity;
- local-day consistency as secondary evidence;
- title similarity where meaningful;
- exercise/set structural similarity when Garmin strength sets exist;
- absence of another plausible competing candidate.

Rules:

- high confidence: auto-link;
- medium confidence: mark ambiguous; do not silently merge;
- low confidence: keep occurrences independent;
- manual unlink/confirmation must be sticky and survive future syncs.

False-positive merges are worse than temporary duplicates because they corrupt training history.

## Idempotency and lifecycle

The lifecycle must support either source arriving first.

### Adaptive execution first

1. Structured workout completes.
2. Create/update Adaptive-only occurrence.
3. Garmin sync arrives later.
4. Reconcile and attach Garmin source.
5. Preserve the same occurrence ID.

### Garmin first

1. Garmin activity arrives.
2. Create/update Garmin-only occurrence.
3. Structured execution completes later.
4. Reconcile and attach Adaptive source.
5. Preserve the same occurrence ID where possible; if IDs are already public, perform an explicit alias/merge migration rather than duplicate public rows.

### Repeated provider sync

Repeated Garmin imports must update the existing source and occurrence projection without duplicating the workout.

## Performed rest and execution timeline

Add durable set-start and rest-event timing instead of inferring rest from completion timestamps.

Recommended fields:

```ts
interface SessionRestEvent {
  id: string;
  executionId: string;
  afterEntryId: string;

  prescribedSeconds?: number;
  startedAt: Timestamp;
  endedAt: Timestamp;
  actualSeconds: number;

  endReason:
    | 'timer_elapsed'
    | 'skipped'
    | 'next_set_started'
    | 'session_ended';

  adjustmentSeconds?: number;
}
```

Extend session entries with an explicit `startedAt` where the logger can determine it reliably.

The rest timer UI should become the producer of these durable events. Prescribed rest and performed rest must remain separate fields.

This timeline later allows Garmin HR samples to be aligned to work and rest intervals without making that alignment a prerequisite for the initial merge.

## Activity-detail read model

Replace the provider-specific mental model of "Garmin Activity" with "Completed Workout".

For a matched structured workout, the detail page should show:

### Header

- Adaptive workout title;
- modality;
- start/end/duration;
- source badge such as `Adaptive Coach + Garmin`.

### Plan / performance

For every exercise/set where relevant:

- exercise name;
- set index;
- warm-up/work-set status;
- prescribed reps/load;
- performed reps/load;
- prescribed rest;
- performed rest once available;
- skipped/modified status.

Also show session-level adherence/completion summaries using existing planned-versus-performed comparison logic.

### Garmin telemetry

Keep physiological/device data as a distinct section:

- HR average/max;
- HR trace and zones when available;
- timer/elapsed duration;
- device/sensor provenance;
- optionally Training Effect, activity training load, EPOC, recovery, and calories.

Garmin exercise recognition should not appear as a competing second representation of the same workout. It may be exposed under debug/source diagnostics.

## Training-history and coach integration

The canonical occurrence should become the unit consumed by completed-training history.

The critical invariant is:

> one physical workout contributes one completed exposure.

For a matched structured workout:

- structured completion should drive the high-confidence workout semantics;
- Garmin physiology can enrich that evidence;
- the same workout must not contribute once through Adaptive and again through Garmin;
- mechanical strength dose should come from performed structure when available rather than being inferred primarily from HR or Garmin Training Effect.

This integration should be implemented after the occurrence/read-model behavior is validated because it can change recommendations and training-load accounting.

## Historical backfill

Historical reconciliation must be conservative.

For each candidate Adaptive/Garmin pair, retain the features used by the matcher, the confidence, and the matcher algorithm version.

Suggested classification:

- `AUTO_MATCHED`: above high-confidence threshold;
- `AMBIGUOUS`: between thresholds, no silent merge;
- `UNMATCHED`: below threshold.

Do not auto-merge merely because two strength sessions occurred on the same date.

Historical backfill should be restartable and idempotent.

## Observability

Add metrics/logging for both ingestion quality and occurrence reconciliation.

Suggested counters:

```text
strength.activities.total
strength.garmin.exercise_sets.present
strength.garmin.exercise_sets.empty
strength.garmin.exercise_sets.unavailable

training_occurrence.structured_only
training_occurrence.garmin_only
training_occurrence.matched
training_occurrence.ambiguous

reconciliation.auto_matched
reconciliation.manual_matched
reconciliation.manual_unlinked
```

Add a targeted diagnostic for:

> completed structured strength execution + temporally overlapping Garmin strength activity + no occurrence match

That condition should be rare once the feature is operating correctly.

Preserve the distinction between unavailable Garmin detail and a successful response containing an empty set list.

## Implementation sequence

### PR 1: canonical training occurrence

Scope:

- introduce `TrainingOccurrence` schema/model;
- add source references and reconciliation provenance;
- productionize existing occurrence reconciliation;
- implement idempotent occurrence upsert;
- support high-confidence auto-link and ambiguous status;
- honor sticky manual overrides;
- add reconciliation unit tests and telemetry.

Do not change coach load/readiness behavior yet.

### PR 2: unified Activities/read model

Scope:

- add a provider-agnostic occurrence service/query;
- make Activities list completed occurrences rather than Garmin activities only;
- build a completed-workout detail DTO/view model;
- show Adaptive prescription + performed structure as primary for matched workouts;
- show Garmin HR/device physiology as enrichment;
- support Adaptive-only and Garmin-only occurrences;
- preserve raw-source diagnostics behind a debug/admin affordance if needed.

### PR 3: performed rest and execution timeline

Scope:

- persist set start/end when reliable;
- persist rest events from the structured logger;
- preserve prescribed vs actual rest separately;
- render prescribed/actual rest in Activity Details;
- add timer-path tests for elapsed, skipped, extended, next-set-started, and session-ended rest.

Optional follow-up inside or after this PR:

- align HR samples to set/rest intervals;
- derive descriptive set-level HR metrics.

### PR 4: coach/history integration and backfill

Scope:

- consume canonical occurrences in completed-training history;
- guarantee no double counting;
- prioritize performed structured strength data for strength semantics/dose;
- keep Garmin physiology supplemental;
- add historical reconciliation/backfill;
- add recommendation/load regression tests.

### PR 5: FIT structured-workout identity enhancement

Scope:

- decode useful FIT Workout / WorkoutStep / workout-step-index linkage;
- normalize structured-workout identity;
- build a prescription fingerprint;
- use it as higher-confidence reconciliation evidence than time-only heuristics.

This enhancement should not block PRs 1-4.

## Required test matrix

### Reconciliation and identity

1. Structured + Garmin strength => one occurrence and one Activities row.
2. Adaptive completion arrives before Garmin => later enrichment, stable occurrence identity.
3. Garmin arrives before Adaptive completion => later reconciliation, no visible duplicate.
4. Repeated Garmin sync => idempotent update.
5. Two strength workouts on one day => no accidental cross-link.
6. Ambiguous candidate pair => no silent merge.
7. Manual unlink => sticky across subsequent syncs.
8. Manual confirm => sticky unless explicitly undone.
9. Timezone/DST boundary => matching uses actual timestamps; local date is secondary only.

### Source precedence

10. Adaptive says Squat 5 x 120 kg while Garmin detects another exercise/reps => Adaptive remains canonical.
11. Garmin `exerciseSets=[]` => structured performed data remains intact.
12. Garmin strength-detail API unavailable => structured workout remains fully usable.
13. Garmin-only strength => Garmin sets/reps remain visible when available.
14. Adaptive-only strength => visible in Activities without wearable telemetry.

### Execution fidelity

15. Partial structured completion => skipped/modified work displayed correctly.
16. Warm-up sets => distinguished from work sets.
17. Cancelled session => not converted to completed occurrence merely because Garmin exists.
18. Prescribed rest => shown even before actual-rest persistence exists.
19. Performed rest events => correct for elapsed/skip/extend/next-set/session-end paths.

### Training history

20. Matched occurrence contributes exactly one completed exposure.
21. Structured strength semantics are used in preference to generic Garmin modality/intensity inference.
22. Garmin physiological enrichment does not create a second exposure.
23. Backfill is idempotent and does not alter manually separated occurrences.

## Acceptance criteria

Given an athlete who:

1. starts an Adaptive Coach structured strength session;
2. also records Strength on Garmin;
3. follows the exercises, sets, repetitions and prescribed rest;
4. completes both recordings;
5. allows Garmin to sync;

then the system must:

1. show one completed workout in Activities;
2. identify its sources as Adaptive Coach + Garmin;
3. show Adaptive exercise names/order;
4. show prescribed and performed sets/reps/load;
5. show warm-up/work-set classification;
6. show prescribed rest;
7. show actual rest after timeline persistence is implemented;
8. show Garmin HR in the same completed workout;
9. retain selected Garmin physiological metrics separately from strength semantics;
10. never allow Garmin exercise recognition to silently overwrite Adaptive performed data;
11. count the workout only once in completed-training history;
12. remain idempotent across repeated Garmin synchronization;
13. continue to support Garmin-only and Adaptive-only sessions;
14. leave ambiguous pairs unmerged instead of guessing.

## Investigation checklist for the reported case

Before or during PR 1 implementation, inspect a representative affected workout and record:

- whether the expected `SessionExecution` exists;
- whether all expected `SessionEntry` documents exist;
- whether the Garmin activity exists;
- whether `exerciseSets` is missing, unavailable, empty, or populated;
- whether Garmin detail ingestion logged an error or successful empty response;
- how many reconciliation candidates existed within the matching window;
- what the current occurrence-reconciliation module returns for the pair.

This determines whether the reported symptom is solely a read-model/reconciliation problem or also contains a Garmin strength-detail ingestion defect.

## Architectural invariant

The end state should be easy to state and test:

```text
one physical workout
    -> one TrainingOccurrence
        -> Adaptive describes what was prescribed and performed
        -> Garmin describes measured physiology/device telemetry
```

For structured strength training, the coach should know what the athlete actually lifted from the structured execution, not attempt to reconstruct the strength workout from average HR or Garmin exercise recognition.
