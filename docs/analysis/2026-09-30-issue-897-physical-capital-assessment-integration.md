# Issue #897 — Physical-capital assessment integration analysis

**Date:** 2026-09-30
**Status:** point-in-time analysis
**Repository baseline reviewed:** `main@826d9aba845a8f3e4acaa94a173ece41b1906ef1`
**Primary issue:** #897 — periodic performance assessments as first-class canonical evidence
**Scope:** determine how the existing protocol-testing / outcome-evidence architecture should represent the planned October 2026 physical-capital baseline and later longitudinal checkpoints without introducing a parallel measurement subsystem.

---

## Executive conclusion

The October physical-capital battery should be implemented **inside the existing Performance Outcome Validation (OV) assessment architecture**.

The repository already has the hard parts needed for this use case:

- immutable `MeasurementProtocol` revisions;
- `AssessmentAttempt` lifecycle and purpose semantics;
- protocol-locked comparison context;
- canonical metric observations with revision history;
- validity states;
- device/source provenance;
- progress derivation with comparability and measurement-error support;
- testing execution through the normal `SessionRunner`;
- progress infrastructure that consumes canonical assessment observations;
- performance-test goal progress that can consume canonical observations, while exercise-subject strength goals still resolve current capability from the strength/e1RM profile and need an explicit measured-assessment bridge.

The missing work is not a new “physical capital” domain. It is a **multidomain expansion of the existing assessment model** plus a bounded longitudinal history/export surface.

The first concrete user battery is:

1. bench-press 1RM;
2. back-squat 1RM;
3. standing broad jump;
4. wall-touch countermovement jump;
5. 3 kg seated medicine-ball chest throw;
6. standardized 3 × 6 s seated cycling sprint;
7. supplementary squat/bench fixed-load bar-velocity anchors captured with WL Analysis.

This is exactly the type of repeated standardized testing that OV exists to own.

### Architecture-governance boundary

The current OV architecture deliberately owns repeated standardized testing, but the proposed raw-trial persistence/correction layer and typed derivation provenance are new architectural contracts. They should not be activated merely because this analysis proposes them. A dedicated proposed ADR (`ADR-0046`) records those decisions; implementation remains blocked until that ADR is accepted. `docs/plans/performance-outcome-validation.md` remains the sole canonical OV status board, so the scoped #897 plan is an implementation design, not a competing task authority.

The main architectural gap is that the current canonical observation model is optimized for **one summary value per metric per assessment attempt**, while several real tests contain **multiple raw trials** and the strength tests contain **multiple load/velocity points**. The implementation should preserve the current canonical summary model and add a separate raw-trial evidence layer rather than encoding attempts as metric names or flattening raw trials into free-text notes.

---

## 1. Why this belongs under OV / #897

The current repository status already establishes OV as the sole implementation/status owner for repeated testing and progress evidence. The older M7 repeated-testing trigger has fired and ownership transferred to OV.

Issue #897 independently describes the same required architecture:

- protocol identity and immutable protocol history;
- assessment lifecycle;
- raw observations and derived summaries;
- explicit comparability;
- source/equipment provenance;
- block/goal integration;
- planning and diagnostic export;
- separation of assessment evidence from ordinary training occurrence;
- no silent promotion of invalid/abandoned tests;
- no invented cross-protocol normalization.

Creating a separate physical-capital subsystem would duplicate:

- assessment identity;
- protocol locking;
- persistence;
- validity;
- comparison-series logic;
- progress classification;
- provenance;
- export semantics.

That would create two incompatible answers to “what was tested and did it change?” and would violate the repository’s existing convergence toward one canonical evidence path.

**Decision:** extend #897 / OV; do not introduce another measurement domain.

---

## 2. Concrete athlete use case

The planned October 2026 baseline is deliberately broader than later monitoring. Its purpose is to establish a pre-specialization reference before cycling volume and cycling-specific intensity increase materially.

The intended schedule is:

| Date | Purpose | Tests |
|---|---|---|
| 19 Oct | familiarization / reacclimation | broad-jump + medicine-ball familiarization; squat/bench moderate heavy singles |
| 21 Oct | baseline | 3 kg seated medicine-ball throw + bench 1RM |
| 23 Oct | baseline | 3 × 6 s seated cycling sprint |
| 25 Oct | baseline | wall CMJ + standing broad jump + back-squat 1RM |

Later monitoring is intentionally cheaper:

- quarterly: broad jump, cycling sprint, squat/bench fixed-load velocity plus an optional clean heavy single;
- semiannual: add wall CMJ and medicine-ball throw;
- annual/question-driven: broader physical-capital balance sheet and true 1RM when useful.

That maps naturally onto the existing `AssessmentAttemptPurpose` values:

- `familiarization`;
- `baseline`;
- `checkpoint`;
- `post_block`.

No new purpose enum is required for the first implementation.

---

## 3. Current repository capability audit

### 3.1 Protocol model

`app/src/observations/models.ts` already defines:

- `MeasurementProtocol`;
- `AssessmentAttempt`;
- `MetricObservationRevision`;
- `ObservationValidity`;
- `ReliabilityEstimate`;
- comparison context and protocol references.

`MeasurementProtocolService` persists immutable user-scoped protocol revisions and fails closed when a bundled protocol collides with a different persisted definition.

This is the correct historical behavior for physical testing. A future edit to squat depth rules, medicine-ball setup, jump measurement method or sprint start convention must not silently rewrite an October 2026 benchmark.

### 3.2 Testing execution

`app/src/components/testing/TestingWorkflow.tsx` already:

- materializes bundled protocol revisions;
- lets the athlete load an exact immutable protocol revision;
- locks comparison context;
- creates an `AssessmentAttempt`;
- launches an ordinary structured session with `intent: testing`;
- reconciles execution state with assessment state;
- captures raw summary metric values;
- captures validity and invalidation notes;
- captures manual device provenance;
- persists canonical observations;
- supports correction revisions;
- preserves terminal abandonment semantics.

This is already the right execution boundary. The physical-capital work should reuse it.

### 3.3 Longitudinal comparison

`app/src/observations/progress.ts` already supports the essential interpretation vocabulary:

- `meaningful_improvement`;
- `possible_improvement`;
- `unclear_within_noise`;
- `possible_decline`;
- `meaningful_decline`;
- `non_comparable`;
- `insufficient_evidence`.

It requires:

- same metric;
- protocol compatibility;
- same comparison-series key;
- compatible unit;
- optional reliability estimate;
- optional practical threshold.

That is preferable to creating a new “physical-capital delta” implementation.

### 3.4 Observation retrieval

`MetricObservationService.listCurrentRevisionsForMetric()` already provides the basis for metric-scoped longitudinal retrieval.

The remaining product gap is a user-facing assessment history/read model that joins:

- protocol identity;
- attempt purpose/date;
- current observation revision;
- comparison status;
- baseline/latest delta;
- provenance.

### 3.5 Existing bundled tests

`app/src/observations/performanceTestingCatalog.ts` currently provides:

- cycling 20-minute TT;
- cycling 4-minute TT;
- standing-start 10 m sprint;
- cycling 5-second peak-power test.

The catalog is therefore already mixed cycling + field, despite the current UI copy saying “Bundled cycling assessments”.

The physical-capital battery is a natural next expansion.

---

## 4. Current gaps exposed by the October battery

### 4.1 Metric registry is too narrow

`app/src/observations/registry.ts` currently contains:

- cycling TT power metrics;
- submax HR/RPE;
- generic `strength_1rm_kg`;
- sprint elapsed time;
- `cycling_5s_peak_power_w`.

It does not yet represent:

- standing broad-jump distance;
- wall-touch CMJ height;
- medicine-ball throw distance;
- separate cycling 1 s peak and 5 s mean sprint power;
- bar mean concentric velocity;
- bar peak concentric velocity;
- optional sprint peak cadence.

The registry should be expanded with explicit raw constructs instead of overloading one vaguely named metric.

### 4.2 Comparison context is explicitly cycling-first

