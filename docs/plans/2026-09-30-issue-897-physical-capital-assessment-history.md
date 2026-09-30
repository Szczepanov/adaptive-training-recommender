# Issue #897 — Physical-capital assessment history implementation plan

**Date:** 2026-09-30  
**Status:** implementation plan  
**Companion analysis:** [2026-09-30-issue-897-physical-capital-assessment-integration.md](../analysis/2026-09-30-issue-897-physical-capital-assessment-integration.md)  
**Primary issue:** #897  
**Repository baseline:** `main@826d9aba845a8f3e4acaa94a173ece41b1906ef1`

---

## Objective

Make the existing Protocol testing workflow capable of storing, comparing, reviewing and exporting the planned October 2026 physical-capital baseline and later repeat checkpoints.

The implementation must extend the existing Performance Outcome Validation architecture rather than create a parallel subsystem.

The first complete user journey is:

> choose a standardized physical-capital test → execute it through the existing session runner → capture all protocol trials → persist a canonical benchmark → repeat the same protocol later → see whether the new result is comparable and how it changed → export the evidence.

---

## Success criteria

The slice is complete when all of the following are true:

- [ ] Bench 1RM can be run as a bundled standardized assessment.
- [ ] Back-squat 1RM can be run as a bundled standardized assessment.
- [ ] Standing broad jump can be run and all trials are retained.
- [ ] Wall-touch CMJ can be run and all trials are retained.
- [ ] 3 kg seated medicine-ball throw can be run and all trials are retained.
- [ ] 3 × 6 s seated cycling sprint can store all three trials plus canonical 1 s peak and 5 s mean power.
- [ ] Strength attempts can store load-by-load WL Analysis velocity evidence without making app-derived e1RM authoritative.
- [ ] Historical protocol revisions remain immutable.
- [ ] Repeating a compatible protocol produces an explicit longitudinal comparison.
- [ ] Incompatible protocol/setup changes produce `non_comparable` or a separate series rather than a false numerical trend.
- [ ] Assessment history shows baseline/latest/change/comparability.
- [ ] Normalized CSV export works.
- [ ] Diagnostic JSON export retains protocol, trials, canonical observations and provenance.
- [ ] Existing cycling tests continue to work without data migration.
- [ ] No assessment is double-counted as two physical sessions.
- [ ] No recommendation-selection authority is added.

---

# Work package overview

| WP | Scope | Outcome |
|---|---|---|
| WP0 | Contract decisions + fixtures | lock exact October protocols and persistence semantics |
| WP1 | Metric + comparison vocabulary | multidomain physical-capital metrics become valid observations |
| WP2 | Raw trial evidence model | repeated attempts and load/velocity rows are first-class |
| WP3 | Canonical summary derivation | best valid / highest valid result becomes benchmark with provenance |
| WP4 | Bundled test catalog | six October assessment protocols available from Testing |
| WP5 | Capture UX | efficient test-specific trial/result capture |
| WP6 | Assessment history + progress | baseline/latest/comparability becomes visible |
| WP7 | Export | CSV + diagnostic JSON |
| WP8 | Context/goal integration | bounded consumption by existing OV/goal surfaces |
| WP9 | Verification + docs | backward compatibility, emulator/E2E, architecture docs |

WP0–WP7 form the minimum value-bearing delivery. WP8 may be split into a follow-up PR if it expands scope materially.

---

# WP0 — Lock contracts before implementation

## WP0.1 Add protocol fixtures to tests first

Create test fixtures that represent the intended October protocols before adding UI.

Suggested file:

`app/src/observations/__fixtures__/physicalCapitalProtocols.ts`

Fixtures:

- bench 1RM;
- back-squat 1RM;
- standing broad jump;
- wall-touch CMJ;
- 3 kg seated medicine-ball chest throw;
- 6 s seated cycling sprint.

The fixtures must pin:

- protocol ID;
- revision;
- instructions;
- metric IDs;
- required comparison dimensions;
- familiarization rule;
- expected recovery;
- invalidation rules.

## WP0.2 Decide canonical reducers explicitly

Add a small pure contract for how trial evidence becomes the canonical result.

Suggested concepts:

```ts
type AssessmentReducer =
  | { kind: 'max_valid'; metricId: string }
  | { kind: 'highest_successful_load'; metricId: string }
  | { kind: 'identity'; metricId: string };
```

Do not make this generic enough to become an analytics DSL. It exists only to make bundled protocol summary semantics explicit and testable.

## WP0.3 Preserve old sprint protocol

