# Issue #897 — Physical-capital assessment history implementation plan

**Date:** 2026-09-30
**Status:** Draft
**Blocked by:** acceptance of proposed [ADR-0046](../adr/0046-first-class-raw-assessment-trial-evidence.md) for raw-trial identity/correction/provenance; work remains evidence-only under the existing OV authority boundary
**Unlocks:** first-class multidomain physical-capital assessment capture, comparable history and normalized/diagnostic export without recommendation authority
**Canonical status owner:** [Performance outcome validation (OV)](./performance-outcome-validation.md); this document is a scoped #897 implementation design, not a parallel OV status board
**Companion analysis:** [2026-09-30-issue-897-physical-capital-assessment-integration.md](../analysis/2026-09-30-issue-897-physical-capital-assessment-integration.md)
**Primary issue:** #897
**Repository baseline:** `main@826d9aba845a8f3e4acaa94a173ece41b1906ef1`

---

## Objective

Make the existing Protocol testing workflow capable of storing, comparing, reviewing and exporting the planned October 2026 physical-capital baseline and later repeat checkpoints.

The implementation must extend the existing Performance Outcome Validation architecture rather than create a parallel subsystem. Actionable status remains in the canonical OV plan; if ADR-0046 is accepted, implementation work is tracked there/#897 rather than creating an independent competing task board.

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
- invalidation rules;
- bounded raw-trial field schema when the protocol is multi-trial;
- reducer declarations/version when canonical summaries are derived from trials.

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

The semantic capture schema and reducer declarations must be owned by the immutable `MeasurementProtocol` revision (or an equally immutable companion referenced by it). Additive optional fields preserve old summary-only protocols. `PerformanceTestDefinition` may add presentation/layout hints, but it must not be the sole owner of field identity/type/unit or reducer semantics; otherwise a catalog update could reinterpret historical trials.

## WP0.3 Preserve old sprint protocol

Pin regression tests showing that:

- protocol id `cycling-5s-peak-power`, revision `1`, remains unchanged;
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

Recommended canonical first set:

```text
standing_broad_jump_distance_cm
wall_touch_cmj_height_cm
seated_medball_throw_distance_m
cycling_sprint_1s_peak_power_w
cycling_sprint_5s_mean_power_w
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

Do **not** register every useful raw field as a canonical outcome metric in the first slice. Peak cadence, start cadence, left/right balance, success/miss, RPE and WL Analysis mean/peak velocity belong to the bounded raw-trial capture schema initially. Left/right balance is descriptive context only, not a corrective target.

For bar velocity, `mean concentric velocity` remains the preferred future longitudinal anchor, but fixed-load comparability must first identify the exercise, exact absolute load and material WL Analysis/camera setup. Peak velocity remains secondary.

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
type AssessmentTrialScalar = string | number | boolean;

export interface AssessmentTrialValue {
    fieldId: string;
    value: AssessmentTrialScalar;
    unit?: string;
}

export interface AssessmentTrial {
    id: string;
    assessmentAttemptId: string;
    ordinal: number;
    performedAt?: string;
    validity: ObservationValidity;
    invalidReason?: string;
    context: ObservationContext;
    values: readonly AssessmentTrialValue[];
    sourceRef?: string;
    device?: MetricObservationDevice;
    notes?: string;
    supersedesTrialId?: string;
    correctionReason?: string;
    createdAt: string;
}
```

Raw `fieldId` values are declared and validated by the bundled test's bounded capture schema. Reducers map those fields to canonical metric IDs; raw fields do not become `MetricDefinition` entries automatically.

The exact field names may change during implementation, but preserve these invariants:

- immutable trial identity;
- parent attempt identity;
- stable ordinal;
- explicit validity;
- typed, bounded and unit-aware raw fields;
- scalar context only;
- source/device provenance;
- append-only supersession for corrections;
- no recommendation authority.

## WP2.2 Persistence

Recommended Firestore shape:

```text
users/{userId}/assessment_attempts/{attemptId}/trials/{trialId}
```

A trial record is immutable after creation. Correction support is required for the first athlete-usable slice: create a new immutable trial that names `supersedesTrialId` and a non-empty correction reason. Reducers use the latest unsuperseded record for each ordinal. Correcting only the canonical observation while leaving incorrect source trials in place is not acceptable provenance.

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
- field not declared by the protocol capture schema;
- wrong field type/unit;
- invalid attempt identity;
- invalid state/reason combinations;
- non-finite values;
- duplicate field IDs within one trial unless the capture schema explicitly allows them;
- broken supersession chains or missing correction reasons.

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

