# Performance outcome validation & goal-progress loop

* **Capability prefix:** `OV`
* **Status:** `In progress`
* **Approved:** 2026-08-21 by the project owner. Implementation proceeds in separate PRs: PR #154 delivered the OV0/OV1 contract foundation; PR #155 carries OV2 persistence/manual-entry plus this documentation reconciliation.
* **Blocked by:** none for evidence-only implementation. Code that changes recommendation behaviour remains outside this plan's current authority and is still gated by the active Phase 9.0 evidence boundary plus the separate ADR/ship decision described below.
* **Unlocks:** protocol-locked repeated testing, honest individual progress interpretation, block-level outcome reports, and later evidence for whether stable recommendation-policy versions are associated with better goal outcomes.
* **Source analysis:** [`2026-08-21-performance-outcome-validation.md`](../analysis/2026-08-21-performance-outcome-validation.md)
* **Origin / architecture reused:** ADR-0023 D-MOBS/D-MPOLICY plus the repeated-standardized-testing trigger originally recorded in [`multidomain-session-authoring-execution-and-evidence.md`](./multidomain-session-authoring-execution-and-evidence.md). Implementation ownership and live status are canonical in this OV plan.

> **This is an evidence capability, not a new recommendation phase.** `OV*` items may collect,
> derive and report outcome evidence. They do not gain authority over same-day readiness,
> ranking, weekly allocation or session selection. If outcome evidence later becomes an
> automatic planning/selection input, that is a separate architecture decision and ship gate.
>
> **Canonical ownership after the 2026-08-21 trigger.** The former `M7.1`–`M7.4` labels are
> retired as implementation IDs. The multidomain plan retains only their historical trigger and
> requirement mapping. **This task board is the sole live implementation/status source for
> repeated standardized testing, metric observations, progress interpretation and their product
> surfaces.** Do not recreate `M7.*` work items or copy OV status back into the M task board.

---

## Goal

Close the training loop:

```text
goal
  -> authored/planned training
  -> daily adjudication
  -> execution
  -> recovery/response
  -> repeated training
  -> standardized performance observation / goal event
  -> progress interpretation
  -> block outcome report
  -> human / external-plan decision for the next block
```

The capability must answer, as honestly as the available data allow:

1. What was this block trying to improve?
2. Which measurements were declared before evaluation?
3. Were the before/after measurements actually comparable?
4. Did the observed change exceed available measurement-noise context?
5. Was the change practically relevant to the goal?
6. Was the intended training delivered?
7. What response/recovery cost accompanied it?
8. Is the block `on_track`, `mixed`, `off_track` or `insufficient_evidence`?
9. Which `policyVersion` and planning authority were active, without claiming causal superiority from a simple before/after comparison?

---

## Non-goals

This plan does **not**:

* create one universal fitness/readiness/athleticism score;
* replace daily readiness with performance testing;
* automatically rewrite FTP, zones, thresholds or training targets after one test;
* infer that `95% × 20-minute power` is the athlete’s physiological threshold;
* build a full laboratory-testing platform;
* require force plates, timing gates, VBT or other hardware;
* build M6 taxonomy unless an actual chosen test needs it;
* build a rich progress dashboard before report/export use proves a need;
* claim that policy A caused better adaptation than policy B from non-randomized sequential blocks;
* change production recommendation behaviour during the Phase 9.0 evidence block.

---

## Existing decisions that govern this work

No new recommendation-authority ADR is required for the first implementation because the critical boundaries already exist.

### ADR-0023 D-MOBS

Metric observations retain:

* unit;
* source;
* protocol;
* validity;
* comparison-series provenance.

Training and testing are distinct intents.

### ADR-0023 D-MPOLICY

Recorded detail and derived evidence do not become production engine policy without a separate evidence-backed decision.

### ADR-0010 replay/provenance

If a result later appears in an auditable decision, the exact versioned derivation that produced it must be recoverable.

### Existing session/response contracts

Reuse:

* `SessionDefinition` / occurrence / execution boundaries;
* planned-versus-performed comparison;
* M5 occurrence-linked response;
* canonical daily check-in tissue authority;
* user-scoped persistence;
* Europe/Warsaw date semantics.

### New decision boundary for this plan

`OutcomeEvaluationSpec`, progress derivation and block reports are **evidence-only sidecars**. No module under optimizer/planner/rules/weekly allocation may import them at runtime.

If a future change wants to use “performance is off track” to automatically change the next recommendation or mesocycle, write an ADR first.

---

## Delivery graph

```text
OV0  contract + repeated-testing trigger/ownership transfer
  |
  v
OV1  metric/protocol/comparability foundation
  |
  v
OV2  raw observation + assessment-attempt storage
  |
  +----------------------------+
  |                            |
  v                            v
OV3 protocol-locked       OV5.1 frozen outcome-evaluation spec
     testing workflow             |
  |                               v
  |                         OV4 progress derivation / reliability
  |                               |
  +-------------------------------+
                  |
                  v
           OV5.2–OV5.4 process join + block outcome
                  |
                  v
           OV6 report/export + minimal athlete UX
                  |
                  v
           OV7 current cycling bootstrap + first real evidence
                  |
                  v
           OV8 later policy-version outcome analysis — evidence only, no causal claim
```

OV1–OV6 may be implemented while Phase 9.0 runs because they are evidence-only. **Do not schedule a new exhaustive benchmark simply because the code exists**; OV7 is periodization-aware and keeps the current peak/taper intact.

---

## Task board

| Item | Title | Status | Blocked by |
|---|---|:---:|---|
| OV0.1 | Record repeated-testing trigger and ownership transfer | `[x]` | none — trigger satisfied 2026-08-21 |
| OV0.2 | Freeze v1 terminology and evidence planes | `[x]` | OV0.1 |
| OV1.1 | Minimal metric registry | `[x]` | OV0.2 |
| OV1.2 | Immutable measurement protocols | `[x]` | OV1.1 |
| OV1.3 | Comparable-series and reliability provenance | `[x]` | OV1.2 |
| OV1.4 | Architecture boundary tests | `[x]` | OV1.1 |
| OV2.1 | Metric observation persistence | `[x]` | OV1.3 |
| OV2.2 | Assessment attempt lifecycle | `[x]` | OV2.1 |
| OV2.3 | Manual observation adapter first | `[x]` | OV2.2 |
| OV2.4 | Firestore rules/emulator coverage | `[x]` | OV2.1–OV2.3 |
| OV3.1 | Testing intent in existing session flow | `[ ]` | OV2.2, existing session runner |
| OV3.2 | Protocol-lock/familiarization/validity UX | `[ ]` | OV3.1 |
| OV3.3 | Test completion and raw observation write | `[ ]` | OV3.2 |
| OV3.4 | Minimal mobile/browser acceptance | `[ ]` | OV3.3 |
| OV4.1 | Pure progress comparison | `[ ]` | OV2.1, OV5.1 |
| OV4.2 | Reliability/error interpretation | `[ ]` | OV4.1 |
| OV4.3 | Optional practical-threshold interpretation | `[ ]` | OV4.2 |
| OV4.4 | Personal repeatability estimator | `[ ]` | real close-spaced repeat trials; not required for v1 |
| OV5.1 | Evidence-only outcome-evaluation spec | `[ ]` | OV1.2 |
| OV5.2 | Process/response evidence read model | `[ ]` | M5.3 existing report path |
| OV5.3 | Block outcome derivation | `[ ]` | OV4.3, OV5.1, OV5.2 |
| OV5.4 | Policy-version/planning-context segmentation | `[ ]` | OV5.3 |
| OV6.1 | Deterministic report + CSV/JSON export | `[ ]` | OV5.3 |
| OV6.2 | Minimal progress/report UI | `[ ]` | OV6.1 + repeated use question |
| OV7.1 | Current goal-event ecological outcome capture | `[ ]` | event occurs / data available, OV5.1 |
| OV7.2 | Post-event cycling baseline protocols | `[ ]` | recovery / next appropriate block boundary, OV3.3 |
| OV7.3 | First 4–8 week repeated comparison | `[ ]` | OV7.2 + elapsed training block, OV4.3 |
| OV7.4 | First block readout and plan-adjustment note | `[ ]` | OV7.3, OV6.1 |
| OV8.1 | Multi-block policy-segment report | `[ ]` | multiple comparable prospective blocks |
| OV8.2 | Decide whether any outcome signal deserves planning authority | `[ ]` | OV8.1 + separate ADR if yes |

