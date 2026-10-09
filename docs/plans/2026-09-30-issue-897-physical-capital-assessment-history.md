# Issue #897 — Physical-capital assessment history implementation plan

**Date:** 2026-09-30
**Status:** In progress — [ADR-0046](../adr/0046-first-class-raw-assessment-trial-evidence.md) accepted 2026-09-30; PR A (WP0–WP3 domain foundation) merged (PR #942); PR B (WP4 bundled catalog, WP5 trial capture UX, WP7.2 diagnostic JSON export) merged (PR #944); PR C (WP6 assessment history, series comparability, WP7.1 normalized CSV export, WP3.4 body-mass context, Appendix A ADR-0047) merged (PR #948), followed by a post-merge review hardening of body-mass source selection and row-level series comparability. #897 was reopened on 2026-10-01 after the PR C merge auto-closed it: WP6.6 fixed-load velocity (design: [ADR-0047](../adr/0047-fixed-load-velocity-assessment-series.md)) is implemented and passed local verification/review; WP8 bounded consumer integration (#897 PR D) remains open unless those acceptance criteria are explicitly rescoped. PR B2 (WP5.5 WL Analysis per-frame CSV import) shipped in PR #963; parser-v2 rep-boundary hardening followed in PR #984.
**Authority boundary:** evidence-only under the existing OV authority boundary; ADR-0046 grants no recommendation authority
**Unlocks:** first-class multidomain physical-capital assessment capture, comparable history and normalized/diagnostic export without recommendation authority
**Canonical status owner:** [Performance outcome validation (OV)](./performance-outcome-validation.md); this document is a scoped #897 implementation design, not a parallel OV status board
**Companion analysis:** [2026-09-30-issue-897-physical-capital-assessment-integration.md](../analysis/2026-09-30-issue-897-physical-capital-assessment-integration.md)
**Primary issue:** #897
**Repository baseline:** `main@826d9aba845a8f3e4acaa94a173ece41b1906ef1`

---

## Objective

Make the existing Protocol testing workflow capable of storing, comparing, reviewing and exporting the planned October 2026 physical-capital baseline and later repeat checkpoints.

The implementation must extend the existing Performance Outcome Validation architecture rather than create a parallel subsystem. Actionable status remains in the canonical OV plan; with ADR-0046 accepted, implementation work is tracked there/#897 rather than creating an independent competing task board.

The first complete user journey is:

> choose a standardized physical-capital test → execute it through the existing session runner → capture all protocol trials → persist a canonical benchmark → repeat the same protocol later → see whether the new result is comparable and how it changed → export the evidence.

---

## Success criteria

The slice is complete when all of the following are true:

- [x] Bench 1RM can be run as a bundled standardized assessment.
- [x] Back-squat 1RM can be run as a bundled standardized assessment.
- [x] Standing broad jump can be run and all trials are retained.
- [x] Wall-touch CMJ can be run and all trials are retained.
- [x] 3 kg seated medicine-ball throw can be run and all trials are retained.
- [x] 3 × 6 s seated cycling sprint can store all three trials plus canonical 1 s peak and 5 s mean power.
- [x] Strength attempts can store load-by-load WL Analysis velocity evidence without making app-derived e1RM authoritative.
- [x] Historical protocol revisions remain immutable.
- [x] Repeating a compatible protocol produces an explicit longitudinal comparison.
- [x] Incompatible protocol/setup changes produce `non_comparable` or a separate series rather than a false numerical trend.
- [x] Assessment history shows baseline/latest/change/comparability.
- [x] Normalized CSV export works.
- [x] Diagnostic JSON export retains protocol, trials, canonical observations and provenance.
- [x] Existing cycling tests continue to work without data migration.
- [x] No assessment is double-counted as two physical sessions.
- [x] No recommendation-selection authority is added.

---

# Work package overview

| WP | Scope | Blocked by | Unlocks | Outcome |
|---|---|---|---|---|
| WP0 | Contract decisions + fixtures | — (ADR-0046 accepted) | WP1–WP5 contract implementation | lock exact October protocols and persistence semantics |
| WP1 | Metric + comparison vocabulary | WP0.1–WP0.2 | WP4 protocol persistence; WP6 comparability | multidomain physical-capital metrics become valid observations |
| WP2 | Raw trial evidence model | WP0.1 | WP3 derivation; WP5 capture; WP6/WP7 audit surfaces | repeated attempts and load/velocity rows are first-class |
| WP3 | Canonical summary derivation | WP0.2; WP1.1; WP2.1–WP2.4 | WP5 completion; WP6 history; WP7 export | best valid / highest valid result becomes benchmark with provenance |
| WP4 | Bundled test catalog | WP0; WP1; WP4.0 safety boundary | WP5 athlete-facing capture | six October assessment protocols available from Testing |
| WP5 | Capture UX | WP2 persistence/validation; WP3.2 provenance; relevant WP4 protocols | first athlete-usable October capture; WP6/WP7 | efficient test-specific trial/result capture |
| WP6 | Assessment history + progress | WP3.2; WP5; existing `deriveProgress()` contracts | WP7 summary export; WP8 bounded consumers | baseline/latest/comparability becomes visible |
| WP7 | Export | WP3.2; WP6.1/WP6.4 for summary progress; WP2.3 for raw diagnostic evidence | auditable external-coach handoff | CSV + diagnostic JSON |
| WP8 | Context/goal integration | WP6.4 plus each existing goal/block/context authority contract | bounded feedback-loop reuse | bounded consumption by existing OV/goal surfaces |
| WP9 | Verification + docs | co-delivered with the implementation work it verifies | merge/#897 closure evidence | backward compatibility, emulator/E2E, architecture docs |

For the **19–25 October capture cutline**, the critical path is WP0–WP5 plus the diagnostic-export part of WP7 so the first real baseline can be preserved and audited correctly. A polished WP6 history surface may follow without risking capture of that evidence, but #897 remains open until its history/comparability, fixed-load-velocity and other acceptance criteria are actually satisfied. WP8 may be split into a follow-up PR if it expands scope materially.

---

# WP0 — Lock contracts before implementation

## WP0.1 Add protocol fixtures to tests first

**Blocked by:** nothing (ADR-0046 accepted 2026-09-30).
**Unlocks:** WP0.2, WP0.3, WP1.1, WP1.2, WP2.1 and WP4.0.

Create protocol definitions that represent the intended October protocols before adding UI.

Delivered module:

`app/src/observations/physicalCapitalProtocols.ts`

*(Implemented deliberately as a production module in `app/src/observations/` rather than under `__fixtures__/` so PR B's catalog imports the exact same pinned protocol objects without duplicating definitions).*

Protocols:

- bench 1RM (`BENCH_PRESS_1RM_PROTOCOL`);
- back-squat 1RM (`BACK_SQUAT_1RM_PROTOCOL`);
- standing broad jump (`STANDING_BROAD_JUMP_PROTOCOL`);
- wall-touch CMJ (`WALL_TOUCH_CMJ_PROTOCOL`);
- 3 kg seated medicine-ball chest throw (`SEATED_MEDBALL_THROW_PROTOCOL`);
- 6 s seated cycling sprint (`CYCLING_6S_SEATED_SPRINT_PROTOCOL`).

The definitions pin:

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

**Blocked by:** WP0.1 protocol fixtures define the target capture contracts.
**Unlocks:** WP3.1, WP4 reducer bindings and WP5.1 protocol-driven capture.

Add a small pure contract for how trial evidence becomes the canonical result.

Delivered reducer kinds in `app/src/observations/models.ts` and `assessmentReducers.ts`:

```ts
export type AssessmentReducer =
    | { kind: 'max_valid'; metricId: string; fieldId: string }
    | { kind: 'highest_successful_load'; metricId: string; loadFieldId: string; successFieldId: string }
    | { kind: 'max_valid_difference'; metricId: string; minuendFieldId: string; subtrahendFieldId: string };
```

*(Note: the initially sketched `identity` reducer was not needed; `max_valid_difference` was added for wall-touch CMJ where standing reach is recorded as a trial field and subtracted from touch height to yield the canonical CMJ jump height).*

Do not make this generic enough to become an analytics DSL. It exists only to make bundled protocol summary semantics explicit and testable.

The semantic capture schema and reducer declarations must be owned by the immutable `MeasurementProtocol` revision, as an additive optional capture field on the protocol revision document itself (ADR-0046 D-AT-PROTOCOL; no companion document). Additive optional fields preserve old summary-only protocols. `PerformanceTestDefinition` may add presentation/layout hints, but it must not be the sole owner of field identity/type/unit or reducer semantics; otherwise a catalog update could reinterpret historical trials.

Whichever immutable storage shape is selected must be admitted and bounded by `app/firestore.rules` as well as TypeScript validation. The current measurement-protocol rule has a strict field allowlist, so adding optional capture/reducer metadata only to `MeasurementProtocol` would otherwise fail at persistence time.

## WP0.3 Preserve old sprint protocol

**Blocked by:** current immutable `cycling-5s-peak-power` revision 1 remains the regression fixture.
**Unlocks:** WP4.6 can add the new 6 s sprint without rewriting historical semantics.

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
- `app/firestore.rules`
- `app/src/emulator/performanceOutcomeRules.emulator.test.ts`
- associated unit tests

## WP1.1 Add canonical metrics

**Blocked by:** WP0.1 establishes the concrete protocol outputs.
**Unlocks:** WP1.3, WP4 protocol persistence and WP3 canonical reducers.

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

**Persistence parity requirement:** the current Firestore rules keep their own hard-coded outcome-metric/unit allowlists and measurement-protocol metric allowlist. WP1.1 must update those allowlists and emulator fixtures in the same delivery as the TypeScript registry. In particular, `strength_1rm_kg` being present in `registry.ts` is not sufficient by itself for #897 persistence.

**Pre-existing rules/registry drift fix:** prior to Issue #897 / ADR-0046, `strength_1rm_kg`, `sprint_elapsed_time_s`, `cycling_5s_peak_power_w` and dimension `timing_method` existed in TypeScript but were omitted from the production `firestore.rules` allowlist, preventing bundled persistence of those metrics. The rules and TypeScript registry now share strict parity via `firestore.rules` `outcomeMetricUnits()` and `comparisonDimensionIds()`, verified by `firestoreRulesParity.test.ts`.

## WP1.2 Add only required comparison dimensions

**Blocked by:** WP0.1 defines material setup/method identity.
**Unlocks:** WP1.3, WP4 protocol persistence and WP6.4 comparability.

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

The Firestore `hasValidMeasurementProtocol` comparison-dimension allowlist must be extended in lockstep with `ComparisonDimension`; otherwise application validation can accept a protocol that production rules reject.

## WP1.3 Tests

**Blocked by:** WP1.1 and WP1.2.
**Unlocks:** WP4 and WP6 can rely on the expanded metric/comparison contract.

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

**Blocked by:** WP0.1 pins the bounded trial-capture semantics.
**Unlocks:** WP2.2–WP2.5 and WP3 trial-derived summaries.

Add a bounded raw evidence contract in `app/src/observations/models.ts` and `assessmentTrials.ts`.

Delivered shape:

```ts
export type AssessmentTrialScalar = number | boolean;

export interface AssessmentTrial {
    id: string;
    assessmentAttemptId: string;
    ordinal: number;
    correctionIndex: number;
    supersedesTrialId?: string;
    correctionReason?: string;
    performedAt?: string;
    validity: ObservationValidity;
    invalidReason?: string;
    /** Values keyed by protocol capture field id; units and bounds are owned by the capture field definition. */
    values: Readonly<Record<string, AssessmentTrialScalar>>;
    context: ObservationContext;
    sourceRef?: string;
    device?: MetricObservationDevice;
    notes?: string;
    createdAt: string;
}
```

*(Note: `values` is a `Readonly<Record<string, AssessmentTrialScalar>>` map keyed by field id rather than an array of `{ fieldId, value, unit }` objects; units and bounds are defined once on the immutable protocol revision's capture schema rather than duplicated per trial value. Document ID is deterministic `trial-${ordinal}` / `trial-${ordinal}-c${correctionIndex}` derived from `ordinal` and `correctionIndex`, with `supersedesTrialId` linking the append-only supersession chain).*

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

**Blocked by:** WP2.1.
**Unlocks:** WP2.3, WP2.5, WP5.1, WP6.1 and WP7.2.

Recommended Firestore shape:

```text
users/{userId}/assessment_attempts/{attemptId}/trials/{trialId}
```

A trial record is immutable after creation. Correction support is required for the first athlete-usable slice: create a new immutable trial that names `supersedesTrialId` and a non-empty correction reason. Reducers use the latest unsuperseded record for each ordinal. Correcting only the canonical observation while leaving incorrect source trials in place is not acceptable provenance.

Trial writes follow the parent attempt lifecycle (ADR-0046 D-AT-CORRECTION): none while `scheduled` or `abandoned`; new ordinals and supersessions while `in_progress`; supersessions only once `completed`. A post-completion correction that changes a reducer output or its source references also appends a canonical observation revision through the existing `appendCorrection` path. Rules deny trial `update`/`delete`.

## WP2.3 Service

**Blocked by:** WP2.1, WP2.2 and WP2.4.
**Unlocks:** WP3.2, WP5.1, WP6.1 and WP7 diagnostic export.

Add:

`app/src/services/assessmentTrialService.ts`

Required methods:

- `createTrial`;
- `listTrialsForAttempt`;
- optionally `getTrial`.

Do not add global unbounded scans.

## WP2.4 Validation

**Blocked by:** WP2.1 and WP0.1.
**Unlocks:** WP2.3, WP2.5 and WP3 reducer safety.

Fail closed on:

- duplicate trial IDs;
- ordinal < 1;
- field not declared by the protocol capture schema;
- wrong field type/unit;
- invalid attempt identity;
- invalid state/reason combinations;
- non-finite values;
- duplicate field IDs within one trial unless the capture schema explicitly allows them;
- broken supersession chains or missing correction reasons;
- superseding a trial from a different assessment attempt or a different ordinal;
- correction forks that would leave more than one active head for an ordinal;
- cycles or ambiguous active-trial resolution.

## WP2.5 Security rules + emulator tests

**Blocked by:** WP2.2 and WP2.4.
**Unlocks:** Athlete-facing trial persistence in WP5 and auditable reads in WP6/WP7.

Add Firestore rules equivalent to other athlete-owned assessment evidence.

Emulator tests must prove:

- user A cannot read/write user B trials;
- invalid schema is rejected;
- historical trial cannot be silently rewritten if immutability is enforced at rules/service level.

---

# WP3 — Derive canonical benchmark observations from trials

## WP3.1 Pure reducer functions

**Blocked by:** WP0.2, WP1.1, WP2.1 and WP2.4.
**Unlocks:** WP3.2 and computed canonical results in WP5.

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

**Blocked by:** WP3.1 plus WP2 persistence/service.
**Unlocks:** WP5 completion, WP6 history/progress and WP7 exports.

The canonical `MetricObservationRevision` should state that it was derived from trial evidence rather than typed as a free-standing manual summary.

Preferred approach:

- add an optional typed field such as `derivedFromEvidenceRefs` to `MetricObservationRevision`;
- in the first slice, support an assessment-trial reference carrying `kind: 'assessment_trial'`, `assessmentAttemptId` and `trialId`;
- preserve existing `derivedFromObservationIds` for observation-to-observation provenance and historical derived observations;
- store `algorithmVersion`, e.g. `assessment-reducer-v1`.

Do not put trial IDs into `derivedFromObservationIds`; that field promises observation identities.

The provenance validator contract is explicit:

- a trial-only `source: 'derived'` revision is valid when it has a non-empty typed trial-evidence list plus `algorithmVersion`;
- an observation-derived revision continues to require non-empty `derivedFromObservationIds`;
- a mixed derivation retains both forms when it truly consumes both source kinds;
- trial references are unique and their `assessmentAttemptId` must equal the canonical observation's `assessmentAttemptId`;
- a non-derived revision may contain neither derivation field;
- existing historical observation-derived revisions remain valid without migration.

Implement this in `models.ts`, `assertValidMetricObservationRevision`, `app/firestore.rules`, and matching unit/emulator tests in the same PR. The Firestore observation-revision field allowlist and derived-source predicate currently require `derivedFromObservationIds`, so changing TypeScript alone would still make trial-derived writes fail in production.

`observationCanonical.ts` already canonicalizes the full semantic revision payload generically; add regression tests proving typed evidence-reference changes are semantic conflicts while exact retries with the same refs remain idempotent.

Do not weaken validation just to fit the new source.

## WP3.3 Manual fallback

**Blocked by:** WP3.2.
**Unlocks:** Backward-compatible custom/advanced summary capture without weakening bundled trial-driven defaults.

A manually entered canonical result can remain supported for advanced/custom protocols, but bundled physical-capital protocols should default to trial-driven summary derivation.

## WP3.4 Source-specific body-mass-relative context

**Blocked by:** WP3.2 and implemented ADR-0039 source-specific body-mass semantics.
**Unlocks:** Auditable W/kg/body-mass-relative context without duplicate weight truth.

For sprint W/kg and body-mass-relative squat/bench context, reuse ADR-0039 rather than creating a Testing-owned weight field.

- select an acceptable same-day body-mass point from one explicit source series;
- retain its source/reference alongside the derived relative value;
- never average or silently switch between provider/manual body-mass series;
- keep the derived relative value context-only in the first slice;
- if no acceptable same-day point exists, leave the relative value unavailable.

Do not require duplicate manual weight entry merely to complete an assessment.

*(PR B status: WP3.4 body-mass-relative W/kg and strength ratios are moved to PR C alongside history and progress reporting.)*

---

# WP4 — Add bundled physical-capital protocols

## WP4.0 Shared safety and invalidation boundary

**Blocked by:** existing session/constraint execution pathways.
**Unlocks:** WP4.1–WP4.6 reusable protocol definitions.

The reusable bundled protocols must encode test-specific execution safety without inventing medical clearance:

- maximal bench/squat instructions require rack safeties and/or a competent spotter as appropriate;
- assisted bar contact, invalid depth/technique or other protocol-defined technical failures remain raw invalid/missed evidence and never become the canonical 1RM;
- protocol invalidation remains fail-closed for the explicit rules attached to that immutable revision;
- an active clinician restriction or other safety constraint reaches Testing through the repository's existing validated constraint/session-execution pathway, not through a new diagnosis/clearance field in assessment evidence;
- the athlete-specific 13 October 2026 cardiology/CPET checkpoint is execution context for this baseline, not a date hard-coded into a generic protocol.

**PR B safety investigation finding:** `sessionAuthoringService.prepareUnplannedSessionLaunch` validates the session definition and launches an unplanned execution with authority `unplanned_log` without consulting an existing injury, constraint, or clinician-clearance gate. Per architectural constraints, no medical diagnosis or clearance field was invented; protocol-level safety instructions (e.g. rack safeties and spotter requirements) are rendered directly on the Testing ready screen before confirmation.

### PR B review correction — immutable protocol revision 2

PR A published the six physical-capital capture contracts as revision 1. During PR B review, the athlete's active v1.6 October execution document was cross-checked against those immutable revisions and exposed material execution mismatches: the bench pause/two-miss stop rule, the squat's athlete-declared repeatable depth standard, and the cycling sprint's 15–20 minute warm-up, ~5 minute recovery and no-ERG rule. Because ADR-0046 makes a published `MeasurementProtocol` revision immutable, revision 1 is retained byte-for-byte for historical evidence and the bundled October workflow advances to revision 2. Field-test setup details that materially affect repeatability are likewise made explicit in revision 2.

Diagnostic export must enumerate every supported immutable revision and join attempts only to the exact `protocolRef.revision`; familiarization-purpose evidence is stored but is never eligible to become an implicit longitudinal baseline.

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

**Blocked by:** WP0.1–WP0.2, WP1.1–WP1.2 and WP4.0.
**Unlocks:** WP5.2 bench capture and the October strength baseline.

ID:

`strength-bench-press-1rm-r2`

Protocol reference:

`{ id: 'strength-bench-press-1rm', revision: 2 }`

Metric:

`strength_1rm_kg`

Session blocks:

- warm-up;
- progressive test attempts;
- optional cool-down.

The runner must not prescribe fixed maximum attempt weights. Attempt selection remains athlete-controlled.

## WP4.2 Back-squat 1RM

**Blocked by:** WP0.1–WP0.2, WP1.1–WP1.2 and WP4.0.
**Unlocks:** WP5.2 squat capture and the October strength baseline.

ID:

`strength-back-squat-1rm-r2`

Protocol reference:

`{ id: 'strength-back-squat-1rm', revision: 2 }`

Same design principles as bench.

## WP4.3 Standing broad jump

**Blocked by:** WP0.1–WP0.2, WP1.1–WP1.2 and WP4.0.
**Unlocks:** WP5.3 field-power capture.

Definition ID: `field-standing-broad-jump-r2`

Protocol reference: `{ id: 'field-standing-broad-jump', revision: 2 }`

Three maximal valid attempts after warm-up/familiarization.

Canonical = best valid distance.

## WP4.4 Wall-touch CMJ

**Blocked by:** WP0.1–WP0.2, WP1.1–WP1.2 and WP4.0.
**Unlocks:** WP5.3 field-power capture.

Definition ID: `field-wall-touch-cmj-r2`

Protocol reference: `{ id: 'field-wall-touch-cmj', revision: 2 }`

Capture:

- standing reach context/measurement;
- three maximal jumps;
- calculated jump height.

If standing reach is treated as trial context rather than a canonical performance metric, document that choice.

## WP4.5 3 kg seated medicine-ball throw

**Blocked by:** WP0.1–WP0.2, WP1.1–WP1.2 and WP4.0.
**Unlocks:** WP5.3 upper-body ballistic-power capture.

Definition ID: `field-seated-medball-chest-throw-3kg-r2`

Protocol reference: `{ id: 'field-seated-medball-chest-throw-3kg', revision: 2 }`

Three maximal valid attempts.

Canonical = best valid distance.

## WP4.6 6 s seated cycling sprint

**Blocked by:** WP0.1–WP0.3, WP1.1–WP1.2 and WP4.0.
**Unlocks:** WP5.4 cycling-sprint capture without mutating the old 5 s protocol.

Definition ID: `cycling_6s_seated_sprint-r2`

Protocol reference: `{ id: 'cycling-6s-seated-sprint', revision: 2 }`

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

**Blocked by:** WP4.1–WP4.6.
**Unlocks:** Discoverable grouped athlete-facing assessment catalog.

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

**Blocked by:** WP2.3–WP2.5, WP3.2 and at least one implemented WP4 trial protocol.
**Unlocks:** WP5.2–WP5.6 and the first athlete-usable multi-trial workflow.

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

Persist/version this on the protocol revision document itself (ADR-0046 D-AT-PROTOCOL). Keep the shape bounded and declarative. Old protocols without this field retain the existing summary-input workflow.

## WP5.2 Strength trial row

**Blocked by:** WP5.1 plus WP4.1–WP4.2.
**Unlocks:** Bench/squat load-by-load capture and canonical 1RM derivation.

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

**Blocked by:** WP5.1 plus WP4.3–WP4.5.
**Unlocks:** Broad-jump, CMJ and medicine-ball baseline capture.

Simple table:

| Trial | Result | Validity |
|---|---:|---|

Display computed best valid result before save.

## WP5.4 Cycling sprint capture

**Blocked by:** WP5.1 plus WP4.6.
**Unlocks:** Three-trial cycling sprint capture with separate canonical 1 s/5 s outputs.

Table:

| Trial | 1 s peak W | 5 s mean W | peak cadence | L/R balance | validity |
|---|---:|---:|---:|---|---|

Display both canonical results before save.

## WP5.5 Device provenance

**Blocked by:** WP2.1 and WP5.1.
**Unlocks:** Comparable device/setup evidence for reducers, history and export.

Allow a default device for the attempt plus optional trial override.

Examples:

- power meter;
- WL Analysis;
- measurement method.

Do not require duplicate device typing on every trial when unchanged.

The agreed October execution protocol also requires raw videos to be preserved. #897 should not invent a one-off media store to satisfy that operational rule. Until a generic durable attachment/provenance contract is accepted, protocol copy/checklists should remind the athlete to preserve the raw videos outside OV, and the product must not imply that those videos are stored merely because numeric WL Analysis/trial evidence is present. A future attachment reference must be source-scoped and replay-stable rather than an ad hoc filename field.

**WL Analysis per-frame CSV import (#897 PR B2, shipped in PR #963):** governed by [ADR-0046](../adr/0046-first-class-raw-assessment-trial-evidence.md) D-AT-IMPORT (amended 2026-10-01). The athlete films each squat/bench attempt, exports one per-frame CSV per video and imports the files on the capture screen, so `load_kg`, `mean_concentric_velocity_mps` and `peak_velocity_mps` are filled without hand-typing. A versioned, local-only parser segments repetitions from per-frame velocity and displacement (the whole-recording summary block is never used), records its parser version in trial context and identifies each file by content digest in the trial `sourceRef`. The adapter fails closed unless the immutable capture schema declares the full expected WL fields/units and rejects repeated raw-file digests, including duplicates selected in the same batch. The source weight cell is unitless and ascent completeness cannot prove technical validity, so imported rows carry a local review gate: the final save is blocked until the athlete explicitly confirms kilograms, inferred success/miss where present, and technical validity. This is the replay-stable source reference this section anticipated; no video or file is stored.

Athlete checklist for importable recordings: one video per attempt; WL Analysis tags `attempt N`; per-frame export enabled with velocity and displacement (power/force are modelled from a constant load and are ignored, and are wrong with chains or bands); kilograms if WL Analysis offers a unit setting; fixed side-on tripod position; keep the raw .mp4 and CSV outside the app.

**Offline boundary for the real gym flow:** file parsing and the UID-scoped unsaved trial draft are local, so imported rows can survive a reload while browser storage remains available. The final assessment commit intentionally keeps the existing transaction-backed trial/observation/attempt integrity path. Firestore client transactions do not complete offline, so an offline final-save failure must leave the draft intact and be retried after connectivity returns; PR B2 does not weaken atomicity by replacing that commit with non-transactional writes. A general queued transactional/outbox design, if desired, belongs with the broader durability work rather than being silently invented inside this importer.

**PR B follow-up (trial correction integrity):** In `assessmentCaptureService.correctTrial`, if an athlete supersedes a trial (e.g. marking it invalid or practice) such that a previously benchmarked metric now has no valid trials remaining, the service fails closed with an informative error. The candidate trial set is derived in memory first; accepted corrections then use `AssessmentTrialService.commitCorrection` so the superseding trial plus all changed/new canonical observation revisions and heads commit in one Firestore transaction. A stale concurrent head or interrupted write therefore cannot leave the raw correction only partly reflected in canonical benchmarks. An explicit observation benchmark invalidation workflow is still a separate follow-up for intentionally removing the last valid benchmark.

## WP5.6 Mobile usability

**Blocked by:** WP5.2–WP5.5.
**Unlocks:** Real gym/field acceptance for the October baseline.

Testing will often occur in a gym/field setting on a phone.

Requirements:

- numeric keyboard;
- large touch targets;
- minimal horizontal scrolling;
- retain entered trials through temporary stage changes;
- clear invalid/practice controls;
- no requirement to type protocol IDs in the normal bundled flow.

## WP5.7 One physical workout, one completed-training exposure

**Blocked by:** WP5.1, WP2.3 and the existing performed-training reconciliation path.
**Unlocks:** E2E proof that assessment evidence does not double-count physical work.

The assessment attempt/trial/observation records are evidence sidecars to the `SessionRunner` execution. They must not create another completed workout. Verify the current performed-training reconciliation path rather than assuming proposed ADR-0034 semantics are automatically active everywhere.

Required invariant:

`one physical testing session -> at most one completed-training/history exposure`

This must hold when the structured testing execution and a provider activity both exist.

**PR B reconciliation verification finding:** Traced `matchExecutionsToGarminActivities` in `app/src/sessions/reconciliation.ts`: session executions launched from testing specify modality (`cycling`, `strength`, `field`) and matching same-day Garmin activities within 20m tolerance reconcile to a single exposure. Assessment attempts, trials, and observations write strictly to user subcollections (`assessment_attempts`, `assessment_attempts/{id}/trials`, `metric_observations`) and create zero additional completed workout or occurrence records. Pinned by unit tests in `testingReconciliation.test.ts`.

---

# WP6 — Assessment history and progress

## WP6.1 Read model

**Blocked by:** WP2.3, WP3.2 and existing current-observation/progress contracts.
**Unlocks:** WP6.2–WP6.5 and WP7 summary export.

Add an athlete-scoped assessment history service/read model that joins:

- completed attempts;
- protocol;
- current canonical observation revisions;
- progress result;
- optional trial count/provenance summary.

Avoid N+1 unbounded scans. The initial implementation may fetch a bounded date window or metric family.

**PR #948 review clarification:** the list read path queries attempts by protocol ID and current observation
head/revision pairs by metric ID, performs **zero raw-trial reads**, and does not re-fetch an observation head
after its current revision has been resolved. Series are grouped by the complete D1 identity
`(protocolId, protocolRevision, metricId, comparisonSeriesKey)`; multi-metric protocols never share one
baseline/latest series.

## WP6.2 UI location

**Blocked by:** WP6.1.
**Unlocks:** One bounded athlete-facing history surface.

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

**Blocked by:** WP6.1, WP2.3 and WP3.2.
**Unlocks:** Auditable raw-trial/correction/reducer drill-down.

Expand to show:

- exact protocol ID/revision;
- comparison context;
- raw trials;
- device/source;
- notes;
- correction history;
- reducer/source trials.

## WP6.4 Comparability

**Blocked by:** WP1.2, WP6.1 and existing `deriveProgress()` semantics.
**Unlocks:** WP6.5, WP7 progress export and WP8 bounded consumers.

Use `deriveProgress()` for canonical metrics.

Do not invent another progress engine.

If the same display test was performed under an incompatible protocol revision or comparison series, show:

`not comparable`

not:

`0% change`.

## WP6.5 Baseline semantics

**Blocked by:** WP6.1 and WP6.4.
**Unlocks:** Honest baseline/latest presentation without mutating OV contracts.

For the October battery, `purpose=baseline` is the natural initial reference.

Do not hard-code “first observation forever” as baseline. Existing declared/window baseline semantics should remain available for goals/block reviews.

The history UI may default to earliest valid baseline-purpose observation for convenience, but that is a presentation choice, not a mutation of outcome contracts. Familiarization evidence remains visible/auditable but is excluded from both baseline selection **and** longitudinal latest/progress selection.

## WP6.6 Fixed-load velocity acceptance boundary

**Status:** Implemented; focused and full local verification and independent review passed. WP8 remains open, so this slice references #897 without closing it.

[ADR-0047](../adr/0047-fixed-load-velocity-assessment-series.md) Option A supplies dedicated revision-1 bench-press and back-squat fixed-load velocity tests. The metric `strength_fixed_load_mean_velocity_mps` and required `test_load_kg`, `measurement_method_id` and `equipment_setup_id` dimensions follow registry/rules parity. The existing `max_valid` reducer selects the highest eligible mean velocity with deterministic trial provenance after pure validation checks exact load, success and actual method. Practice/invalid rows remain audit evidence; corrections keep the original series identity and commit raw/canonical changes atomically.

Both protocols enter the existing Testing catalog, history, normalized CSV and diagnostic JSON inventories. WL v1/v2, manual and configuration-specific OpenBar methods establish separate series; raw 1RM velocities do not populate them. Progress retains the existing insufficient-evidence reporting when reliability is absent.

The existing UID/attempt-scoped local draft now retains comparison setup and default device alongside rows, including imported provenance/review flags, with legacy row-array compatibility. This is conditional browser recovery, not guaranteed offline durability. Final save still uses the multi-stage transaction-backed integrity path and needs connectivity. Architecture-level capture/outbox work remains coordinated with #895.

---

# WP7 — Export

## WP7.1 Normalized CSV

**Blocked by:** WP3.2, WP6.1 and WP6.4.
**Unlocks:** Spreadsheet/pandas-friendly comparable assessment export.

Add the assessment export under the OV evidence boundary, for example:

`app/src/observations/assessmentExport.ts`

Reuse the deterministic CSV/JSON ordering and canonicalization conventions already established by `app/src/outcomes/blockOutcomeReport.ts`; do not create another progress interpretation path in a generic `utils` module.

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

**Blocked by:** WP2.3 and WP3.2. Delivered in PR B, before the WP6.1 read model exists: it reads the bounded attempts/trials/observations directly and computes `progress` with the existing `deriveProgress()`. After WP6.1 lands, diagnostic export reuses the same D1 series identity/progress derivation and avoids duplicate per-revision attempt queries, but it deliberately retains separate **detail** reads for raw trials and complete observation revision chains because the lightweight History list must not load those records eagerly.
**Unlocks:** Auditable external-coach/agent reconstruction of protocols, trials and canonical results.

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

**Blocked by:** WP7.1 plus demonstrated user need; otherwise deferred.
**Unlocks:** Convenience pivot only, never a canonical evidence format.

Defer unless trivial after normalized export lands.

If added, label it explicitly as a convenience pivot, not the canonical export.

---

# WP8 — Bounded integration with goals / block outcomes / context brief

This work should reuse existing OV and PG contracts.

## WP8.1 Typed performance goals

**Blocked by:** WP6.4, ADR-0041 and an explicit reviewed exercise-mapping/resolver bridge for measured squat/bench 1RM.
**Unlocks:** Measured assessment evidence can satisfy supported typed goals without conflating tested 1RM with e1RM.

Do not assume all canonical assessment observations already satisfy typed goals.

Current ADR-0041 behavior differs by subject kind:

- `performance_test` targets can resolve current measured `MetricObservationRevision` evidence through the bound performance-test protocol;
- `exercise` strength targets currently resolve current capability from `AthletePerformanceProfile.estimated1RmKg`, not from measured assessment observations.

Therefore squat/bench 1RM evidence needs an explicit bridge if it is to satisfy an exercise-subject goal. The implementation must either add a reviewed mapping from the bundled strength test to the canonical exercise identity and extend goal-progress resolution while keeping measured 1RM distinct from e1RM, or leave measured squat/bench assessment evidence outside typed-goal progress in the first slice.

Protocol reference alone does not solve exercise subject identity. New jump/throw/sprint metrics should become goal-eligible only when a real typed-goal use case is declared; assessment metrics do not automatically become goal metrics.

The first athlete-usable baseline slice may ship before the strength-goal bridge, but #897's typed-goal acceptance criterion remains open until a reviewed mapping/resolver path is implemented or the issue scope is explicitly amended. Do not silently mark the requirement complete.

Do not make target values alter assessment protocols.

## WP8.2 Block review

**Blocked by:** WP6.4 plus existing OV5 evaluation/report contracts and real comparable post-block evidence.
**Unlocks:** Evidence-only block outcome statements; no causal or prescription authority.

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

**Blocked by:** WP6.4 plus the versioned Context Brief contract and a relevant active goal/block intent.
**Unlocks:** Compact current benchmark/trend evidence in planning context without raw-table explosion.

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

**Blocked by:** each verification slice is co-delivered with the implementation item it verifies; full closure depends on every in-scope acceptance criterion.
**Unlocks:** merge confidence and #897 closure evidence without treating tests as a separate late phase.

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
- trial-only derived observations pass the TypeScript validator and Firestore rules without fake `derivedFromObservationIds`;
- legacy observation-derived revisions still require/accept non-empty `derivedFromObservationIds`;
- non-derived observations reject both derivation provenance forms;
- exact retries with identical typed evidence refs remain idempotent while changed refs conflict;
- assessment completion is not accepted as valid benchmark if required canonical derivation fails;
- one testing execution contributes at most one completed-training exposure even when provider activity evidence is also present.

## Emulator tests

- Firestore ownership;
- immutable protocol;
- protocol capture-schema/reducer metadata is accepted only under the bounded immutable schema;
- new metric/unit and comparison-dimension allowlists stay in parity with application validation;
- trial write rules;
- trial-only derived observation provenance is accepted only through bounded typed trial refs;
- legacy observation-derived provenance remains valid;
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
- WP7.2 diagnostic JSON export (pulled forward from PR C so the October baseline is auditable from first capture)
- component tests
- one E2E

This is the first athlete-usable slice.

## PR C — history + export

- WP6.1–WP6.5: read model (`assessmentHistoryService.ts` / pure `assessmentHistory.ts`), History UI (`AssessmentHistory.tsx`, `AssessmentSeriesCard.tsx`, `AssessmentAttemptDetail.tsx`), D1–D4 series progress (`assessmentProgress.ts`), D5 bounded read model without N+1 raw-trial/detail loading, D6 diagnostic counts for unreadable records, D7 `TestingWorkflow.tsx` extraction and tab navigation.
- WP7.1: normalized CSV export (`assessmentCsvExport.ts`, `utils/csv.ts`) with deterministic sorting and 24 exact columns, including the body-mass context reference.
- WP3.4 / D8: body-mass-relative context (`anthropometry/bodyMass.ts`, `bodyMassPreference.ts`) with same-day Warsaw date matching, athlete preference support, stable source/reference provenance, and strict fallback to "unavailable".
- WP7.2 update: schema version bumped to `assessment_diagnostic_export_v2` for per-series progress in diagnostic export JSON.
- Appendix A: ADR-0047 (`docs/adr/0047-fixed-load-velocity-assessment-series.md`; delivered as Proposed, accepted 2026-10-01 with Option A) evaluating dedicated protocol, companion attempts, and multi-instance keys.
- Comprehensive unit tests across all new modules and browser E2E (`tests/e2e/testing-physical-capital.pw.ts`).

PR C closes the athlete-facing **history + normalized export** slice of “store, export and track”. It does **not** close Issue #897 as a whole: WP6.6 fixed-load velocity and WP8 bounded goal/context consumers remain open unless explicitly rescoped.

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

- [x] ADR-0046 has been accepted and the canonical OV status board reflects the startable #897 work;
- [x] all six intended protocols are visible in Testing;
- [x] protocol text matches the agreed October execution standards;
- [x] familiarization can be recorded separately from baseline;
- [x] trial capture works on mobile;
- [x] squat/bench raw load attempts can store WL Analysis velocity without prematurely promoting it to a generic canonical series;
- [x] raw-trial correction is append-only and canonical reducers use unsuperseded trials;
- [x] sprint cadence and L/R balance can be retained as descriptive raw/context evidence without becoming corrective targets;
- [x] any W/kg/body-mass-relative output retains the selected source-specific same-day body-mass reference or remains unavailable;
- [x] a failed 1RM attempt does not replace the best successful load;
- [x] broad jump/CMJ/throw keep all valid attempts;
- [x] cycling stores three 6 s trials and both canonical power metrics;
- [x] canonical results can be exported immediately;
- [x] protocol and device/setup provenance are visible;
- [x] protocol copy/checklists preserve the raw-video requirement even while durable in-app media attachment remains deferred;
- [x] all existing Testing flows still pass;
- [x] no code path gives assessment evidence recommendation-selection authority.

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
