# Structured strength and Garmin activity reconciliation analysis

Status: analysis / problem definition

Companion implementation plan: `docs/plans/training-occurrence-reconciliation-and-strength-session-unification.md`

## Executive summary

The reported behavior is consistent with an architectural split rather than a single UI rendering defect.

A structured Adaptive Coach session and a Garmin activity can represent the same physical workout through separate persistence and read paths:

```text
Adaptive Coach plan
      |
      v
SessionExecution
      |
      +-- prescription snapshot
      +-- SessionEntry[]
             +-- exercise/item
             +-- set index
             +-- actual reps
             +-- actual load
             +-- warm-up/work-set semantics
             +-- completedAt

                         SAME PHYSICAL WORKOUT

Garmin watch
      |
      v
Garmin activity
      |
      +-- HR / HR samples
      +-- duration
      +-- Training Effect / training load
      +-- device metadata
      +-- exerciseSets[] when available
             +-- Garmin-recognized exercise
             +-- reps
             +-- weight
             +-- work duration
             +-- rest duration
```

The repository already contains most of the necessary components, including structured execution persistence, Garmin strength-set ingestion, planned-versus-performed comparison, and occurrence reconciliation. The missing architectural step is to make a reconciled physical workout the canonical product/read-model concept.

The desired invariant is:

```text
one physical workout
    -> one canonical occurrence
        -> Adaptive describes what was prescribed and performed
        -> Garmin describes measured physiology and device telemetry
```

For structured strength training, Garmin should not become the semantic owner of the workout merely because its activity record is currently the object shown in Activities.

## User-observed symptom

When a strength workout is performed using both:

- an Adaptive Coach structured session; and
- a Garmin watch Strength activity,

with sets, repetitions and rest followed in the structured logger, the Activities detail experience shows the Garmin workout but does not expose the structured execution as the primary workout detail.

This creates several undesirable outcomes:

- planned and performed Adaptive exercises are not visible where the athlete expects them;
- actual reps/load captured by the structured logger are not the primary displayed execution data;
- prescribed rest is separated from the completed activity;
- Garmin exercise recognition can look like the canonical workout even when richer structured execution exists;
- the same physical workout risks being represented twice in downstream history/evidence unless every consumer performs equivalent deduplication;
- the training engine cannot consistently exploit the strongest completed-structured-workout evidence path.

## Finding 1: the structured execution path already captures important performed strength data

The structured-session model is not merely a plan. It persists execution state and per-set entries.

That is important because the correct fix is not to reconstruct structured performance from Garmin. The Adaptive execution already has higher-semantic-value data such as:

- which prescribed exercise was being performed;
- set index/order;
- actual repetition count;
- actual load;
- warm-up/work-set semantics;
- completion timing;
- linkage to the prescription snapshot.

For a structured workout, this should remain authoritative for strength mechanics.

## Finding 2: Garmin strength ingestion is richer than a simple HR activity

The Garmin normalization path already supports strength-set details when Garmin exposes them. The model can include information such as:

- set order/type;
- repetition count;
- weight;
- exercise category/name;
- work duration;
- rest duration.

Therefore, the observed UI behavior does not imply that the backend only understands Garmin strength as heart-rate telemetry.

However, Garmin set recognition should not outrank an Adaptive structured execution. Garmin-recognized exercises and rep counts are useful for:

- Garmin-only workouts;
- diagnostics;
- fallback where structured performed data is genuinely absent;
- reconciliation evidence.

They are not the preferred source when the athlete explicitly executed a structured Adaptive session.

## Finding 3: the Activities experience is provider-centric

The current Activities/detail flow is centered on normalized Garmin activities. That naturally produces a Garmin-first detail page.

The deeper design issue is therefore that the public read model answers:

> "What Garmin activity do we have?"

rather than:

> "What physical workout did the athlete perform, and which sources describe it?"

As long as Activities is provider-centric, every additional execution source will create similar problems.

This is not limited to strength. The same pattern can occur for:

- structured cycling workout + Garmin ride;
- structured running session + Garmin run;
- field session + watch recording;
- imported authored workout + wearable recording;
- duplicate provider imports.

## Finding 4: occurrence reconciliation already exists conceptually

The repository already contains occurrence-reconciliation logic intended to identify when a structured execution and Garmin activity refer to the same physical workout.

This is a strong signal that the intended architecture is already moving toward physical-occurrence identity. The problem is that this reconciliation result is not yet the canonical object consumed by the Activities/read-history path.

The recommended approach is therefore to productionize and integrate the existing concept rather than add a second, UI-specific matcher.

## Finding 5: performed rest has a real data-fidelity gap

Adaptive prescriptions can express target rest, and the structured logger can run a rest timer. But a durable set completion timestamp is not enough to reconstruct actual performed rest.

For example:

```text
set 1 completed 06:52:30
set 2 completed 06:54:55
```

The 145-second difference is not necessarily 145 seconds of rest. It can include:

- rest;
- equipment/setup changes;
- the next work set itself;
- delayed logging/tapping;
- interruption.

Therefore, actual rest must be persisted explicitly if we want to claim that the athlete actually rested for a given duration.

This is a separate issue from activity reconciliation, but it should be addressed in the same architecture because performed rest belongs to the structured execution timeline.

## Finding 6: HR is valuable Garmin enrichment, but not the only useful Garmin contribution