Pin regression tests showing that:

- `cycling-5s-peak-power@1` remains unchanged;
- the new 6 s seated sprint is a different protocol;
- persisted old revisions still deserialize.

No rewrite/migration is required.

---

# WP1 — Expand metric and comparison vocabulary

## Files likely affected

- `app/src/observations/registry.ts`
- `app/src/observations/models.ts`
- `app/src/observations/protocols.ts`
- associated tests

## WP1.1 Add canonical metrics

Recommended first set:

```text
standing_broad_jump_distance_cm
wall_touch_cmj_height_cm
seated_medball_throw_distance_m
cycling_sprint_1s_peak_power_w
cycling_sprint_5s_mean_power_w
cycling_sprint_peak_cadence_rpm
bar_mean_concentric_velocity_mps
bar_peak_concentric_velocity_mps
```

Keep existing:

`strength_1rm_kg`

Recommended directions:

| Metric | Direction |
|---|---|
| standing broad jump | higher_is_better |
| wall-touch CMJ | higher_is_better |
| medicine-ball throw | higher_is_better |
| cycling 1 s peak | higher_is_better |
| cycling 5 s mean | higher_is_better |
| peak cadence | context_only |
| bar mean velocity | higher_is_better |
| bar peak velocity | context_only or higher_is_better; decide from intended use |

For bar velocity, `mean concentric velocity` is the preferred longitudinal anchor. Peak velocity should remain secondary unless a later use case proves otherwise.

## WP1.2 Add only required comparison dimensions

Initial additions:

```ts
| 'measurement_method_id'
| 'equipment_setup_id'
```

Examples:

- wall-touch CMJ measurement method;
- WL Analysis camera/setup identity;
- medicine-ball/test station identity if materially relevant.

Do not add exercise identity as a generic dimension where protocol identity already supplies it.

Do not add ball mass for the initial 3 kg throw protocol; the fixed mass is part of the protocol.

## WP1.3 Tests

Cover:

- dimension validation;
- identifier canonicalization;
- series changes when method/setup changes;
- no series split for context-only dimensions;
- all new metrics enforce units.

---

# WP2 — Add first-class raw assessment trials

## Rationale

The existing `MetricObservationRevision` remains the benchmark layer. It should not be stretched to store every raw trial.

## WP2.1 Domain model

Add a bounded raw evidence contract.

Suggested location:

`app/src/observations/assessmentTrials.ts`

Illustrative shape:

```ts
export interface AssessmentTrialMeasurement {
    metricId: string;
    value: number;
    unit: string;
}

export interface AssessmentTrial {
    id: string;
    assessmentAttemptId: string;
    ordinal: number;
    performedAt?: string;
    validity: ObservationValidity;
    invalidReason?: string;
    context: ObservationContext;
    measurements: readonly AssessmentTrialMeasurement[];
    sourceRef?: string;
    device?: MetricObservationDevice;
    notes?: string;
    createdAt: string;
}
```

The exact field names may change during implementation, but preserve these invariants:

- immutable trial identity;
- parent attempt identity;
- stable ordinal;
- explicit validity;
- numeric unit-aware measurements;
- scalar context only;
- source/device provenance;
- no recommendation authority.

## WP2.2 Persistence

Recommended Firestore shape:

```text
users/{userId}/assessment_attempts/{attemptId}/trials/{trialId}
```

A trial is immutable after creation in the first slice.

If correction support is required, prefer append-only revision semantics rather than in-place mutation; however, correction can be deferred if the canonical observation correction path is sufficient for the first release.

## WP2.3 Service

Add:

`app/src/services/assessmentTrialService.ts`

Required methods:

- `createTrial`;
- `listTrialsForAttempt`;
- optionally `getTrial`.

Do not add global unbounded scans.

## WP2.4 Validation

Fail closed on:

- duplicate trial IDs;
- ordinal < 1;
- unsupported metric;
- wrong unit;
- invalid attempt identity;
- invalid state/reason combinations;
- non-finite values;
- duplicate measurement metric IDs within one trial unless a real protocol needs duplicates.

## WP2.5 Security rules + emulator tests

Add Firestore rules equivalent to other athlete-owned assessment evidence.

Emulator tests must prove:

- user A cannot read/write user B trials;
- invalid schema is rejected;
- historical trial cannot be silently rewritten if immutability is enforced at rules/service level.

---

# WP3 — Derive canonical benchmark observations from trials

## WP3.1 Pure reducer functions

Suggested file:

`app/src/observations/assessmentReducers.ts`