The comment above `ComparisonDimension` states that V1 is intentionally cycling-first.

Current dimensions include:

- power source;
- bike setup;
- test environment;
- course/trainer;
- duration;
- start mode;
- warm-up revision;
- feedback rule;
- weather;
- timing method.

For physical-capital testing, the minimum missing dimensions are likely:

- `measurement_method_id`;
- `equipment_setup_id`.

A general `external_load_kg` may be useful for fixed-load velocity anchors, but raw trial storage is a better home for varying load inside one attempt.

Do not add speculative taxonomy. Add dimensions only where a real protocol requires them.

### 4.3 No first-class raw trial model

The current canonical observation key is:

`assessmentAttemptId + metricId`.

That means one attempt can have one current canonical observation for a given metric.

This is correct for:

- bench 1RM = 127.5 kg;
- broad jump = 238 cm;
- medicine-ball throw = 6.42 m.

It is insufficient for preserving the actual evidence behind those summaries:

- broad jump attempt 1 / 2 / 3;
- CMJ attempt 1 / 2 / 3;
- medicine-ball attempt 1 / 2 / 3;
- cycling sprint attempt 1 / 2 / 3;
- squat/bench load-by-load attempts;
- WL Analysis velocity at multiple fixed loads;
- successful vs failed maximal attempts.

Putting that into `notes` would make it non-queryable and non-auditable.

Encoding `attempt_1`, `attempt_2`, etc. into metric IDs would pollute the metric registry and break comparability semantics.

**Conclusion:** add a raw assessment-trial evidence layer while keeping canonical summary observations unchanged.

### 4.4 Fixed-load bar velocity is not naturally represented

The training architecture intentionally distinguishes:

- actual successful 1RM = primary maximal-strength reference;
- fixed-load velocity = lower-cost longitudinal anchor;
- app-derived e1RM = supplementary, not ground truth.

A useful strength attempt may contain:

| Load | Result | Mean concentric velocity | Peak velocity |
|---:|---|---:|---:|
| 100 kg | success | 0.71 m/s | 0.93 m/s |
| 120 kg | success | 0.53 m/s | 0.72 m/s |
| 135 kg | success | 0.39 m/s | 0.56 m/s |
| 145 kg | success | 0.27 m/s | 0.40 m/s |
| 150 kg | miss | — | — |

The current one-value-per-metric-per-attempt model cannot represent this faithfully.

The raw trial layer should therefore be designed to support numeric measurements attached to individual trials.

### 4.5 Existing cycling sprint metric has a semantic mismatch

The bundled `cycling-5s-peak-power` protocol:

- prescribes a 5-second sprint;
- instructs the athlete to record the highest 1-second (or shorter) peak power;
- persists it under `cycling_5s_peak_power_w`.

Those semantics are ambiguous: “5 s peak power” reads as a 5-second power construct, while the instructions ask for an instantaneous/1-second peak.

The October protocol needs both:

- 1-second peak power;
- best 5-second mean power;

from a standardized 6-second seated sprint, repeated three times.

**Decision:** do not mutate the historical bundled protocol. Add a new immutable protocol with id `cycling-6s-seated-sprint` and revision `1`, with correctly named metrics. Protocol identity and numeric revision remain separate fields, matching the existing `MeasurementProtocol` contract.

A separate cleanup issue/PR may later deprecate or clarify the old bundled protocol without rewriting its persisted history.

---

## 5. Recommended canonical protocol family

### 5.1 Bench-press 1RM

Suggested protocol reference:

`{ id: 'strength-bench-press-1rm', revision: 1 }`

Canonical metric:

`strength_1rm_kg`

Protocol locks:

- grip convention;
- descent/control;
- chest touch;
- approximately 1 s pause;
- butt on bench;
- feet planted;
- no spotter assistance/contact;
- equipment/setup identity where material.

Raw trials retain:

- load;
- reps;
- result;
- RPE if recorded;
- mean/peak concentric velocity when available;
- validity/technical note.

### 5.2 Back-squat 1RM

Suggested protocol reference:

`{ id: 'strength-back-squat-1rm', revision: 1 }`

Canonical metric:

`strength_1rm_kg`

Protocol locks:

- established bar position;
- stance;
- footwear;
- belt/sleeve policy;
- depth criterion;
- rack/safety setup;
- measurement/video setup where material.

Raw trials mirror the bench trial schema.

### 5.3 Standing broad jump

Suggested protocol reference:

`{ id: 'field-standing-broad-jump', revision: 1 }`

Canonical metric:

`standing_broad_jump_distance_cm`

Protocol locks:

- fixed start line;
- free arm swing;
- two-foot takeoff;
- controlled two-foot landing;
- measurement to rear-most heel;
- same surface/footwear category where materially relevant.

Raw evidence:

- all valid/practice/invalid trials;
- best valid trial becomes canonical summary.

### 5.4 Wall-touch CMJ

Suggested protocol reference:

`{ id: 'field-wall-touch-cmj', revision: 1 }`

Canonical metric:

`wall_touch_cmj_height_cm`

Protocol locks:

- wall/floor;
- footwear;
- marking hand;
- standing-reach method;
- arm swing convention.

Raw evidence:

- standing reach measurements;
- each jump result;
- calculated jump height;
- validity.

The protocol remains explicitly a field method, not a force-plate-equivalent test.

### 5.5 3 kg seated medicine-ball chest throw

Suggested protocol reference:

`{ id: 'field-seated-medball-chest-throw-3kg', revision: 1 }`

Canonical metric:

`seated_medball_throw_distance_m`

Protocol locks:

- 3 kg ball;
- seated on floor;
- legs extended;
- head/upper back against wall;
- ball starts at chest;
- torso remains against wall;
- measure first ball contact.

Raw evidence:

- three maximal trials;
- best valid trial = canonical summary.

Ball mass is fixed in the protocol identity and does not need to become a free comparison dimension in v1.

### 5.6 Standardized cycling sprint

Suggested protocol reference:

`{ id: 'cycling-6s-seated-sprint', revision: 1 }`

Canonical metrics:

- `cycling_sprint_1s_peak_power_w`;
- `cycling_sprint_5s_mean_power_w`.

Structured raw/context fields:

- peak cadence when the device reports it;
- left/right power balance when the power source reports it, retained as descriptive context only.

Neither field needs to become a canonical longitudinal metric in the first slice. In particular, left/right balance is not a corrective target; it is context to monitor.

Protocol locks:

- 6 s duration;
- seated;
- same declared bike/setup;
- same power source;
- same environment/trainer class where material;
- same start convention, approximately 85–90 rpm rolling start if practical;
- no ERG;
- three valid trials with long recovery.

The canonical result for each power metric should be the best valid trial according to the protocol’s declared reducer.

Body-mass-relative W/kg should be derived only when a selected source-specific same-day body-mass point is available under ADR-0039. Retain the body-mass source/reference used; do not silently splice provider and manual series or manually enter W/kg as a second source of truth.

---

## 6. Proposed raw trial model

The raw trial layer should be generic enough for jumps, throws, sprints and strength without becoming a second workout language.

Illustrative contract:

```ts
type AssessmentTrialScalar = string | number | boolean;

interface AssessmentTrialValue {
  fieldId: string;
  value: AssessmentTrialScalar;
  unit?: string;
}

interface AssessmentTrial {
  id: string;
  assessmentAttemptId: string;
  ordinal: number;
  performedAt?: string;
  validity: ObservationValidity;
  invalidReason?: string;
  context: Readonly<Record<string, string | number | boolean | null>>;
  values: readonly AssessmentTrialValue[];
  sourceRef?: string;
  device?: MetricObservationDevice;
  notes?: string;
  supersedesTrialId?: string;
  correctionReason?: string;
  createdAt: string;
}
```

Raw trial fields are declared by the bundled test's bounded capture schema; they are not automatically `MetricDefinition`s. Reducers explicitly map raw `fieldId`s to canonical `metricId`s. This prevents values such as `load_kg`, success/miss, RPE, WL Analysis velocity, cadence or left/right balance from being promoted into longitudinal outcome metrics merely because they are useful trial evidence.