**Implementation status (2026-08-21).** PR #154 merged the contract foundation (OV0/OV1 code); PR #155 completes the persistence/manual-entry slice (OV2), including immutable protocol storage needed to close OV1.2 end to end. By dependency, `OV3.1`, `OV5.1` and `OV5.2` are currently startable. The **next planned code slice remains PR C / OV3.1–OV3.4**; startability is not the same thing as preferred PR order. `OV4.1` is intentionally blocked on `OV5.1` because its own baseline/direction logic resolves the frozen outcome binding. No progress labels, block verdicts or recommendation-policy inputs have shipped.

---

# OV0 — contract and scope

## OV0.1 `[x]` Record repeated-testing trigger and ownership transfer

**Why.** The repeated-testing capability was deliberately usage-triggered in the multidomain roadmap. The triggering condition is now real: the athlete wants repeated, standardized performance tests specifically to determine whether training is achieving block goals.

**Change.** Record in the parent multidomain plan that the repeated-testing trigger was satisfied on 2026-08-21 and that **implementation/status ownership transfers to this OV plan**. The parent keeps only historical requirement mapping; it has no actionable `M7.*` task rows. Do **not** mark M6 triggered unless a chosen test actually needs missing M6 domain input.

Record the v1 product cutline:

1. cycling-first metric/protocol set;
2. manual observation entry;
3. protocol-locked test workflow;
4. progress derivation;
5. block report/export;
6. no engine-policy import.

**Done when.** The parent plan contains no actionable `M7.*` implementation rows/specs, this OV board is named as canonical, and the plan index does not direct an agent to implement repeated-testing work under M.

## OV0.2 `[x]` Freeze terminology and evidence planes

Add a short architecture note or code-level vocabulary that preserves three distinct concepts:

```ts
type EvidencePlane = 'decision' | 'process_response' | 'outcome';

type ObservationIntent = 'training' | 'testing' | 'competition';

type OutcomeRole = 'primary' | 'secondary' | 'context';
```

The exact TypeScript location may differ after implementation review; the semantic separation is the requirement.

**Done when.** No API/UI field calls HRV, adherence or AI agreement a “performance outcome,” and a competition result is distinguishable from a protocol-locked benchmark.

---

# OV1 — metric, protocol and comparability foundation

This is the canonical OV implementation of the metric/protocol/comparability requirements that were originally sketched in the multidomain roadmap.

## OV1.1 `[x]` Minimal metric registry

Create `app/src/observations/` only for metrics that will actually be used.

Suggested v1:

```ts
export type MetricDirection =
  | 'higher_is_better'
  | 'lower_is_better'
  | 'target_range'
  | 'context_only';

export interface MetricDefinition {
  id: string;
  displayName: string;
  domain: 'cycling' | 'running' | 'field' | 'strength' | 'general';
  unit: string;
  direction: MetricDirection;
  valueKind: 'scalar';
  description: string;
}
```

`MetricDirection` describes the general metric catalogue only. Goal evaluation uses the narrower `OutcomeDirection` defined in OV5.1; `context_only` cannot be bound as a primary/secondary outcome, and a target range is incomplete until explicit bounds are supplied at the evaluation binding.

Initial cycling registry — keep deliberately small:

* `cycling_tt_20m_mean_power_w` — higher is better;
* `cycling_tt_4m_mean_power_w` — higher is better;
* `cycling_submax_mean_hr_bpm` — context-only unless a later validated protocol defines an outcome interpretation;
* `cycling_submax_rpe` — context-only;
* optional `cycling_sprint_5s_peak_power_w` only when the next block actually tracks sprint maintenance;
* competition result fields live on the ecological outcome record rather than being forced into the protocol-observation registry.

A derived `cycling_ftp95_estimate_w` may exist later but must be algorithm-versioned and must never replace the raw 20-minute observation.

**Files.** `observations/models.ts`, `observations/registry.ts`, tests.

**Done when.** Unit mismatch fails; unsupported metric IDs fail; `context_only` cannot be promoted to a primary/secondary outcome binding; no unused large catalogue ships.

## OV1.2 `[x]` Immutable measurement protocols

Implement the protocol contract inherited from ADR-0023 and the original repeated-testing requirements.

Suggested shape:

```ts
export interface MeasurementProtocol {
  id: string;
  revision: number;
  title: string;
  intent: 'testing';
  metricIds: readonly string[];
  instructions: readonly ProtocolInstruction[];
  warmupRef?: string;
  comparisonContext: {
    required: readonly ComparisonDimension[];
    seriesDefining: readonly ComparisonDimension[];
    contextOnly: readonly ComparisonDimension[];
    canonicalizationVersion: string;
  };
  familiarization: {
    required: boolean;
    minimumExposures: number;
  };
  burden: 'low' | 'moderate' | 'high';
  expectedRecoveryHours?: number;
  invalidationRules: readonly string[];
  createdAt: string;
}
```

`ProtocolInstruction` should be structured only to the extent needed by the existing generic session runner. Do not create a second executable-workout language.

Examples of comparison dimensions:

* power source/device identity;
* bike/setup if material;
* indoor trainer / outdoor course identity;
* duration;
* start mode;
* warm-up revision;
* surface for running/field metrics;
* timing method for sprint metrics.

The protocol explicitly partitions required context into `seriesDefining` and `contextOnly`. A dimension cannot appear in both lists. Every `seriesDefining` dimension must also be required for a valid benchmark attempt. Weather may be stored as contextual-only unless a specific protocol revision declares it series-defining.

### Comparison-key canonicalization

`ComparisonSeries.key` construction is versioned policy, not ad hoc string concatenation.

V1 contract:

1. validate the observation against the exact protocol revision;
2. take only the protocol's `seriesDefining` dimensions;
3. normalize each value using the registered `ComparisonDimension` type (for example trimmed/case-normalized identifiers, canonical units and stable booleans/numbers);
4. sort dimensions by stable dimension ID;
5. serialize `{ metricId, protocolId, protocolRevision, canonicalizationVersion, dimensions }` using canonical JSON with stable key order;
6. hash that canonical payload with the repository-selected deterministic hash function.

Equivalent repeats must canonicalize identically regardless of input object key order. A material device/setup change declared series-defining must produce a different key. Changing the canonicalization algorithm requires a new `canonicalizationVersion`; old observations keep their original version/key and are not silently re-keyed.