Functions should accept:

- protocol definition/reducer;
- validated trials;

and return:

- canonical metric value;
- source trial IDs;
- reducer version.

Examples:

### Broad jump / CMJ / medicine-ball

`max(valid trials)`

### Cycling sprint

Separate reducers:

- max valid 1 s peak power;
- max valid 5 s mean power.

The two canonical metrics may come from different trials. Preserve source trial identity per metric.

### 1RM

`highest technically valid successful load`

A failed heavier attempt remains useful trial evidence but does not become the canonical result.

## WP3.2 Derivation provenance

The canonical `MetricObservationRevision` should state that it was derived from trial evidence rather than typed as a free-standing manual summary.

Preferred approach:

- extend derived-observation provenance to accept assessment trial IDs;
- store `algorithmVersion`, e.g. `assessment-reducer-v1`.

If widening `derivedFromObservationIds` is semantically misleading, introduce a more general evidence-reference type rather than putting trial IDs into a field that promises observation IDs.

Do not weaken validation just to fit the new source.

## WP3.3 Manual fallback

A manually entered canonical result can remain supported for advanced/custom protocols, but bundled physical-capital protocols should default to trial-driven summary derivation.

---

# WP4 — Add bundled physical-capital protocols

## Primary file

`app/src/observations/performanceTestingCatalog.ts`

If the file becomes too large, split by family:

```text
performanceTestingCatalog/
  cycling.ts
  field.ts
  strength.ts
  index.ts
```

Do not require a split if the code remains readable.

## WP4.1 Bench 1RM

ID:

`strength-bench-press-1rm-r1`

Protocol:

`strength-bench-press-1rm@1`

Metric:

`strength_1rm_kg`

Session blocks:

- warm-up;
- progressive test attempts;
- optional cool-down.

The runner must not prescribe fixed maximum attempt weights. Attempt selection remains athlete-controlled.

## WP4.2 Back-squat 1RM

ID:

`strength-back-squat-1rm-r1`

Same design principles as bench.

## WP4.3 Standing broad jump

Three maximal valid attempts after warm-up/familiarization.

Canonical = best valid distance.

## WP4.4 Wall-touch CMJ

Capture:

- standing reach context/measurement;
- three maximal jumps;
- calculated jump height.

If standing reach is treated as trial context rather than a canonical performance metric, document that choice.

## WP4.5 3 kg seated medicine-ball throw

Three maximal valid attempts.

Canonical = best valid distance.

## WP4.6 6 s seated cycling sprint

Three maximal 6 s seated efforts with long easy recovery.

Trial measurements:

- 1 s peak power;
- 5 s mean power;
- optional peak cadence.

Canonical metrics:

- best 1 s peak;
- best 5 s mean.

## WP4.7 Catalog UX copy

Change:

`Bundled cycling assessments`

to something like:

`Bundled assessments`

and group by:

- Cycling;
- Strength;
- Field / power.

Do not rely on ID naming alone for grouping; add explicit catalog metadata if needed.

---

# WP5 — Capture UX

## Current problem

The existing capture stage renders one input per canonical metric after the session. That is insufficient for multi-trial protocols.

## WP5.1 Protocol-driven trial capture

Extend `PerformanceTestDefinition` with a small capture schema or test-family metadata.

Do not infer UI solely from metric names.

Candidate:

```ts
interface AssessmentCaptureDefinition {
  mode: 'single_summary' | 'trials';
  trialCount?: number;
  trialFields?: readonly AssessmentTrialFieldDefinition[];
  reducers?: readonly AssessmentReducer[];
}
```

Keep the shape bounded and declarative.

## WP5.2 Strength trial row

For squat/bench, each row should support:

- load kg;
- result: success / miss;
- optional RPE;
- optional mean concentric velocity;
- optional peak velocity;
- trial validity;
- technical note.

Allow adding attempts dynamically.

The final canonical 1RM is computed, not separately typed.

## WP5.3 Jump/throw capture

Simple table:

| Trial | Result | Validity |
|---|---:|---|

Display computed best valid result before save.

## WP5.4 Cycling sprint capture

Table:

| Trial | 1 s peak W | 5 s mean W | peak cadence | validity |
|---|---:|---:|---:|---|

Display both canonical results before save.

## WP5.5 Device provenance

Allow a default device for the attempt plus optional trial override.

Examples:

- power meter;
- WL Analysis;
- measurement method.

Do not require duplicate device typing on every trial when unchanged.

## WP5.6 Mobile usability