- introduce additive typed derivation evidence references that can point to assessment-trial records;
- preserve existing observation-to-observation provenance for historical derived observations;
- store `algorithmVersion`, e.g. `assessment-reducer-v1`.

Do not put trial IDs into `derivedFromObservationIds`; that field promises observation identities.

Do not weaken validation just to fit the new source.

## WP3.3 Manual fallback

A manually entered canonical result can remain supported for advanced/custom protocols, but bundled physical-capital protocols should default to trial-driven summary derivation.

## WP3.4 Source-specific body-mass-relative context

For sprint W/kg and body-mass-relative squat/bench context, reuse ADR-0039 rather than creating a Testing-owned weight field.

- select an acceptable same-day body-mass point from one explicit source series;
- retain its source/reference alongside the derived relative value;
- never average or silently switch between provider/manual body-mass series;
- keep the derived relative value context-only in the first slice;
- if no acceptable same-day point exists, leave the relative value unavailable.

Do not require duplicate manual weight entry merely to complete an assessment.

---

# WP4 — Add bundled physical-capital protocols

## WP4.0 Shared safety and invalidation boundary

The reusable bundled protocols must encode test-specific execution safety without inventing medical clearance:

- maximal bench/squat instructions require rack safeties and/or a competent spotter as appropriate;
- assisted bar contact, invalid depth/technique or other protocol-defined technical failures remain raw invalid/missed evidence and never become the canonical 1RM;
- protocol invalidation remains fail-closed for the explicit rules attached to that immutable revision;
- an active clinician restriction or other safety constraint reaches Testing through the repository's existing validated constraint/session-execution pathway, not through a new diagnosis/clearance field in assessment evidence;
- the athlete-specific 13 October 2026 cardiology/CPET checkpoint is execution context for this baseline, not a date hard-coded into a generic protocol.

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

Protocol reference:

`{ id: 'strength-bench-press-1rm', revision: 1 }`

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

Protocol reference:

`{ id: 'strength-back-squat-1rm', revision: 1 }`

Same design principles as bench.

## WP4.3 Standing broad jump

Definition ID: `field-standing-broad-jump-r1`

Protocol reference: `{ id: 'field-standing-broad-jump', revision: 1 }`

Three maximal valid attempts after warm-up/familiarization.

Canonical = best valid distance.

## WP4.4 Wall-touch CMJ

Definition ID: `field-wall-touch-cmj-r1`

Protocol reference: `{ id: 'field-wall-touch-cmj', revision: 1 }`

Capture:

- standing reach context/measurement;
- three maximal jumps;
- calculated jump height.

If standing reach is treated as trial context rather than a canonical performance metric, document that choice.

## WP4.5 3 kg seated medicine-ball throw

Definition ID: `field-seated-medball-chest-throw-3kg-r1`

Protocol reference: `{ id: 'field-seated-medball-chest-throw-3kg', revision: 1 }`

Three maximal valid attempts.

Canonical = best valid distance.

## WP4.6 6 s seated cycling sprint

Definition ID: `cycling_6s_seated_sprint-r1`

Protocol reference: `{ id: 'cycling-6s-seated-sprint', revision: 1 }`

Three maximal 6 s seated efforts with long easy recovery.

Trial fields:

- 1 s peak power;
- 5 s mean power;
- optional start/peak cadence;
- optional left/right power balance when reported by the power source, descriptive only.

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

Extend the immutable protocol revision with a small optional semantic trial-capture contract. `PerformanceTestDefinition` may carry presentation metadata that decorates those stable field IDs, but must not redefine their semantics.

Do not infer UI solely from metric names.

Candidate semantic contract:

```ts
interface AssessmentCaptureDefinition {
  mode: 'single_summary' | 'trials';
  trialCount?: number;
  trialFields?: readonly AssessmentTrialFieldDefinition[];
  reducers?: readonly AssessmentReducer[];
  reducerVersion?: string;
}
```

Persist/version this with the protocol revision (or an immutable protocol-referenced companion). Keep the shape bounded and declarative. Old protocols without this field retain the existing summary-input workflow.

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

| Trial | 1 s peak W | 5 s mean W | peak cadence | L/R balance | validity |
|---|---:|---:|---:|---|---|

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