**Persistence.** User-scoped immutable protocol revisions, e.g.:

```text
users/{uid}/measurement_protocols/{protocolId}/revisions/{revision}
```

Static application-owned defaults may be bundled in code and materialized by reference; athlete-edited protocols become immutable user revisions.

**Done when.** Material protocol changes create a new revision; old observations continue resolving their exact revision; the series-defining dimension set and canonicalization version are explicit and replayable.

## OV1.3 `[x]` Comparable series and reliability provenance

Add pure comparability logic.

```ts
export interface ComparisonSeries {
  metricId: string;
  protocolId: string;
  protocolRevision: number;
  canonicalizationVersion: string;
  key: string;
}

export type ReliabilitySource =
  | 'literature_reference'
  | 'personal_repeatability'
  | 'manual';

export interface ReliabilityEstimate {
  source: ReliabilitySource;
  statistic: 'cv_pct' | 'typical_error_pct' | 'typical_error_abs' | 'sem_abs';
  value: number;
  reference?: string;
  contextNote?: string;
  estimatedAt?: string;
}
```

Rules:

* same metric + same protocol revision is **not sufficient** if a series-defining device/setup dimension changed;
* literature reliability may inform interpretation but is labelled reference-level evidence;
* personal repeatability is calculated only from deliberately repeated, closely spaced comparable attempts where expected true adaptation is small;
* months-apart improving tests must not be reused to estimate “measurement noise.”

**Files.** `observations/comparability.ts`, `observations/reliability.ts`, tests.

**Done when.** Same protocol/device produces the same key; changed series-defining source/setup produces a different key; equivalent canonical input ordering does not; reliability source and statistic are always visible.

## OV1.4 `[x]` Architecture boundary tests

Extend the existing architecture guard pattern.

Forbidden runtime reachability:

```text
engine/optimizer
engine/planner
engine/rules
engine/weeklyAllocation
engine/evergreenPlanning
engine/sequenceSearch
    -> observations/progress
    -> outcome-evaluation modules
```

Observation types may be imported by evidence/reporting code. Production selection cannot import progress or block verdicts.

**Done when.** CI fails if an engine selector begins consuming `meaningful_improvement`, a block verdict or an outcome score.

---

# OV2 — raw observations, corrections, test attempts and ecological outcomes

This is the canonical OV persistence layer for repeated-testing outcome evidence.

## OV2.1 `[x]` Metric observation persistence

Persist raw protocol observations append-only. Corrections are new immutable revisions of one stable logical observation; they do not overwrite the original value.

A logical observation is identified deterministically by the assessment attempt and metric:

```text
observationKey = `${assessmentAttemptId}:${metricId}`
```

Suggested records:

```ts
export type ObservationValidity =
  | 'valid'
  | 'invalid'
  | 'practice'
  | 'questionable';

export interface MetricObservationHead {
  observationKey: string;
  assessmentAttemptId: string;
  metricId: string;
  headRevision: number;
  createdAt: string;
  updatedAt: string;
}

export interface MetricObservationRevision {
  observationKey: string;
  revision: number;
  supersedesRevision?: number;
  metricId: string;
  value: number;
  unit: string;
  observedAt: string;
  source: 'manual' | 'garmin_activity' | 'garmin_lap' | 'derived';
  sourceRef?: string;
  device?: {
    provider: string;
    model?: string;
    deviceId?: string;
  };
  protocolRef: {
    id: string;
    revision: number;
  };
  comparisonSeriesKey: string;
  comparisonCanonicalizationVersion: string;
  assessmentAttemptId: string;
  validity: ObservationValidity;
  invalidReason?: string;
  context: Record<string, string | number | boolean | null>;
  derivedFromObservationIds?: readonly string[];
  algorithmVersion?: string;
  correctionReason?: string;
  createdAt: string;
}
```

Do not permit a derived observation without source IDs + algorithm version.

Suggested paths:

```text
users/{uid}/metric_observations/{observationKey}
users/{uid}/metric_observations/{observationKey}/revisions/{revision}
```

Revision documents are immutable. The head document is the only mutable selector and may advance only transactionally from `N` to `N+1` while the corresponding immutable revision is created. Revision 1 has no `supersedesRevision`; revision `N+1` must declare `supersedesRevision: N`. Readers use `headRevision` for the current value and may resolve an older revision only for historical replay/audit.

A correction is therefore distinguishable from a second independent observation. The stable `observationKey` never changes, while revision identity does.

**Done when.** Raw revisions survive recomputation; invalid/practice revisions remain inspectable; a correction chain is deterministic; readers cannot accidentally treat a superseded revision as current.

## OV2.2 `[x]` Assessment attempt lifecycle

A protocol test session is more than one scalar. Persist an attempt header so warm-up, validity and multiple protocol metrics share identity.

```ts
export interface AssessmentAttempt {
  id: string;
  protocolRef: { id: string; revision: number };
  scheduledDate?: string;
  startedAt?: string;
  completedAt?: string;
  state: 'scheduled' | 'in_progress' | 'completed' | 'abandoned';
  purpose: 'familiarization' | 'baseline' | 'checkpoint' | 'post_block';
  sourceSessionRef?: string;
  notes?: string;
}
```

Competition is intentionally **not** an `AssessmentAttempt` purpose. Competition evidence has different comparability semantics and uses the separate `CompetitionOutcome` record below.

Suggested path:

```text
users/{uid}/assessment_attempts/{attemptId}
```

Keep observations as separate documents so variable metric/attempt counts do not recreate nested-array validation problems.

**Done when.** One completed test attempt can own multiple raw protocol metrics and invalid attempts remain queryable without contaminating progress.

### First-class ecological competition outcome

A goal event is valuable evidence without pretending to be a protocol-locked benchmark.

```ts
export interface CompetitionOutcome {
  id: string;
  eventRef?: string;
  sport: 'cycling' | 'running' | 'field' | 'other';
  occurredAt: string;
  source: 'manual' | 'garmin_activity' | 'imported_result';
  sourceRef?: string;
  result: {
    completed: boolean;
    placing?: number;
    fieldSize?: number;
    elapsedSeconds?: number;
    distanceM?: number;
    courseId?: string;
    summary?: string;
  };
  metrics: Readonly<Record<string, number | string | boolean | null>>;
  context: Readonly<Record<string, string | number | boolean | null>>;
  createdAt: string;
}
```

`CompetitionOutcome` has no `protocolRef`, `comparisonSeriesKey` or `assessmentAttemptId`. Race-derived duration powers may be stored inside its metrics/context or as clearly labelled competition-derived evidence, but they do not enter protocol TT comparison series unless a separately captured protocol observation genuinely satisfies that protocol.

Suggested path:

```text
users/{uid}/competition_outcomes/{competitionOutcomeId}
```

## OV2.3 `[x]` Manual observation adapter first

Manual entry is the v1 write path.

Why first:

* it proves the domain model before device automation;
* it supports tests from any bike/trainer/timing source;
* it avoids interpreting ordinary Garmin activities as formal benchmarks;
* it keeps M9.3 integration scope bounded.

The adapter validates metric/unit/protocol/context and computes the deterministic series key before writing.

Do not add a generic “import every personal record from Garmin” feature.

**PR-boundary clarification (2026-08-21).** OV2.3 is the platform-neutral client adapter/write contract, not a separate manual-entry screen. PR B explicitly carries no UI; the athlete-visible 390 px test completion/value-entry and correction flow remains OV3.3–OV3.4. This avoids treating the same phone UX as completed twice in two different PR slices.