Candidate raw fields include:

**strength**

```text
load_kg
repetitions
result = success | miss
rpe
technical_valid
bar_mean_concentric_velocity_mps
bar_peak_concentric_velocity_mps
```

**cycling sprint**

```text
start_cadence_rpm
peak_cadence_rpm
left_balance_pct
right_balance_pct
seated = true
```

Numeric fields remain unit-aware through the capture schema; enum/boolean fields are validated against their declared field type.

### Correction semantics

Bundled trial-driven protocols need append-only raw-evidence correction in the first usable slice. Correcting only the canonical summary while leaving the raw source trial wrong would break derivation provenance. A correction therefore creates a new immutable trial record that supersedes the erroneous trial and records a reason; reducers operate on the latest unsuperseded trial for each ordinal. Historical trial records remain auditable.

### Why a separate trial model is preferable

It preserves three clean layers:

1. **execution** — what physical assessment session occurred;
2. **raw trial evidence** — what happened on each attempt;
3. **canonical metric observation** — the stable benchmark used by progress/goal/reporting.

This avoids forcing progress logic to reason about every raw attempt.

---

## 7. Canonical summary derivation

For tests with multiple trials, canonical summary creation should be deterministic and versioned.

Examples:

- broad jump: maximum valid distance;
- CMJ: maximum valid calculated height;
- medicine-ball throw: maximum valid distance;
- cycling sprint 1 s: maximum valid 1 s peak among the three protocol-compliant trials;
- cycling sprint 5 s: maximum valid 5 s mean among the three protocol-compliant trials;
- 1RM: highest technically valid successful load.

The first implementation may compute the reducer locally in the capture workflow, but the derived observation must retain:

- typed source-evidence references to the current source trials;
- algorithm/reducer version;
- protocol reference.

Do not place trial IDs into `derivedFromObservationIds`: that field promises observation identities. Introduce an additive typed derivation-evidence reference while preserving existing observation-to-observation provenance.

Do not write a derived summary without retaining the raw trial rows that produced it.

---

## 8. WL Analysis handling

WL Analysis is useful here as supplementary field instrumentation, not as laboratory ground truth.

Recommended storage:

- provider = `WL Analysis`;
- optional app/version/model provenance where available;
- same standardized camera setup ID;
- raw video reference only if the product later has a supported media/reference contract;
- load;
- mean concentric velocity;
- peak concentric velocity;
- technical validity;
- trial result.

The app should **not** make WL Analysis e1RM the primary strength benchmark.

The primary result remains the actual valid 1RM.

The longitudinal low-cost question is:

> at a comparable fixed absolute load and comparable setup, how did bar velocity change?

The implementation should initially keep those velocity anchors as structured trial history. Do not register a generic canonical bar-velocity metric until a fixed-load comparison-series contract explicitly identifies at least the exercise, exact absolute load and material measurement/setup identity. That is better than forcing multiple load anchors into the current one-observation-per-metric-per-attempt identity.

---

## 9. Body mass, anthropometry and tissue context

The baseline protocol also needs body-mass/body-composition context and knee/tissue response.

Those data already belong to existing canonical systems:

- anthropometry;
- check-in / tissue response;
- performed training / session response.

Do not create duplicate manually entered body-mass and knee-status databases inside Testing.

Instead, assessment history/export should resolve existing context where available:

- the explicitly selected source-specific same-day body-mass point under ADR-0039;
- relevant waist measurement if requested;
- assessment-day knee/tissue state;
- later-day / next-morning response where linked.

Provider and manual body-mass series remain separate. Derived W/kg or body-mass-relative 1RM must retain the exact body-mass source/reference used; if an acceptable same-day point is unavailable, the relative value remains missing rather than being silently substituted.

---

## 10. Assessment history/read model

The app needs a user-facing history because persistence alone does not satisfy the practical goal.

Minimum view:

| Domain | Test | Baseline | Latest | Change | Comparability | Last tested |
|---|---|---:|---:|---:|---|---|
| Strength | Back squat 1RM | … | … | … | comparable / not comparable | … |
| Strength | Bench 1RM | … | … | … | … | … |
| Power | Standing broad jump | … | … | … | … | … |
| Power | Wall CMJ | … | … | … | … | … |
| Power | 3 kg med-ball throw | … | … | … | … | … |
| Cycling | 1 s sprint | … | … | … | … | … |
| Cycling | 5 s sprint | … | … | … | … | … |

Use existing progress vocabulary rather than inventing another “trend color” algorithm.

History should allow opening an attempt to inspect:

- protocol revision;
- purpose;
- raw trials;
- canonical result;
- validity;
- source/device;
- notes/corrections.

---

## 11. Export requirements

Two export levels are useful.

### 11.1 Summary CSV

Designed for spreadsheets, pandas, Databricks and simple charting.

Suggested columns:

```text
observed_at
local_date
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

### 11.2 Diagnostic JSON

Preserve:

- protocol;
- attempt;
- raw trials;
- canonical observations;
- current correction revisions;
- comparison context;
- series keys;
- validity;
- device/source provenance;
- derivation provenance;
- resolved anthropometry/tissue context where included;
- progress result.

This is the right format for external coaching/AI analysis.

A later wide CSV can pivot canonical metrics into one row per date/checkpoint, but the canonical export should remain normalized.

---

## 12. What should not be done

### Do not create a separate physical-capital persistence subsystem

That duplicates OV.

### Do not mutate old bundled protocols

Historical interpretation depends on immutable revisions.

### Do not encode trial number into metric IDs

`broad_jump_attempt_1_cm` is not a stable metric.

### Do not store only “best result” and discard raw trials

The user explicitly wants useful longitudinal evidence, and #897 requires reproducible raw evidence.

### Do not double-count the testing session

`AssessmentAttempt`, raw trials and canonical observations are evidence sidecars to the `SessionRunner` execution. They must not create a second completed-workout exposure. Verification must prove that one physical testing session contributes at most one performed-training occurrence/history exposure even when assessment evidence and a provider activity both exist.

### Do not make W/kg a manually entered source of truth

Derive it from watts + body mass with provenance.

### Do not treat body mass/knee context as testing-owned facts

Reference canonical systems.

### Do not make small isolated changes automatically modify training

The existing plan requires reproducibility, magnitude beyond noise and agreement across related markers before programming changes.

### Do not claim that a metric changed because of the preceding block

Longitudinal evidence is descriptive/adjudicative, not causal proof.

---

## 13. Scope cutline

The implementation should be phased.

### First value-bearing slice

Must support:

- six October protocols;
- missing metrics;
- raw trials;
- canonical summaries;
- protocol-comparable repeats;
- history;
- CSV/JSON export.

### Follow-up

Can add:

- richer personal repeatability estimates;
- fixed-load velocity trend UI;
- automatic block-review injection;
- CPET/lactate manual import;
- semiannual/annual bundle scheduling;
- derived body-mass-normalized values;
- assessment reminders.

### Explicitly deferred

- universal physical-capital score;
- universal standards/percentiles;
- diagnosis;
- cross-protocol normalization;
- automatic training-plan changes from one test;
- media/video storage unless a proper provenance/storage contract is designed.

---

## 14. Architectural recommendation

Treat the October battery as the first substantial multidomain consumer of OV.

The correct architecture is:

```text
Testing SessionExecution
        |
        v
AssessmentAttempt (locked protocol + purpose)
        |
        +--> AssessmentTrial[]            # raw repeated evidence
        |       |
        |       +--> load / distance / velocity / sprint metrics
        |
        +--> MetricObservationRevision[]  # canonical summary benchmark(s)
                |
                +--> comparison series
                +--> progress derivation
                +--> goals / block outcome
                +--> history
                +--> export
```

This preserves the repository’s existing evidence boundaries and makes the user’s physical-capital baseline a first-class, exportable, comparable longitudinal record rather than another Markdown-only process.