For a matched structured strength workout, Garmin should primarily contribute measured physiology/device context.

High-value fields include:

- HR time series;
- average/max HR;
- HR-zone exposure where available;
- timer and elapsed duration;
- device/sensor provenance;
- Garmin Training Effect;
- Garmin activity training load;
- EPOC/recovery fields if available;
- calories as secondary context.

The system should not use HR or Training Effect as a replacement for known mechanical strength exposure. Average HR in particular is too coarse to reconstruct a strength session's exercise/repetition/load dose.

## Finding 7: source precedence must be explicit

Without an explicit precedence contract, a merge can become lossy or unpredictable.

Recommended precedence for a matched structured workout:

### Adaptive-authoritative

- workout identity/title;
- exercise names/order;
- planned sets/reps/load;
- prescribed rest;
- actual completed sets;
- actual reps;
- actual load;
- warm-up/work-set status;
- skipped or modified sets;
- planned-versus-performed comparison;
- actual rest once durably captured.

### Garmin-authoritative

- measured HR telemetry;
- Garmin device/sensor provenance;
- Garmin timer/elapsed duration when available.

### Garmin-secondary

- Training Effect;
- training load;
- EPOC;
- recovery recommendation;
- calories.

### Garmin-fallback/diagnostic

- exercise recognition;
- Garmin reps;
- Garmin weight;
- Garmin work/rest-set metadata.

This rule prevents a weak machine-detected exercise name from overwriting a known prescribed/performed exercise.

## Finding 8: raw records should not be destructively merged

The fix should not copy Adaptive fields into a Garmin source document or vice versa.

Raw provider/execution records should remain independently reconstructable because they have different provenance and may be reprocessed later.

Instead, introduce a canonical linkage/projection object representing the physical occurrence. That object can materialize the public completed-workout view while retaining source references.

Benefits:

- explicit deduplication semantics;
- stable product identity;
- auditable provenance;
- independent source re-ingestion;
- provider-agnostic Activities UI;
- provider-agnostic training history.

## Finding 9: reconciliation must prefer false negatives over false positives

An incorrect merge is more damaging than a temporary duplicate because it can corrupt:

- training-history attribution;
- progression logic;
- adherence;
- mechanical-dose estimation;
- recommendation evidence.

Therefore:

- deterministic identifiers should beat heuristics;
- high-confidence heuristic matches may auto-link;
- ambiguous matches should remain unmerged;
- manual confirmation/unlink must be sticky;
- two same-day strength sessions must not be merged merely because modality/date match.

## Finding 10: FIT structured-workout linkage can strengthen future matching

Garmin FIT Activity files can contain structured workout definitions and references to executed workout steps. The current implementation can be extended later to exploit this identity/structure as higher-confidence reconciliation evidence.

This is valuable but should not block initial integration of the existing reconciliation layer.

A future matcher can prioritize evidence approximately as follows:

1. explicit exported-workout/correlation identity;
2. FIT structured-workout fingerprint/step linkage;
3. conservative time/modality/duration/structure heuristics;
4. manual confirmation where ambiguous.

## Canonical domain conclusion

The missing product concept is not "merged Garmin strength details". It is a provider-agnostic **training occurrence**.

That occurrence represents one thing the athlete actually did and can have multiple evidence sources.

For structured strength:

```text
WHAT was prescribed     -> Adaptive prescription
WHAT was performed      -> Adaptive SessionExecution / SessionEntry
HOW it compared         -> Adaptive planned-vs-performed logic
HOW physiology responded -> Garmin telemetry
```

This separation is both more accurate and more extensible than attempting to choose one provider record as the whole workout.

## Risks to address during implementation

### Double counting

The same workout must not independently contribute through both a structured execution path and a Garmin activity path.

### Arrival ordering

Either source can arrive first. The occurrence lifecycle must support later enrichment without duplicate public rows.

### Garmin detail absence vs empty data

Do not collapse unavailable/failed strength detail into a semantically successful empty set list. Those states have different diagnostic meaning.

### Manual decisions overwritten by sync

Once a user/admin explicitly separates or confirms a pair, periodic reconciliation must not reverse that decision automatically.

### Historical backfill

Historical reconciliation must be conservative, versioned and restartable.

### Recommendation regressions

Switching completed-training history to canonical occurrences can change dose/evidence semantics. That should be a later, separately tested phase after the read model is stable.

## Investigation required for the concrete reported workout

Before considering the implementation complete, inspect at least one affected workout and answer:

1. Does the expected `SessionExecution` exist?
2. Are all expected `SessionEntry` records present?
3. Does the overlapping Garmin activity exist?
4. Is Garmin `exerciseSets`:
   - unavailable,
   - missing,
   - empty,
   - or populated?
5. Did Garmin detail ingestion log an error or successful empty result?
6. What candidate(s) does the current occurrence reconciler identify?
7. Why is the reconciliation result not currently visible through the Activities read path?

This distinguishes the architectural read-model problem from any additional Garmin strength-detail ingestion defect.

## Recommended decision

Proceed with the canonical training-occurrence architecture documented in the companion implementation plan.

Do not solve the symptom by merely adding Garmin set fields to the current Activity Details component. That would improve one display but preserve the underlying provider-centric model and leave structured execution, deduplication, history and evidence semantics unresolved.