Testing will often occur in a gym/field setting on a phone.

Requirements:

- numeric keyboard;
- large touch targets;
- minimal horizontal scrolling;
- retain entered trials through temporary stage changes;
- clear invalid/practice controls;
- no requirement to type protocol IDs in the normal bundled flow.

---

# WP6 — Assessment history and progress

## WP6.1 Read model

Add an athlete-scoped assessment history service/read model that joins:

- completed attempts;
- protocol;
- current canonical observation revisions;
- progress result;
- optional trial count/provenance summary.

Avoid N+1 unbounded scans. The initial implementation may fetch a bounded date window or metric family.

## WP6.2 UI location

Preferred first location:

- Testing surface gains a `History` section/tab;

or:

- Detailed Data gains an `Assessments` tab.

Do not create both in the first slice.

The screen should show:

- test;
- purpose;
- date;
- result;
- baseline;
- latest;
- absolute/% change;
- progress status;
- comparability;
- validity.

## WP6.3 Attempt detail

Expand to show:

- exact protocol ID/revision;
- comparison context;
- raw trials;
- device/source;
- notes;
- correction history;
- reducer/source trials.

## WP6.4 Comparability

Use `deriveProgress()` for canonical metrics.

Do not invent another progress engine.

If the same display test was performed under an incompatible protocol revision or comparison series, show:

`not comparable`

not:

`0% change`.

## WP6.5 Baseline semantics

For the October battery, `purpose=baseline` is the natural initial reference.

Do not hard-code “first observation forever” as baseline. Existing declared/window baseline semantics should remain available for goals/block reviews.

The history UI may default to earliest valid baseline-purpose observation for convenience, but that is a presentation choice, not a mutation of outcome contracts.

---

# WP7 — Export

## WP7.1 Normalized CSV

Add:

`app/src/utils/assessmentExport.ts`

Export current canonical observations with protocol/progress metadata.

Required columns:

```text
observed_at
local_date
attempt_id
purpose
protocol_id
protocol_revision
metric_id
display_name
value
unit
validity
comparison_series_key
baseline_value
absolute_change
percent_change
progress_status
device_provider
device_model
```

Do not include raw trials as repeated comma-joined text inside this summary CSV.

## WP7.2 Diagnostic JSON

Include:

```text
schemaVersion
exportedAt
athlete/user identifier policy according to existing export conventions
protocols
attempts
trials
canonicalObservations
progress
resolvedContext
```

The JSON must be sufficient to reconstruct:

- what was tested;
- how;
- what raw trials occurred;
- which trial(s) produced the canonical result;
- whether a later result is comparable.

## WP7.3 Optional wide CSV

Defer unless trivial after normalized export lands.

If added, label it explicitly as a convenience pivot, not the canonical export.

---

# WP8 — Bounded integration with goals / block outcomes / context brief

This work should reuse existing OV and PG contracts.

## WP8.1 Typed performance goals

Existing goal infrastructure can already reference canonical assessment metrics.

Verify:

- bench and squat can disambiguate by protocolRef despite sharing `strength_1rm_kg`;
- new jump/throw/sprint metrics pass target validation when appropriate.

Do not make target values alter assessment protocols.

## WP8.2 Block review

A later block outcome can consume:

- canonical result;
- comparable change;
- status.

It may state:

- improved;
- stable/within noise;
- declined;
- insufficient evidence;
- non-comparable.

It must not claim causality.

## WP8.3 Planning Context Brief

Follow #897’s bounded export intent.

For relevant active goals/block intent, include compact evidence such as:

```text
Performance evidence
- Back squat 1RM: 150 kg baseline, no comparable repeat yet.
- Standing broad jump: 238 cm baseline, 231 cm latest (-2.9%); same protocol.
- Cycling 5 s mean sprint power: 1,210 W baseline, 1,265 W latest (+4.5%); same protocol.
```

Do not dump all trials into ordinary planning context.

Diagnostic export owns the detailed evidence.

---

# WP9 — Verification and hardening

## Unit tests

### Protocol/registry

- all six bundled protocols validate;
- immutable ID/revision collisions fail closed;
- expected units are pinned;
- comparison dimensions are pinned.

### Trial validation

- invalid ordinals;
- invalid units;
- unknown metrics;
- invalid validity reason;
- duplicate measurements;
- malformed context.

### Reducers

- best valid jump;
- invalid best jump ignored;
- practice trial excluded from baseline summary;
- highest valid successful 1RM;
- failed heavier attempt retained but excluded;
- sprint 1 s and 5 s summaries may derive from different trials;
- no valid trial => no valid canonical benchmark.