**Done when (adapter slice).** A browser/mobile caller can construct a 20-minute or 4-minute observation with exact source/device/protocol/validity provenance and a deterministic comparison-series key; the athlete-facing phone flow is accepted under OV3.4.

## OV2.4 `[x]` Firestore rules and emulator tests

Rules must enforce:

* `users/{uid}` isolation;
* known top-level keys only;
* valid enum values;
* unit consistency where rules can safely check it;
* protocol revision identity present for protocol observations;
* owner cannot spoof another user path;
* revision documents are immutable;
* revision 1 has no predecessor;
* correction revision `N+1` points to `N` and is created together with a head advance from `N` to `N+1`;
* a stale writer cannot advance the head from the wrong prior revision;
* client cannot silently mutate an immutable protocol revision after observations reference it;
* competition outcomes cannot populate protocol-only fields or protocol comparison series.

Use subcollections/documents rather than unbounded nested arrays where per-element validation would be weak.

**Done when.** Emulator tests cover cross-user denial, immutable protocol/revision denial, malformed observation denial, stale correction denial, valid initial/manual writes, valid correction chains and ecological-outcome isolation.

---

# OV3 — protocol-locked testing workflow

This is the canonical OV implementation of the protocol-locked testing workflow. It reuses M session execution infrastructure but is not an M task.

## OV3.1 `[ ]` Reuse existing session flow with `testing` intent

A performance test is an executable session with additional observation semantics, not a second runner architecture.

Use the existing session definition/occurrence/execution model where possible:

```text
MeasurementProtocol
  -> test SessionDefinition / immutable execution prescription
  -> SessionOccurrence(intent = testing)
  -> SessionExecution
  -> AssessmentAttempt
  -> MetricObservationRevision[]
```

A testing occurrence has no automatic recommendation-selection authority merely because it exists. If scheduled as externally-authored planned work, existing adjudication/safety contracts still apply.

**Done when.** A protocol can be scheduled/run through the existing mobile runner without creating `TestRunnerV2` as a parallel execution stack.

## OV3.2 `[ ]` Protocol lock, familiarization and validity UX

Before start, show compact immutable context:

* protocol title/revision;
* metric(s);
* device/source expected;
* series-defining setup;
* warm-up;
* familiarization status;
* burden (`low/moderate/high`);
* invalidation conditions.

At finish, athlete marks:

* valid;
* invalid + reason;
* practice/familiarization;
* questionable + note.

Do not hide invalid attempts; exclude them from default benchmark selection.

**Done when.** An athlete cannot accidentally label a practice effort as the new baseline without an explicit validity/purpose choice.

## OV3.3 `[ ]` Completion → raw observation write

The protocol-specific capture step writes the raw metric(s) and links them to the exact assessment/session.

For cycling v1 this can be simple numeric entry:

* mean 20-minute power;
* mean 4-minute power;
* fixed-load mean HR;
* submax RPE.

Do not calculate arbitrary time-window maximal powers from incomplete summary telemetry in this item.

### Idempotency contract

Initial completion uses the deterministic logical identity:

```text
observationKey = `${assessmentAttemptId}:${metricId}`
initialRevision = 1
```

The writer transaction creates the head document and immutable revision `1` only if the logical observation does not already exist. An offline retry or double tap with the same attempt/metric therefore resolves to the same path. If revision 1 already exists with the same canonical payload, treat the retry as success. If the payload conflicts, do **not** overwrite it; enter the explicit correction workflow.

Corrections keep the same `observationKey` and create revision `headRevision + 1` transactionally, so a correction cannot duplicate or replace the original revision.

**Done when.** Completion is idempotent across double taps/offline retry; stale concurrent writes fail safely; corrections create distinct revisions; abandoning the test does not create a valid benchmark.

## OV3.4 `[ ]` Mobile/browser acceptance

Required states at 390 px and desktop:

* scheduled test;
* familiarization notice;
* protocol details;
* in-progress runner;
* completion/value entry;
* invalid reason;
* offline pending write + reload/reconnect;
* completed summary;
* explicit correction flow for an already-written metric.

**Done when.** No horizontal overflow, all controls ≥44 px, and offline/retry does not duplicate an observation.

---

# OV4 — progress derivation

This is the canonical OV implementation of comparable progress/reliability interpretation.

## OV4.1 `[ ]` Pure comparable progress calculation

New pure module, e.g. `observations/progress.ts`.

```ts
export type ProgressStatus =
  | 'meaningful_improvement'
  | 'possible_improvement'
  | 'unclear_within_noise'
  | 'possible_decline'
  | 'meaningful_decline'
  | 'non_comparable'
  | 'insufficient_evidence';

export interface ProgressResult {
  metricId: string;
  baselineObservationId?: string;
  latestObservationId?: string;
  absoluteChange?: number;
  percentChange?: number;
  comparable: boolean;
  comparisonSeriesKey?: string;
  reliability?: ReliabilityEstimate;
  practicalThreshold?: PracticalThreshold;
  status: ProgressStatus;
  reasons: readonly string[];
  progressPolicyVersion: string;
}
```

`progressPolicyVersion` versions the **progress derivation algorithm**. It is not recommender-policy attribution. Pure metric progress has no mandatory training `policyVersion`; training-policy context belongs to the block report's `policySegments`.

Baseline selection:

1. resolve the baseline policy from the frozen `OutcomeMetricBinding` revision from OV5.1;
2. valid current observation revisions only;
3. same comparison series;
4. never silently replace a declared baseline with the historical personal best;
5. allow a new block/evaluation revision to declare a new baseline while preserving old reports and observation revisions.

**Dependency correction (2026-08-21).** The earlier task row named only OV2.1, but this algorithm explicitly depends on the frozen `OutcomeMetricBinding` contract defined by OV5.1. OV5.1 therefore precedes OV4.1; the PR slicing below is updated to match the actual design rather than leaving an implicit dependency for a later implementer to rediscover.

**Done when.** An invalid faster attempt cannot become the baseline/latest benchmark; device/protocol changes return `non_comparable`; a comparison spanning multiple training-policy segments still has one truthful metric result without pretending it belongs to one policy.

## OV4.2 `[ ]` Reliability/error interpretation

V1 rule: transparent and conservative.

* If there is no reliability estimate, report raw change and `insufficient_evidence` for claims about measurement-resolved change.
* If only literature reference reliability exists, label confidence as reference-level.
* If personal repeatability exists, prefer it for that exact series.
* Do not convert CV/SEM/typical error between statistics without an explicit, tested formula and source contract.

Avoid fake probability language. “Change exceeds the available typical-error context” is safer than “93% probability of improvement” unless an actual model produces that probability.

**Done when.** The report exposes which error statistic/source was used and can reproduce the classification.

## OV4.3 `[ ]` Optional practical-threshold interpretation

```ts
export type PracticalThreshold =
  | { kind: 'absolute'; value: number; unit: string }
  | { kind: 'percent'; value: number }
  | { kind: 'target'; value: number; unit: string };
```

Threshold belongs to the outcome metric binding, not the global metric registry, because “worthwhile” depends on the goal/block.

A change can be:

* measurement-resolved but practically trivial;
* practically large but still within noisy measurement uncertainty;
* both;
* neither.

The reasons list must expose the distinction.