## WP5.7 One physical workout, one completed-training exposure

The assessment attempt/trial/observation records are evidence sidecars to the `SessionRunner` execution. They must not create another completed workout. Verify the current performed-training reconciliation path rather than assuming proposed ADR-0034 semantics are automatically active everywhere.

Required invariant:

`one physical testing session -> at most one completed-training/history exposure`

This must hold when the structured testing execution and a provider activity both exist.

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

## WP6.6 Fixed-load velocity acceptance boundary

Initial October capture may keep WL Analysis velocities as raw trial evidence, but #897 must not be considered fully complete while its fixed-load longitudinal requirement has no comparable-series representation.

Before closing #897, choose and implement one reviewed path:

- a dedicated fixed-load velocity assessment protocol/identity that can emit canonical observations without violating the one-observation-per-metric-per-attempt contract; or
- an explicit architecture extension for multi-instance metric observations, with backward-compatible identity/rules/progress semantics.

Do not solve this by encoding load into metric IDs or by adding a second informal trend algorithm over arbitrary raw rows.

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

Do not assume all canonical assessment observations already satisfy typed goals.

Current ADR-0041 behavior differs by subject kind:

- `performance_test` targets can resolve current measured `MetricObservationRevision` evidence through the bound performance-test protocol;
- `exercise` strength targets currently resolve current capability from `AthletePerformanceProfile.estimated1RmKg`, not from measured assessment observations.

Therefore squat/bench 1RM evidence needs an explicit bridge if it is to satisfy an exercise-subject goal. The implementation must either add a reviewed mapping from the bundled strength test to the canonical exercise identity and extend goal-progress resolution while keeping measured 1RM distinct from e1RM, or leave measured squat/bench assessment evidence outside typed-goal progress in the first slice.

Protocol reference alone does not solve exercise subject identity. New jump/throw/sprint metrics should become goal-eligible only when a real typed-goal use case is declared; assessment metrics do not automatically become goal metrics.

The first athlete-usable baseline slice may ship before the strength-goal bridge, but #897's typed-goal acceptance criterion remains open until a reviewed mapping/resolver path is implemented or the issue scope is explicitly amended. Do not silently mark the requirement complete.

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
- comparison dimensions are pinned;
- multi-trial field schema and reducer semantics are pinned to the immutable protocol revision;
- old summary-only protocol revisions remain valid without a trial-capture schema;
- changing a trial field/reducer contract requires a new immutable protocol revision rather than reinterpreting history.

### Trial validation

- invalid ordinals;
- undeclared fields;
- invalid field types/units;
- invalid validity reason;
- duplicate fields;
- malformed context;
- append-only correction/supersession chain;
- reducer ignores superseded source trials.

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

- create/list/correct raw trials without mutating historical records;
- no cross-user access;
- canonical observation references current source trials through typed evidence refs;
- assessment completion is not accepted as valid benchmark if required canonical derivation fails;
- one testing execution contributes at most one completed-training exposure even when provider activity evidence is also present.

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

Do not rewrite protocol id `cycling-5s-peak-power`, revision `1`.

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

- [ ] proposed ADR-0046 has been accepted and the canonical OV status board reflects the startable #897 work;
- [ ] all six intended protocols are visible in Testing;
- [ ] protocol text matches the agreed October execution standards;
- [ ] familiarization can be recorded separately from baseline;
- [ ] trial capture works on mobile;
- [ ] squat/bench raw load attempts can store WL Analysis velocity without prematurely promoting it to a generic canonical series;
- [ ] raw-trial correction is append-only and canonical reducers use unsuperseded trials;
- [ ] sprint cadence and L/R balance can be retained as descriptive raw/context evidence without becoming corrective targets;
- [ ] any W/kg/body-mass-relative output retains the selected source-specific same-day body-mass reference or remains unavailable;
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
2. Whether history UI also shows a rolling body-mass summary in addition to the required explicit same-day source/reference used for any derived relative value.
3. Whether raw video references deserve a generic attachment/provenance contract.
4. Whether personal repeatability/reliability estimates should be calculated automatically after enough repeated trials.
5. Whether quarterly/semiannual bundles should be scheduled automatically.
6. Whether CPET/lactate import belongs in the same Testing UI or a later laboratory-import adapter.

None of these should delay correct storage of the October baseline.