### Progress

- same protocol/context repeat comparable;
- setup/method change creates different series;
- different protocol revision is non-comparable unless an explicit compatibility rule exists;
- baseline/checkpoint repeat yields expected raw delta;
- absence of reliability remains `insufficient_evidence`/possible rather than false precision.

## Service tests

- create/list raw trials;
- no cross-user access;
- canonical observation references source trials;
- assessment completion is not accepted as valid benchmark if required canonical derivation fails.

## Emulator tests

- Firestore ownership;
- immutable protocol;
- trial write rules;
- observation/trial relationship;
- abandoned attempt cannot be promoted silently.

## Component tests

- bundled category rendering;
- strength dynamic attempts;
- jump/throw trial table;
- cycling three-trial capture;
- computed canonical result;
- invalid/questionable flows;
- history comparability state;
- export actions.

## Browser E2E

At least one representative full flow:

1. open Testing;
2. choose standing broad jump;
3. start;
4. complete session;
5. enter three trials;
6. save;
7. reopen later checkpoint;
8. record repeat;
9. verify history/progress;
10. export.

Second E2E if budget allows:

- strength 1RM with WL Analysis velocity values.

---

# Migration and backward compatibility

## No mandatory data migration

Existing:

- protocols;
- assessment attempts;
- metric observations;

remain valid.

Raw trials are additive.

Existing attempts simply have no raw trial records.

History must render those as:

`summary-only historical assessment`

rather than malformed/missing.

## Existing bundled sprint

Do not rewrite `cycling-5s-peak-power@1`.

If product copy is misleading, deprecate it in catalog metadata or add a later revision/new protocol. Historical results remain tied to the old semantics.

## Observation keys

Do not change the existing canonical `observationKeyFor(attemptId, metricId)` in this project unless implementation proves it is unavoidable.

Raw multi-attempt detail belongs under the new trial model, not by breaking every existing observation key.

---

# PR sequencing

A single implementation PR may be too broad. Recommended sequence:

## PR A — domain foundation

- WP0
- WP1
- WP2
- WP3
- unit + emulator tests
- no user-visible history yet

## PR B — bundled October protocols + capture UX

- WP4
- WP5
- component tests
- one E2E

This is the first athlete-usable slice.

## PR C — history + export

- WP6
- WP7
- comparison presentation
- CSV/JSON tests

This closes the user’s “store, export and track” requirement.

## PR D — bounded feedback-loop integration

- WP8
- block outcome/context brief/goals only where existing contracts need wiring

Do not merge PR D into the earlier slices merely to make the feature appear more “intelligent”.

---

# Delivery order relative to the October baseline

The October test week is 19–25 October 2026.

If implementation capacity is constrained, prioritize:

1. protocol + metric correctness;
2. raw trial persistence;
3. capture;
4. export;
5. history visualization;
6. broader planner integration.

The minimum acceptable real-world fallback is:

> the October tests can be captured with immutable protocol identity, complete raw trials and canonical summary values, and exported later.

A polished dashboard is less important than preserving correct evidence at first capture.

---

# Definition of done for the October battery

Before the real baseline begins:

- [ ] all six intended protocols are visible in Testing;
- [ ] protocol text matches the agreed October execution standards;
- [ ] familiarization can be recorded separately from baseline;
- [ ] trial capture works on mobile;
- [ ] squat/bench raw load attempts can store WL Analysis velocity;
- [ ] a failed 1RM attempt does not replace the best successful load;
- [ ] broad jump/CMJ/throw keep all valid attempts;
- [ ] cycling stores three 6 s trials and both canonical power metrics;
- [ ] canonical results can be exported immediately;
- [ ] protocol and device/setup provenance are visible;
- [ ] all existing Testing flows still pass;
- [ ] no code path gives assessment evidence recommendation-selection authority.

---

# Follow-up questions intentionally deferred to implementation review

These do not block the first plan:

1. Whether peak bar velocity should be a canonical context metric or raw-trial-only field.
2. Whether same-day body mass is joined at export time or snapshotted as a derived-context reference at assessment completion.
3. Whether raw video references deserve a generic attachment/provenance contract.
4. Whether personal repeatability/reliability estimates should be calculated automatically after enough repeated trials.
5. Whether quarterly/semiannual bundles should be scheduled automatically.
6. Whether CPET/lactate import belongs in the same Testing UI or a later laboratory-import adapter.

None of these should delay correct storage of the October baseline.