**Done when.** No metric has a repository-wide hard-coded “2% is worthwhile” rule.

## OV4.4 `[ ]` Personal repeatability estimator — trigger-gated

**Trigger:** at least 2–3 deliberately repeated valid comparable attempts performed close enough together that real training adaptation is expected to be small, and the athlete wants a personal noise estimate.

Compute only statistics justified by the actual repeated design. Keep source observation IDs.

This item is **not required for the first usable release**; literature reference reliability can be displayed initially with a lower evidence grade.

---

# OV5 — outcome specification and block evidence

## OV5.1 `[ ]` Evidence-only `OutcomeEvaluationSpec`

Do not create a second training-plan authority. This record says **how a block will be evaluated**, not what sessions will be selected.

Evaluation criteria must be frozen before the outcome is interpreted. Use an immutable revision model rather than an editable active document.

Suggested header:

```ts
export interface OutcomeEvaluationSpecRevision {
  id: string;
  revision: number;
  title: string;
  startDate: string;
  endDate: string;
  sourceRef?: {
    kind: 'event' | 'authored_plan' | 'manual_block';
    id: string;
  };
  status: 'draft' | 'active' | 'completed' | 'archived';
  activatedAt?: string;
  contentHash: string;
  createdAt: string;
}
```

Suggested paths:

```text
users/{uid}/outcome_evaluations/{id}
users/{uid}/outcome_evaluations/{id}/revisions/{revision}
users/{uid}/outcome_evaluations/{id}/revisions/{revision}/metrics/{bindingId}
```

The parent document may point to the current revision. Draft revisions may be edited or replaced before activation. Activation freezes the revision and all metric bindings. After activation, metric, role, direction, threshold, baseline rule, target window and ecological target criteria are immutable. A legitimate change creates a new evaluation revision; it never rewrites the criteria used by an existing report. Once any target/post-block result has been observed, retroactively creating a more favourable evaluation revision for the same result must be surfaced as a limitation rather than treated as predeclared evidence.

### Outcome direction

General `MetricDirection` is too permissive for a goal binding. Use a dedicated direction contract:

```ts
export type OutcomeDirection =
  | { kind: 'higher_is_better' }
  | { kind: 'lower_is_better' }
  | {
      kind: 'target_range';
      lowerBound: number;
      upperBound: number;
      unit: string;
    };
```

At the binding boundary:

* `primary` and `secondary` bindings require `OutcomeDirection`;
* a registry metric whose direction is `context_only` cannot be bound as primary/secondary;
* `target_range.lowerBound` and `upperBound` must be finite, use the metric unit, and satisfy `lowerBound < upperBound`;
* `context` bindings carry no progress direction and do not produce `meaningful_improvement`/`decline` labels.

### Baseline selection

Make baseline selection discriminated so no required parameter is optional:

```ts
export type BaselineSelection =
  | {
      kind: 'declared_observation';
      observationId: string;
    }
  | {
      kind: 'first_valid_in_window';
      window: { startDate: string; endDate: string };
      selection: 'earliest_valid';
    };
```

Shared binding fields:

```ts
interface OutcomeMetricBindingBase {
  id: string;
  metricId: string;
  protocolRef?: { id: string; revision: number };
  baseline: BaselineSelection;
  targetObservationWindow?: { startDate: string; endDate: string };
  rationale: string;
}

export type OutcomeMetricBinding =
  | (OutcomeMetricBindingBase & {
      role: 'primary' | 'secondary';
      expectedDirection: OutcomeDirection;
      practicalThreshold?: PracticalThreshold;
    })
  | (OutcomeMetricBindingBase & {
      role: 'context';
      expectedDirection?: never;
      practicalThreshold?: never;
    });
```

For `declared_observation`, `observationId` is mandatory and must resolve to a valid current revision compatible with the binding. For `first_valid_in_window`, both window bounds are mandatory; v1 deterministically selects the earliest valid comparable current observation in that window, with ties broken by observation key. The target window remains separate from the baseline window.

Competition/ecological targets are declared separately from protocol metric bindings so a race never has to masquerade as a test observation.

**Done when.** A block declares and activates one immutable evaluation revision before post-block interpretation; baseline selection is mechanically complete; context-only metrics cannot become primary/secondary outcomes; every report stores the exact evaluation revision/hash it used.

## OV5.2 `[ ]` Process/response evidence read model

Reuse rather than recreate:

* weekly role coverage;
* recommendation verdict/revision data;
* completed session history;
* planned-versus-performed comparison;
* M5.3 outcome report;
* response coverage.

Produce a bounded `BlockProcessEvidence`:

```ts
interface BlockProcessEvidence {
  plannedKeyRoles: number;
  completedKeyRoles: number;
  plannedSessionCount: number;
  completedSessionCount: number;
  adherencePct: number;
  scaledCount: number;
  deferredCount: number;
  skippedCount: number;
  unplannedRestCount: number;
  responseCounts: {
    passed: number;
    caution: number;
    reactive: number;
    unknown: number;
  };
  responseCoveragePct: number;
}
```

`adherencePct` is a derived read-model field from the repository's canonical planned/performed source; it is not a second write authority.

Exact fields should follow existing canonical sources; do not invent duplicate adherence truth.

**Done when.** Every count/percentage reconciles to existing session/recommendation records and no new write path is needed.

## OV5.3 `[ ]` Block outcome derivation

Pure module, e.g. `outcomes/blockOutcome.ts`.

```ts
export type BlockVerdict =
  | 'on_track'
  | 'mixed'
  | 'off_track'
  | 'insufficient_evidence';

export interface BlockOutcomeReport {
  evaluationRef: {
    id: string;
    revision: number;
    contentHash: string;
  };
  period: { startDate: string; endDate: string };
  metricProgress: readonly ProgressResult[];
  ecologicalOutcomes: readonly CompetitionOutcome[];
  process: BlockProcessEvidence;
  verdict: BlockVerdict;
  reasons: readonly string[];
  policySegments: readonly PolicySegment[];
  blockVerdictPolicyVersion: string;
}
```

The report persists the exact frozen evaluation revision/hash, so later edits/new revisions cannot rewrite history. `metricProgress` contains protocol-comparable progress only. `ecologicalOutcomes` contains race/event evidence and never enters the protocol comparison series.

### Versioned adequacy policy

Block-verdict completeness must be deterministic. V1 uses a named policy, for example `block-adequacy-v1`, with explicit **operational evidence-coverage thresholds**, not physiological claims:

```ts
export const BLOCK_ADEQUACY_V1 = {
  minKeyRoleCoveragePct: 70,
  minAdherencePct: 70,
  minResponseCoveragePctForOnTrack: 70,
} as const;
```

Derivations:

```text
keyRoleCoveragePct =
  plannedKeyRoles === 0
    ? 100
    : 100 * completedKeyRoles / plannedKeyRoles

processAdequate =
  keyRoleCoveragePct >= 70
  AND adherencePct >= 70

responseAdequateForOnTrack =
  responseCoveragePct >= 70
```

These values are an inspectable initial product completeness policy. They are not claims that 70% is physiologically sufficient. Changing them requires a new `blockVerdictPolicyVersion`, and old reports remain replayable under their original version.

### Deterministic v1 verdict order

Evaluate in this order:

1. **`insufficient_evidence`** if there is no valid declared primary outcome evidence, required protocol baseline/post measurements are non-comparable, or `processAdequate` is false. Performance/ecological facts still appear in the report; only the block-level verdict is withheld.
2. **`off_track`** if adequate evidence exists and a declared primary outcome shows meaningful decline or an explicitly declared primary ecological goal is missed, with no conflicting primary success that requires `mixed`.
3. **`mixed`** for conflicting primary outcomes; meaningful primary improvement with a meaningful secondary/material decline; good outcome with repeated adverse response evidence; or otherwise positive outcome/process evidence with `responseAdequateForOnTrack === false`.
4. **`on_track`** only when at least one declared primary metric shows meaningful progress or a declared primary ecological goal is met, no primary outcome shows meaningful decline/failure, `processAdequate` is true, and `responseAdequateForOnTrack` is true.

Response cost never numerically cancels performance gain. Put both in machine-readable reasons.

**Done when.** Every verdict is reproducible from its input IDs, frozen evaluation revision, policy versions, explicit adequacy predicates and reason codes.

## OV5.4 `[ ]` Policy-version/planning-context segmentation

Include stable segments:

```ts
interface PolicySegment {
  startDate: string;
  endDate: string;
  policyVersion: string;
  planningMode: string;
  authoredPlanRef?: string;
}
```

If policy changes mid-block, show two segments. Do not pool them into a claim about one policy. If a metric comparison spans multiple policy segments, the `ProgressResult` remains policy-neutral and the report shows all segments. If historical policy context is missing, use an explicit unknown segment rather than inventing attribution.

This enables future longitudinal questions such as:

* did modification burden change after a policy revision?
* did blocks under a stable policy repeatedly meet their declared outcomes?

It does **not** make the comparison causal.

---

# OV6 — report/export and minimal UX

## OV6.1 `[ ]` Deterministic report + CSV/JSON export

Follow M5.3’s report-first precedent.

Add:

* `outcomes/blockOutcomeReport.ts` — deterministic row model;
* CSV export for metric-level progress;
* JSON export preserving nested provenance;
* exact evaluation revision/content hash;
* exact progress-policy and block-verdict-policy versions;
* source observation/session/recommendation/ecological-outcome IDs;
* policy segments, including explicit unknown/multiple segments rather than one synthetic policy attribution.

Suggested human-readable sections:

1. Goal and evaluation window
2. Primary outcomes
3. Secondary/context outcomes
4. Ecological competition outcomes
5. Training-process delivery
6. Recovery/response cost
7. Policy/planning segments
8. Verdict and reasons
9. Evidence limitations

No charts required for v1.

**Done when.** The same stored inputs produce byte-stable JSON (excluding explicitly volatile export timestamp if present) and deterministic row ordering.

## OV6.2 `[ ]` Minimal progress/report UI — usage-triggered depth

Initial UI:

* list active/completed outcome evaluations;
* show latest block verdict;
* metric rows with baseline/latest/change/comparability;
* ecological event result section;
* “why?” disclosure with protocol/reliability/reason details;
* export button.

Do not build a multi-chart analytics dashboard until repeated use identifies the actual questions.

Possible later trigger examples:

* athlete repeatedly asks for a 12-month 20-minute-power trend;
* comparing multiple protocols is common;
* block-to-block reports are being manually collated outside the app.

---

# OV7 — current cycling bootstrap

This makes the implementation real rather than architectural.

## OV7.1 `[ ]` Capture the current goal race as an ecological outcome

The current macrocycle’s primary target is an approximately 50-minute road race. Do not insert an unrelated maximal test battery into the decisive specific week/taper.

Create a frozen outcome evaluation revision linked to the event and capture a `CompetitionOutcome` with:

* event completion/result as the primary ecological endpoint;
* race power summary if available;
* race-derived duration powers labelled competition-derived, **not** inserted into protocol TT series unless protocol comparability is genuinely satisfied;
* tactical/execution note;
* source Garmin activity reference when available.

If race date/course changes, preserve the actual context and evaluation revision history.

**Done when.** The event can be included in the block report without pretending it is a standardized laboratory/TT benchmark.

## OV7.2 `[ ]` Post-event cycling baseline protocols

After the event and recovery, create the first compact repeated-test set for the next block.

### Protocol A — 20-minute TT

Primary stored metric:

```text
cycling_tt_20m_mean_power_w
```

Contract:

* fixed protocol revision;
* standardized warm-up;
* same primary power source/device;
* same indoor setup or sufficiently controlled course;
* same duration/start rule;
* validity + purpose (`familiarization/baseline/checkpoint/post_block`);
* consistent feedback rule;
* RPE/note as context.

Do not call raw P20 “FTP.”

### Protocol B — 4-minute TT

Metric:

```text
cycling_tt_4m_mean_power_w
```

Use the same provenance discipline and avoid placing it immediately adjacent to another maximal test unless the protocol explicitly controls recovery.

### Protocol C — low-burden submax checkpoint

Initial context metrics:

```text
cycling_submax_mean_hr_bpm
cycling_submax_rpe
```

Use a fixed workload/protocol chosen from the athlete’s normal equipment. The v1 report treats this as contextual evidence, not a substitute for maximal performance.

### Optional sprint metric

Do not add until sprint maintenance becomes a declared outcome for the next block.

**Done when.** At least one valid baseline attempt exists for the primary next-block cycling metric and the test burden did not distort the preceding goal event.

## OV7.3 `[ ]` First repeated comparison after 4–8 weeks

At the next block boundary:

1. repeat the same primary protocol;
2. keep protocol/device constant where practicable;
3. mark validity before seeing the progress verdict if feasible;
4. compute raw change;
5. show reliability context;
6. apply practical threshold only if declared in the frozen binding;
7. produce the first `ProgressResult`.

If a competition already supplies the goal’s primary endpoint, do not add redundant exhaustive tests merely to fill a database.

## OV7.4 `[ ]` First block readout and plan-adjustment note

Generate the first complete report:

```text
outcome evidence
+ process delivery
+ response cost
+ policy/planning context
= categorical block verdict + reasons
```

Then record a **human/external-plan decision note** for the next block:

* continue emphasis;
* change emphasis;
* maintain and retest;
* insufficient evidence — repeat with better protocol/adherence.

This note is not production engine policy.

---

# OV8 — later policy-version outcome analysis

## OV8.1 `[ ]` Multi-block policy-segment report

**Trigger:** multiple prospective blocks have comparable outcome evidence and stable policy-version segments.

Report:

* outcome success by block;
* adherence/process quality by block;
* modification/defer/skip burden;
* response cost;
* policy version/planning mode;
* measurement comparability/coverage.

Use descriptive single-athlete longitudinal language.

Allowed:

> “Three consecutive blocks under policy X achieved their declared primary outcome with high adherence and no increase in reactive responses.”

Not allowed:

> “Policy X caused 6% more fitness than policy Y.”

## OV8.2 `[ ]` Decide whether any outcome signal deserves planning authority

Possible outcomes:

1. **No ship:** outcome reporting remains human/external-plan evidence only.
2. **Advisory ship:** next-block authoring UI surfaces outcome evidence but makes no automatic change.
3. **Candidate policy:** one specific outcome-derived rule is proposed for measurement behind a default-off selector.

Option 3 requires:

* a separate ADR;
* exact policy candidate;
* prospective evidence plan;
* simulation/replay impact;
* Phase 9.0-style version boundary;
* explicit ship/no-ship decision.

There is no direct path from a successful block report to production automation.

---

## Initial statistical/interpretation policy

Keep v1 deliberately simple and inspectable.

### Comparison prerequisites

Two protocol observations may be progress-compared only when:

* same metric;
* both current valid benchmark revisions;
* same comparison-series key;
* same canonicalization version;
* units match;
* protocol revision matches or a specifically documented compatibility migration exists.

Competition outcomes do not pass through this comparator.

### Change

```ts
absoluteChange = latest.value - baseline.value;
percentChange =
  baseline.value === 0
    ? undefined
    : 100 * absoluteChange / Math.abs(baseline.value);
```

A zero baseline therefore never yields `Infinity`/`NaN`; use absolute or target-range interpretation instead. Direction is then applied from the frozen outcome binding.

### Reliability context

Do not hard-code a universal threshold.

V1 can use:

* literature reference reliability attached to the protocol;
* later, personal repeatability for the exact series.

If the statistic is not mathematically compatible with a chosen decision threshold, display it without converting it.

### Practical threshold

Optional and block-specific. If absent, do not invent one.

### Progress label

Implement as versioned pure policy. Start conservative:

* invalid/non-comparable → `non_comparable`;
* missing baseline/latest → `insufficient_evidence`;
* change clearly exceeds both available measurement-error context and declared practical threshold in the favourable direction → `meaningful_improvement`;
* favourable but not both → `possible_improvement` or `unclear_within_noise` depending on the reason;
* symmetric decline logic in the adverse direction;
* `context` bindings do not receive improvement/decline labels.

Every label carries machine-readable reasons so later policy revisions can be replayed.

---

## Test/verification matrix

### Unit tests

`observations/registry.test.ts`

* metric lookup;
* exact unit;
* unsupported metric rejection;
* `context_only` cannot become a primary/secondary outcome binding.

`observations/comparability.test.ts`

* same protocol/device → same series;
* changed series-defining device → new series;
* changed warm-up revision if declared material → new series;
* non-material/context-only note change → same series;
* canonical serialization key order does not change hash;
* changed canonicalization version does not silently compare with old keys.

`observations/observationRevision.test.ts`

* initial attempt+metric produces deterministic logical key/revision 1;
* exact retry is idempotent;
* conflicting retry requires correction;
* correction increments head exactly once;
* stale correction cannot advance the head;
* old revisions remain immutable/auditable.

`observations/progress.test.ts`

* higher-is-better and lower-is-better;
* valid target-range bounds and out-of-range rejection;
* zero baseline yields no percentage value;
* invalid attempt excluded;
* practice attempt excluded from benchmark selection;
* superseded revision excluded from current benchmark selection;
* non-comparable source → `non_comparable`;
* missing reliability → transparent insufficient/possible result;
* literature vs personal reliability provenance;
* practical threshold separate from measurement threshold;
* raw 20-minute power preserved independently of derived FTP estimate;
* pure progress has no recommender-policy attribution.

`outcomes/evaluationSpec.test.ts`

* declared baseline requires observation ID;
* first-valid baseline requires a window and deterministic earliest selection;
* context binding rejects outcome direction/threshold;
* target range requires finite ordered bounds and matching unit;
* activation freezes revision and metric bindings;
* later criteria change creates a new revision;
* report resolves exact evaluation revision/hash.

`outcomes/blockOutcome.test.ts`

* primary improvement + `processAdequate` + response coverage ≥ policy threshold → `on_track`;
* low process coverage → `insufficient_evidence`;
* positive outcome with low response coverage → `mixed`;
* conflicting primary/secondary outcomes → `mixed`;
* good outcome + repeated reactive response → `mixed`;
* primary decline + adequate evidence → `off_track`;
* missing/non-comparable primary test → `insufficient_evidence`;
* competition outcome appears separately from metric progress;
* policy change creates two segments while `ProgressResult` remains policy-neutral;
* no universal weighted score is produced.

### Firestore emulator

* cross-user reads/writes denied;
* protocol revision immutable after creation;
* malformed observation denied;
* source/attempt ownership enforced;
* deterministic initial observation accepted once;
* exact retry does not duplicate revision 1;
* correction chain/head advance enforced;
* stale correction denied;
* frozen evaluation revision/bindings immutable after activation;
* competition outcomes accepted without protocol fields and cannot contaminate protocol paths.

### Architecture tests

Fail on any runtime path from production selector modules to:

* `observations/progress`;
* `outcomes/blockOutcome`;
* block report services.

### Mobile/visual

390 px + desktop:

* scheduled test;
* protocol details;
* familiarization;
* invalid attempt;
* metric entry;
* correction flow;
* ecological outcome section;
* report row and details;
* offline completion/reconnect.

### End-to-end evidence scenarios

1. **20-minute repeat — valid:** same protocol/source, improvement is comparable.
2. **20-minute repeat — device changed:** result preserved, progress non-comparable/new series.
3. **Practice faster than baseline:** practice result does not become benchmark.
4. **Invalid faster result:** visible but excluded.
5. **Correction:** original revision remains; corrected revision becomes head exactly once.
6. **Offline retry:** attempt+metric idempotency prevents duplicate initial observations.
7. **Competition result:** appears as ecological outcome without protocol fields or TT-series contamination.
8. **Frozen criteria:** primary metric/direction/threshold/baseline cannot be rewritten after activation.
9. **Good performance / poor response:** block is mixed, not numerically “net positive.”
10. **Good process / no post-test:** insufficient evidence, not on-track by adherence alone.
11. **Low process coverage:** versioned adequacy policy yields insufficient evidence reproducibly.
12. **Policy change mid-block:** report shows separate policy segments; metric progress has no single policy attribution.
13. **Zero baseline:** absolute/target logic works without `Infinity`/`NaN`.
14. **Phase 9.0 active:** creating/reporting observations leaves recommendation outputs bit-identical.

---

## Implementation order and PR slicing

Do not merge one giant code PR. Dependency/startability and preferred PR order are separate: independent evidence-only work may be technically startable before it is the next chosen slice.

### PR A — contracts only — **merged 2026-08-21 (#154)**

* OV0.1–OV1.4;
* models/registry/protocol/comparability;
* explicit series canonicalization contract;
* architecture tests;
* no Firestore writes;
* no UI.

### PR B — persistence/manual entry — **implemented in #155**

* OV2.1–OV2.4;
* immutable observation revisions + head semantics;
* competition outcome persistence;
* rules + emulator;
* manual adapter;
* no progress labels yet.

### PR C — testing workflow

* OV3.1–OV3.4;
* existing runner integration;
* deterministic attempt+metric idempotency;
* correction flow;
* mobile acceptance.

### PR D — frozen evaluation contract + progress derivation

* OV5.1 first, because OV4 resolves its baseline/direction/practical-threshold contract from the frozen binding;
* OV4.1–OV4.3;
* pure tests;
* research-reference reliability metadata;
* zero-baseline handling;
* no recommender-policy attribution;
* no block verdict.

### PR E — process join and block report

* OV5.2–OV6.1;
* process/response join;
* deterministic adequacy policy;
* ecological outcomes;
* deterministic export;
* policy segmentation.

### PR F — minimal UI

Only after report/export is actually used and a visible product question remains.

### Operational evidence — no code PR required

* OV7.1 race outcome;
* OV7.2 post-event baseline;
* OV7.3 repeat;
* OV7.4 block readout.

The first meaningful success criterion is real prospective evidence, not six merged PRs.

---

## Verification commands

For every TypeScript increment:

```bash
cd app
npm run check
npm run build
```

For persistence/rules changes:

```bash
cd app
npm run test:rules
```

For any change that unexpectedly touches recommendation code:

```bash
cd app
npm run simulate:scenarios
npm run simulate:diff
node scripts/check-policy-drift.mjs <base-sha>
```

Expected result for OV evidence-only increments: **no production recommendation semantic drift**.

---

## Operational protocol governance

Every real test protocol should record before first benchmark use:

* purpose/metric;
* exact protocol revision;
* warm-up;
* expected equipment/source;
* environment/course constraints;
* feedback allowed during the test;
* familiarization rule;
* validity/invalidation rules;
* burden/recovery expectation;
* literature reliability reference if used;
* whether a practical threshold is declared;
* baseline selection rule;
* series-defining versus context-only dimensions;
* comparison-key canonicalization version.

Every block evaluation should record before activation:

* exact evaluation revision/content hash;
* primary/secondary/context roles;
* outcome direction or explicit target range;
* complete baseline-selection policy;
* target observation window;
* practical threshold if any;
* ecological event target if any.

When a material protocol condition changes, choose explicitly:

1. new protocol revision / comparison series;
2. keep old series because the dimension is declared non-material, with rationale.

Never decide after seeing which choice produces the more flattering progress result. Likewise, never rewrite an activated evaluation to make a completed outcome look better; create a new revision and preserve the limitation.

---

## Risks and mitigations

| Risk | Mitigation | Rollback/stop |
|---|---|---|
| Testing becomes training noise | schedule maximal tests at block boundaries; competition can replace testing; burden field | skip/defer the test, keep prior evidence |
| First-test learning looks like fitness | familiarization purpose/state; reliability context | mark first attempt practice/familiarization |
| Different devices create fake gains | explicit series-defining dimensions + canonicalization version | start new series; never delete old result |
| Canonicalization changes split/merge history silently | version key construction and persist the version | keep old keys; migration must be explicit |
| Literature CV treated as personal truth | explicit `literature_reference` provenance | show raw change only until personal evidence exists |
| FTP estimate becomes false authority | raw P20 canonical; derived estimate versioned | remove derived display without touching raw observation |
| Correction overwrites history | immutable revisions + transactional head pointer | retain old revision; reject stale head advance |
| Offline retry duplicates a benchmark | deterministic attempt+metric identity + create-if-absent | treat exact retry as success; conflict enters correction flow |
| Race data contaminates TT series | first-class `CompetitionOutcome`, no protocol fields | keep ecological evidence in separate collection/report section |
| Evaluation criteria are changed after seeing results | immutable activated evaluation revision + report snapshot/hash | create new revision and mark retrospective limitation |
| Outcome report becomes a universal score | categorical verdict + separate dimensions; no weighted roll-up | disable verdict and keep raw sections |
| Good result causes unsafe automation | architecture import guard + D-MPOLICY | evidence remains report-only |
| Outcome/testing scope explodes into a huge taxonomy | initial cycling registry only; M6 remains independently trigger-gated | reject unsupported tests until justified |
| Phase 9.0 evidence gets contaminated | evidence-only modules; no selector import; policy drift checks | end/version segment before any behaviour change |
| Race tactics/weather invalidate comparison | ecological outcome separate from protocol benchmark | treat as ecological outcome/context |
| Policy-version report is read causally | policy-neutral progress + explicit segment context + single-athlete limitation | report association only |
| Testing UI built before need | report-first cutline | stop at CSV/JSON/manual workflow |

---

## Stop conditions

Stopping is successful when the evidence question is answered without more product surface.

* **After OV2.** If manual entry + exported raw comparable data is already sufficient for the athlete, pause before runner integration.
* **After OV4.** If progress derivation answers the repeated-test question, defer block scorecard UI.
* **After OV6.1.** Keep report/export only until repeated use proves a dashboard question.
* **Before OV4.4.** Personal repeatability stays unbuilt until close-spaced repeated tests actually exist.
* **Before M6.** Keep M6 unstarted unless a selected test needs field/speed/jump context the generic runner cannot store.
* **At OV8.2.** “Keep outcome evidence human/external-plan only” is a valid final architecture state.

---

## Acceptance criteria

The task board above is the canonical per-item status source. This checklist is the
**whole-capability exit contract**: an unchecked later criterion does not reopen an already
completed OV0–OV2 task. Items are checked here only when the currently implemented repository
state already satisfies the criterion independently of unfinished later work.

### Measurement integrity

* [x] Raw metric revisions are immutable and never overwritten by corrections or derived estimates.
* [x] Every logical protocol observation has a stable attempt+metric identity, deterministic current revision and auditable supersession chain.
* [ ] Every benchmark revision has metric, unit, source/device, protocol revision, series key, canonicalization version, attempt and validity.
* [ ] Invalid/practice results stay visible but do not become default benchmarks.
* [x] Material protocol/device changes do not silently extend a comparison series.
* [x] Series-defining versus context-only dimensions are explicit and replayable.
* [x] Literature reliability is visibly different from personal repeatability.
* [x] No universal worthwhile-change percentage exists.
* [ ] Zero baselines never produce invalid percentage arithmetic.

### Product semantics

* [x] Decision, process/response and outcome evidence remain separate planes.
* [x] A competition result is a first-class ecological outcome, distinct from a protocol-locked test.
* [x] `context_only` metrics cannot be bound as primary/secondary outcomes.
* [ ] Target-range outcomes require explicit finite ordered bounds.
* [ ] Baseline selection is mechanically complete for every binding.
* [ ] Evaluation criteria are frozen before result interpretation and reports persist the exact evaluation revision/hash.
* [x] Raw 20-minute power is canonical; any future FTP estimate must be derived/versioned rather than replacing it.
* [ ] A block can be `mixed` without arithmetic cancellation of good performance and poor response.
* [ ] Missing/non-comparable outcome or inadequate process evidence yields `insufficient_evidence` under a versioned deterministic policy.
* [x] No universal performance score is introduced.

### Architecture safety

* [x] Production selection/ranking modules cannot import OV outcome-evidence modules at runtime without a separate architecture/ship decision.
* [x] OV0–OV2 leave production recommendation semantics unchanged; no selector/ranking authority consumes the new evidence.
* [x] User isolation, immutable protocol revisions and observation correction chains are emulator-tested.
* [ ] Activated evaluation revisions/bindings are immutable and emulator-tested.
* [ ] Pure metric progress carries derivation-policy versioning but no false single training-policy attribution.
* [x] A future outcome-to-planning automation requires a separate ADR and ship decision.

### Real-world evidence

* [ ] Current goal event is recorded as an ecological outcome without contaminating protocol series.
* [ ] A post-event cycling baseline is recorded under a stable protocol.
* [ ] The same primary protocol is repeated after a real block.
* [ ] First block report joins outcome + process + response + policy context.
* [ ] The next-block human/external-plan decision cites that report.

---

## Definition of “this capability worked”

Not:

> “We built a testing page.”

Not:

> “The engine agreed with AI 85% of days.”

Success is:

> A block begins with explicit, frozen outcome criteria; training is delivered and audited; the athlete completes a comparable post-block assessment or goal event; the system distinguishes real-looking change from measurement uncertainty without corrupting protocol series or rewriting history; and the resulting report is useful enough to inform the next block without silently turning itself into recommendation authority.

That is the missing feedback loop this plan is intended to close.
