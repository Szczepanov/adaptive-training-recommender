# Issue #814 — Canonical comparable-session response and semantic key-workout completion plan

| | |
|---|---|
| **Status** | **In progress** — WP0–WP2, WP4 and WP5 are implemented for their shipped paths; WP8 documentation and structural guards are updated in this continuation; WP3, WP6.4, WP7, WP8 issue reconciliation and closure remain open |
| **Source** | [Issue #814](https://github.com/Szczepanov/adaptive-training-recommender/issues/814) and [2026-09-28 completion analysis](../analysis/2026-09-28-issue-814-training-response-completion-analysis.md) |
| **Baseline** | fresh managed worktree at fetched `origin/main` `2ec78e5444e6c0b329707294cf6a46cbd7368b1f`; includes #907 (`56b38e1`, merged) and subsequent main commits |
| **Baseline reconciliation** | The requested `56b38e1` was no longer the fetched `origin/main` tip when this continuation started; `origin/main` had advanced to `2ec78e5`. This work uses the newer tip, including #907 and commits after it. |
| **Blocked by** | WP3 lacks a deterministic execution-to-response-segment alignment contract. WP6.4 lacks stable retained running-context fields plus compatible running HR-use authority. WP7 still lacks deterministic provider occurrence selection/provenance. WP8 closure depends on those remaining work packages. |
| **Unlocks** | Closure of #814; a clean evidence surface for future adaptation/progression research. It does **not** itself unlock recommendation authority. |
| **Policy effect** | None. All work in this plan remains display/observability context. POLICY_VERSION must not change unless scope is explicitly widened in a separately reviewed policy change. |

## Task board

| Work package | Status | Current boundary |
|---|---|---|
| WP0–WP2 | `[x]` | Shipped contracts and current comparison paths are covered. |
| WP3 | `[-]` | Session identity is wired; segment-to-step identity is blocked until a deterministic shared alignment contract exists. |
| WP4–WP5 | `[x]` | Structured strength and next-morning response render from canonical response evidence. |
| WP6.1–WP6.3 | `[x]` | Power–HR wording and source audit are complete; WP6.3 ended with no stable retained context fields. |
| WP6.4 | `[-]` | Controlled running pace–HR remains blocked by absent stable venue/distance-quality evidence and running HR-use compatibility. |
| WP7 | `[-]` | Provider occurrence deduplication, diagnostic decision provenance and remaining boundedness acceptance remain open. |
| WP8 | `[-]` | Architecture docs and structural guards are updated; final acceptance reconciliation is blocked by WP3, WP6.4 and WP7. Issue #814 stays open. |

WP headings below carry the same status as this board. A negative source audit completes the audit task, but does not satisfy the unmet data-dependent acceptance criterion.

## 1. Goal

Finish issue #814 without duplicating the telemetry and occurrence systems that landed after the issue was opened.

The target pipeline is:

    provider / structured source records
             |
             v
    PerformedTrainingOccurrence
      - one physical workout identity
      - structured source role
      - provider measured source role
             |
             v
    TrainingResponseSessionEvidence
      - canonical session/protocol identity
      - bounded measured response
      - source/measurement/context provenance
             |
             v
    feature-family comparability decision
      - comparable / not comparable / insufficient
      - exact reasons
      - confidence ceiling
             |
             +--> interval / sprint response
             +--> steady power-HR response
             +--> controlled running pace-HR response
             +--> strength response
             +--> next-morning response
             |
             v
    bounded planning summary / richer diagnostic evidence

The critical design constraint is:

> **Canonical occurrence identity determines which source records describe each performed workout; authored protocol/exercise identity plus measurement/context evidence determines whether different workouts may be compared. Measured telemetry determines what happened. No source gets blanket authority outside its role.**

## 2. Non-goals

This plan does not:

- persist raw 1 Hz FIT traces;
- add a second response-telemetry schema beside activityResponse;
- reinterpret every historical activity as exactly comparable;
- turn FIT workout fingerprints into Adaptive-authored identity;
- infer exact step linkage from occurrence linkage alone;
- fetch public weather data during context-brief generation;
- infer hydration status;
- create an environmental correction formula;
- add a new e1RM estimator;
- call pace/HR “running economy”;
- make response features recommendation, readiness, fatigue, progression, training-load or safety inputs;
- change POLICY_VERSION;
- replace formal performance tests.

## 3. Decisions fixed by this plan

### D1 — PerformedTrainingOccurrence is the source-reconciliation root for one performed session

When an active canonical occurrence exists, response derivation uses its source graph to understand which structured execution and provider activities represent the same physical workout.

The occurrence identity is **not** a cross-session protocol-family identity. Two different occurrences become longitudinally comparable only through feature-appropriate authored prescription/protocol identity, canonical exercise identity, or a conservative semantic protocol match.

A raw Garmin activity remains usable as a fallback when canonical occurrence evidence is unavailable, but fallback provenance must remain explicit.

### D2 — Occurrence identity and segment identity are separate

A matched occurrence may establish exact session identity.

A response segment becomes reconciled_workout_step only when deterministic execution-to-step linkage is additionally established.

Without that mapping, a matched occurrence may legitimately contain FIT workout-step segments.

### D3 — One centralized comparability contract

Feature modules do not independently decide whether two sessions are comparable.

A new pure comparability module returns:

- state;
- feature family;
- match basis;
- hard rejection reasons;
- limitations/warnings;
- component provenance;
- overall confidence ceiling.

No generic numerical similarity score is introduced.

### D4 — Structured semantic authority wins for strength

When a canonical occurrence has a structured execution:

- canonical SessionStep.exerciseRef is the exercise identity;
- performed structured entries are the mechanical execution evidence;
- Garmin exercise recognition is diagnostic/fallback only.

### D5 — Context uncertainty lowers authority; it is not normalized away

Missing heat, hydration, terrain or other contextual evidence is represented as uncertainty.

No correction coefficient is invented.

### D6 — Running starts with controlled protocols

Initial running pace–HR comparison is limited to defensible repeated protocols such as treadmill or explicitly authored standardized tests/sessions.

Arbitrary outdoor/trail pace–HR comparison fails closed until route/grade/environment evidence exists.

### D7 — Strength comparisons are like-for-like unless canonical estimation exists

Direct load/repetition trends are compared only when the marker is mechanically comparable.

Different-rep top sets are not converted to one number by a new exporter formula.

### D8 — Exact next-morning tissue linkage is preferred; general recovery stays observational

RegionTissueResponse.sourceSessionRef is used when it can be mapped to the session.

Whole-day soreness/fatigue remains observational and is labelled ambiguous when multiple D-1 workouts exist.

### D9 — Existing activityResponse remains the measured-response substrate

#850's bounded provider-neutral sidecar is retained.

Reconciled response identity should preferably be a read-time overlay/projection rather than mutating the provider activity simply because reconciliation changed.

### D10 — No widened Garmin request budget

Implementation reuses already-fetched activities and existing occurrence/structured records.

If WP6 discovers that useful environment fields require a new Garmin endpoint/request, that work stops and moves to a separate request-budget review.

## 4. Work packages

## WP0 — Freeze the current response contract

**Status:** Implemented
**Blocked by:** None
**Purpose:** protect the useful behavior already delivered by #829/#850/#878 before changing identity/comparability plumbing.

### Changes

Add/extend fixtures proving current behavior for:

1. semantic 3 x long-interval response;
2. 4 x 4 VO2;
3. 30/30 or equivalent microinterval work/recovery identity;
4. 6 x 10 s sprint response;
5. the 234 / 231 / 228 W main set plus low-power cooldown-tail regression from #878;
6. steady cycling decoupling;
7. changed threshold/power-zone signature;
8. current Garmin-only strength fallback;
9. missing/unreadable next-morning check-in;
10. planning versus diagnostic output bounds.

### Likely files

- app/src/engine/contextBriefResponseFeatures.test.ts
- app/src/engine/contextBriefActivityTelemetry.test.ts
- app/src/engine/contextBriefResponseSummary.test.ts or a new focused test file
- app/src/engine/contextBriefSessionResponse.test.ts if split out

### Acceptance

- current expected summaries are pinned before refactoring;
- no new behavior yet;
- test names identify whether a fixture is canonical, FIT-semantic or legacy-lap fallback.

---

## WP1 — Add the canonical training-response evidence projection

**Status:** Implemented
**Blocked by:** WP0
**Purpose:** expose one physical workout, structured identity and measured telemetry to the response layer without changing source authority.

### 1.1 New projection

Introduce a provider-neutral type, for example:

    TrainingResponseSessionEvidence {
      performedOccurrenceId?: string
      localDate
      modality

      identity: {
        level: canonical_occurrence | provider_activity_only
        reconciliationStatus?
        sourceKinds[]
      }

      structuredSourceRef?: {
        executionId
        sessionOccurrenceId?
        prescriptionHash?
      }

      structured?: {
        executionId
        sessionOccurrenceId?
        prescriptionHash?
        sessionSource
        workoutId?
        workoutVariantId?
        steps[]
      }

      measuredSources: Array<{
        provider
        activityId
        activity
      }>

      sourceCompleteness
    }

The exact name can differ; the semantic boundary must not.

### 1.2 Reuse canonical hydration without inheriting the UI DTO's source collapse

Do not add a third hand-written occurrence join.

The implementation should extract/reuse a shared provider-neutral occurrence-source hydration primitive used by `activitiesReadModelService.ts`, `performedTrainingFactsService.ts` where appropriate, and the new response projection. That primitive must preserve the full occurrence source set.

Do **not** build the canonical response projection directly from the current `CompletedWorkoutView` / `getCompletedWorkoutsInRange` result as-is: ADR-0034 deliberately permits multiple provider recordings, while the v1 UI DTO intentionally exposes only one primary Garmin activity. Reusing that DTO unchanged would silently collapse evidence before feature-specific source selection.

It is acceptable for `getCompletedWorkoutsInRange` to reuse the same lower primitive, and callers should still pass preloaded activities to avoid duplicate provider reads.

### 1.3 Preserve canonical exercise identity

Extend StructuredStepDetail or the lower shared projection to retain:

- exerciseRef;
- stepId;
- prescription;
- performed rows.

Do not rely on title/stepName to recover identity.

### 1.4 Context-brief assembly

contextBriefService.ts should pass a response evidence collection/map to the response derivation layer for planning/diagnostic purposes.

Requirements:

- reuse the existing activity fetch;
- no extra Garmin request;
- canonical occurrence read failure does not erase raw activity evidence;
- an unavailable occurrence source produces explicit degraded provenance;
- a linked structured-execution source ref remains available even when execution/definition hydration fails, so occurrence-level linkage is not erased by a read failure;
- multiple provider activities remain explicit rather than silently selecting arbitrary identity for comparisons.

### Tests

- matched structured + Garmin occurrence hydrates one response evidence object;
- Garmin-only occurrence hydrates measured-only evidence;
- structured-only occurrence retains the structured strength evidence needed by the activity-independent renderer, with no Garmin activity required;
- two provider recordings attached to one occurrence remain two explicit measured sources until a feature-specific selector chooses one;
- merged/tombstoned occurrences are excluded;
- source uniqueness is preserved;
- occurrence read failure degrades rather than fabricates exact identity;
- no duplicate Garmin activity query when preloaded data are supplied.

### Exit criteria

The feature layer can receive one canonical response object per physical workout, but no comparison behavior has changed yet.

---

## WP2 — Centralize the comparability contract

**Status:** Implemented for all shipped longitudinal comparison paths — central decisions gate steady power–HR and strength. The 2026-09-29 source audit found no other shipped cross-session comparator: interval/sprint are within-session, next-day is observational, and controlled running comparison is not implemented.
**Blocked by:** WP1
**Purpose:** make “may these sessions be compared for this feature?” a named pure decision instead of scattered conditionals.

### Delivery boundary (PR #891 plus this continuation)

- WP0 and WP1 are implemented.
- WP2 is integrated for steady power–HR and strength comparisons.
- This continuation routes the existing strength comparison through the same contract using explicit exercise identity, load type and repetitions. Same exercise, same load type and same repetitions are required for a `comparable` / like-for-like result; raw top-set values remain visible with rejection reasons when mechanics differ.
- `ComparableSession` accepts strength evidence independently of `NormalizedGarminActivity`; the response summary now also renders structured-only strength occurrences from this projection, and no synthetic Garmin activity is created.
- Provider-recognized exercise identity remains a `provider_fallback` basis with a low confidence ceiling. Strength source completeness follows source role: structured exercise/load/repetition evidence remains canonical despite unrelated provider-record multiplicity, while provider-only strength fails closed when provider-source selection is ambiguous or incomplete. Structured/provider identity-source mismatches fail closed.
- Canonical performed-occurrence local dates now govern steady-comparison chronology/date labels when available; provider dates remain fallback.
- `semantic_protocol_match` is reserved vocabulary only; the current steady matcher selects exact prescription, authored family, provider fingerprint or controlled-steady matching.
- The 2026-09-29 source audit found no shipped longitudinal comparator outside the contract, so WP2 is complete for current behavior. The reserved `running_steady_pace_hr` family still returns not-wired if called; controlled running comparison is planned but not an existing delivered comparison, and must enter through this contract if implemented. WP3–WP8 remain in this follow-up plan; this continuation does not complete issue #814.

### 2.1 New module

Create a focused pure module, for example:

- app/src/engine/contextBriefComparability.ts
- app/src/engine/contextBriefComparability.test.ts

Conceptual API:

    decideSessionComparability({
      featureFamily,
      current,
      prior
    }) -> ComparisonDecision

### 2.2 Decision shape

The result should distinguish:

**state**

- comparable;
- not_comparable;
- insufficient_evidence.

**match basis**

- exact_prescription_identity;
- authored_protocol_family;
- semantic_protocol_match;
- controlled_steady_match;
- provider_fallback.

`performedOccurrenceId` is provenance and self-comparison protection, not a cross-session match basis.

**provenance components**

- occurrence identity;
- protocol identity;
- measurement/sensor evidence;
- threshold/unit evidence;
- venue/environment evidence;
- source completeness.

**reasons**

- hard rejections;
- limitations/warnings.

**confidence**

- high;
- moderate;
- low.

Overall confidence is derived as a ceiling from required component quality; do not average numeric scores.

### 2.3 Feature-specific requirements

The module receives the feature family because the required evidence differs.

Examples:

**interval_response**

- session must have structured/semantic work evidence;
- cross-session comparison prefers authored protocol identity;
- HR portions still require HR fidelity.

**cycling_steady_power_hr**

- steady eligibility;
- valid power;
- HR authority;
- compatible protocol/duration;
- compatible venue when known;
- threshold provenance;
- environment limitations.

**running_steady_pace_hr**

- controlled protocol only in initial release;
- pace/distance evidence;
- HR authority;
- venue/grade context as required.

**strength_set_response**

- canonical exercise identity when structured;
- same exercise, load type, and repetition count for comparable / like-for-like status;
- provider-only identity is confidence-limited and requires an unambiguous provider source for the mechanical facts;
- structured mechanics do not inherit unrelated wearable-source ambiguity;
- venue/environment evidence is not required for strength-set comparability;
- raw top-set load/repetition reporting may remain visible when the central result rejects a like-for-like comparison.

**next_day_response**

- no physiological comparability requirement;
- linkage strength and D-1 ambiguity are the main evidence dimensions.

### 2.4 Migrate existing logic

Move/replace:

- comparisonRejection;
- threshold-based comparison gating;
- same-FIT-fingerprint confidence logic;

while preserving current behavior where the new contract has no stronger evidence.

Do not remove the existing conservative legacy fallback in the same commit as the new canonical path unless tests prove parity.

### Tests

At minimum:

- exact authored protocol > FIT fingerprint > semantic fallback;
- same physical occurrence is never compared with itself;
- different modality rejects;
- materially different protocol rejects;
- changed threshold signature rejects when the feature depends on it;
- unknown threshold provenance caps confidence where appropriate;
- missing HR/power is insufficient, not not-comparable;
- deterministic rejection ordering;
- outdoor/unknown context cannot become high-confidence merely from matching duration.

### Exit criteria

Every shipped longitudinal response comparison obtains eligibility/confidence from one central contract. The 2026-09-29 source audit found the shipped steady power–HR and strength paths both use it; interval/sprint are within-session and next-day remains observational. Future controlled-running comparison must enter through this contract when implemented.

---

## WP3 — Wire authored identity without inventing step correspondence

**Status:** In progress (blocked) — authored protocol identity now reaches the steady power–HR comparator; segment-level reconciliation has no deterministic cross-source alignment contract.
**Blocked by:** WP1, WP2
**Purpose:** complete the original #814 / #850 deferred identity integration.

### 3.1 Session-level identity

For canonical occurrences with structured execution, expose:

- execution ID;
- prescriptionHash;
- source definition identity;
- catalog workout ID/variant where applicable;
- sessionOccurrenceId when present.

An identical `prescriptionHash` can establish exact authored-content identity across sessions. A catalog workout/source-definition identity may establish an authored protocol family only when revision, variant and target semantics are compatible. Neither case is inferred from the occurrence ID itself, and both are stronger than a matching Garmin device fingerprint.

The response summary now passes the structured source identity and ordered step IDs, exercise refs, prescribed targets and optionality into the existing comparator as an authored protocol family. Only identical source identity and step semantics qualify; `unplanned_fixture` sources do not. This enables the steady power–HR comparison to prefer authored identity over a provider fingerprint.

### 3.2 Segment-level identity overlay

Build a read-time resolved segment view.

Upgrade FIT/manual segment identity to reconciled_workout_step only when a deterministic mapping proves the authored step relation.

Potential mapping evidence, strongest first:

1. explicit cross-system correlation/step identity if one exists;
2. execution entries/step timing aligned to measured segment timing;
3. exact authored/device structure with unambiguous ordered one-to-one mapping and compatible duration/role;
4. otherwise do not upgrade.

Occurrence membership alone is insufficient.

**Current boundary:** execution entries provide completion times, while response segments provide elapsed offsets; the current records expose no shared step ID or guaranteed timing-alignment contract. Do not infer linkage from occurrence membership or join those timestamps heuristically. WP3 remains blocked until deterministic shared alignment evidence is available.

### 3.3 Failure behavior

If exact session identity exists but step mapping is ambiguous:

- session comparison may still use exact authored protocol identity;
- individual segment identity remains FIT/manual;
- diagnostic output states the distinction;
- no “reconciled” label is manufactured.

### Tests

- exact occurrence + ambiguous segment mapping;
- exact occurrence + deterministic 1:1 mapping;
- extra warm-up/cooldown on one side;
- skipped/aborted step;
- repeated equal-duration work/recovery;
- device workout with same fingerprint but no Adaptive structured source;
- two sessions sharing a catalog workout but different prescription hash/revision.

### Exit criteria

The reconciled_workout_step identity value is emitted only when its name is true.

---

## WP4 — Correct strength progression authority and marker semantics

**Status:** Implemented — structured-only occurrences now render strength markers directly from `TrainingResponseSessionEvidence`; unavailable structured execution remains explicitly insufficient and cannot fall back to provider exercise names.
**Blocked by:** WP1, WP2
**Purpose:** replace Garmin-name matching with canonical structured identity where available.

### 4.1 Identity precedence

For each strength response:

1. canonical structured exerciseRef / catalog exercise ID;
2. structured step identity when no catalog exercise exists;
3. provider exerciseName fallback only for provider-only evidence.

If a structured execution is present, Garmin exercise recognition must not compete as an equal source.

The response summary now uses performed entry exercise refs when present, falling back to the authored structured step ref only when the entry omits one. Unresolved free-text identity remains scoped to the source definition and step, so matching names across different plans do not establish equivalence. If a linked structured execution cannot be read, provider exercise names are not used as a fallback. Provider-only evidence retains the existing recognized-name path.

### 4.2 Working-set semantics

Use structured performed rows and exclude warm-up/choice entries consistently with the session-execution model.

Preserve:

- load;
- repetitions;
- set count;
- optional recorded effort if already canonical and relevant.

### 4.3 Comparable marker

Initial direct marker:

- same canonical exercise;
- same measurement/load type;
- same rep count;
- compare working-set load / best like-for-like set.

For a different rep count:

- show current and prior performed sets if useful;
- state “not like-for-like for direct load comparison”;
- do not manufacture improvement.

The current summary first searches the selected prior session for the best same-rep/same-load-type working set. Only that path is marked like-for-like; if none exists, a fallback top set may be shown but is explicitly labeled different-rep/load-type/missing-reps. Strength-history chronology and displayed prior dates prefer the canonical performed-occurrence local date over an adjacent provider-local recording date.

### 4.4 Estimated strength

Do not add an estimator here.

Only emit an estimated-strength trend if a pre-existing canonical per-observation estimator exposes:

- exercise identity;
- formula/version;
- input set provenance;
- confidence/eligibility.

Otherwise keep #814 at raw load/reps.

### 4.5 Provider-only fallback

Garmin-only strength may retain the current name-based output if:

- every required working set has an identity;
- the output says provider-recognized identity;
- confidence is capped;
- it never overrides a canonical structured source.

### Tests

- canonical exerciseRef beats conflicting Garmin name;
- two aliases/display titles with one exercise ID compare correctly;
- two different exercise IDs with similar titles never compare;
- same exercise/same reps compares;
- same exercise/different reps does not claim direct progression;
- warm-up sets do not become the marker;
- provider-only fallback remains functional;
- structured execution with missing provider data still produces a structured response;
- a structured-only occurrence renders its same-exercise/load-type/reps prior comparison without a Garmin activity;
- a linked but unavailable structured execution renders insufficient evidence without provider-name fallback.

### Exit criteria

Strength response follows ADR-0034 source authority and never relies on title fuzziness when exact exercise identity exists.

---

## WP5 — Improve next-morning response linkage

**Status:** Implemented — exact execution-source linkage, occurrence-deduplicated D-1 counts, canonical dates, and structured-only next-morning rendering have regression coverage; unresolved check-in/linkage states remain explicit.
**Blocked by:** WP1
**Purpose:** separate exact tissue linkage from day-level observational recovery.

### 5.1 Map sourceSessionRef

For each RegionTissueResponse with sourceSessionRef:

- map execution/strength source ID to its PerformedTrainingOccurrence when possible;
- render the region, nextMorningReaction and linkage provenance;
- do not translate “linked to session” into “caused by session”.

The current response summary resolves exact `execution` refs from the canonical occurrence's structured source ref even if structured execution/definition hydration is unavailable. A response explicitly linked to another known execution is omitted from this session's tissue detail; unresolved refs remain visible as not linked to this session rather than being mislabeled as belonging here.

### 5.2 General soreness/fatigue

Continue to show D+1 soreness/fatigue as observational.

Add D-1 occurrence count:

- 0 recorded sessions: do not imply a session response;
- 1: “next morning after the recorded session; observational”;
- >1: “next-morning day-level response after N recorded sessions; attribution ambiguous”.

When canonical response evidence is available, same-day provider records attached to one occurrence count once.

### 5.3 Preserve current data-state honesty

Keep the current distinctions:

- check-in read failed;
- invalid/unreadable record;
- no check-in;
- next morning not reached.

### Tests

- exact linked tissue reaction;
- source ref cannot be resolved;
- one D-1 occurrence;
- two D-1 occurrences;
- multiple same-day provider records reconciled into one occurrence count as one workout;
- structured-only occurrence receives the D+1 check-in and exact execution-linked tissue response;
- unavailable structured execution retains an insufficient-evidence strength result and does not fabricate provider identity;
- unreadable check-in state remains distinct.

### Exit criteria

The output is more specific when exact linkage exists and more honest when it does not.

---

## WP6 — Harden steady cycling context and add controlled running pace–HR response

**Status:** In progress — response terminology is power–HR based and the WP6.3 provider audit is complete with a negative result; controlled running remains open and blocked. No new provider source/request is in this issue scope.
**Blocked by:** WP2; running also depends on HR-fidelity compatibility for running use
**Purpose:** finish the two longitudinal aerobic-response families without pretending field context is controlled when it is not.

### 6.1 Rename cycling output semantics

User-facing label:

- prefer **steady power–HR response** or **power–HR response ratio**;
- avoid “aerobic efficiency” as a physiological measurement claim.

The implementation may retain an internal compatibility type/function name for one migration if changing it broadly adds needless churn.

### 6.2 Cycling comparability

Keep existing steady rules, then add the centralized evidence basis:

- exact/semantic protocol match;
- venue compatibility where known;
- threshold provenance;
- HR authority;
- cadence context from deterministic halves when available;
- environmental-context completeness.

High confidence should require truly strong protocol/context evidence. A field ride with unknown environment should not become high confidence solely because duration and stimulus match.

Do not add a heat/hydration correction.

### 6.3 Provider context audit

Audit already-acquired Garmin summary/FIT fields for:

- indoor/outdoor/virtual venue;
- ambient/device temperature;
- elevation gain or sufficiently stable grade/route descriptors;
- any stable source-quality indicator required for running pace/distance.

If stable fields already arrive in the fetched payload:

- add a small provider-neutral ActivityComparisonContext;
- preserve provenance;
- hydrate it without new provider requests.

If a new endpoint/request would be required:

- stop this subtask;
- document the gap;
- open a separate request-budget/privacy design issue.

**Audit result (2026-09-29):** the frontend's `NormalizedGarminActivity` and `ActivityResponseTelemetry` retain activity type, laps and bounded sensor summaries, but no stable indoor/outdoor venue, temperature, elevation/grade, route or distance-quality evidence. No already-hydrated field supports the proposed context enrichment. Stop WP6.3 here; adding a Garmin request or expanding persisted provider data needs the separate request-budget/privacy review above.

### 6.4 Running pace–HR response

Initial eligibility:

- treadmill running with a controlled repeated protocol; or
- exact authored standardized running protocol with compatible duration/pace structure.

Required:

- valid pace/distance;
- HR evidence accepted for this use;
- no trail classification;
- protocol/venue compatibility.

Output:

- representative pace;
- representative HR;
- relative pace–HR response versus one comparable prior session;
- confidence/provenance;
- explicit limitations.

Do not call it running economy.

### 6.5 Outdoor running

Until route/grade/environment evidence is defensible:

- ordinary outdoor run: insufficient context for longitudinal pace–HR comparison;
- trail run: not comparable for generic pace–HR response.

This is an intentional safe failure mode.

### Tests

Cycling:

- exact indoor repeated protocol;
- outdoor unknown context caps confidence;
- indoor/outdoor mismatch rejects;
- cadence evidence is rendered as context rather than silently ignored;
- heat/environment absent never produces a correction.

Running:

- same treadmill protocol compares;
- materially different treadmill duration/pace protocol rejects;
- outdoor road run without route/context is insufficient;
- trail run rejects;
- missing/withheld HR is insufficient;
- GPS/pace evidence missing is insufficient.

### Exit criteria

Cycling steady comparison no longer overstates its meaning, and issue #814 has a defensible running implementation rather than a broad unsafe one.

---

## WP7 — Render provenance compactly and keep the information budget

**Status:** In progress — planning output names the selected comparison basis, bounds rejected candidates and caps structured-only strength output at eight occurrences/exercises with omission counts; provider-backed occurrence deduplication, diagnostic provenance and full boundedness acceptance remain open because provider source selection is not yet deterministic.
**Blocked by:** WP2–WP6
**Purpose:** make stronger semantics visible without recreating diagnostic bloat.

### Planning output

One key-session summary should contain only decision-relevant evidence, for example:

    2026-09-28 Cycling threshold — 74 min
    - Identity: exact authored protocol (canonical occurrence)
    - Main set: 3 x 15 min @ 234 / 231 / 228 W actual
    - Work response: -2.6% first->last; no late collapse
    - HR: final-third 154 / 158 / 161 bpm (verified)
    - Comparison: prior same prescription 2026-09-14
    - Confidence: moderate — exact protocol and HR; outdoor thermal context unavailable

Or for strength:

    Strength — front squat
    - Identity: front_squat (Adaptive structured execution)
    - Best comparable set: 120 kg x 5; prior 117.5 kg x 5
    - Change: +2.5 kg at the same reps
    - Next morning: right knee normal (linked tissue response); general soreness 4/10 is day-level observational

Exact wording is not normative.

The steady power–HR summary now distinguishes exact authored prescription, authored protocol family, provider fingerprint and generic steady-protocol matches instead of rendering them all as one generic basis.

### Boundedness

- one selected prior comparator per feature;
- cap rendered rejected-reason examples, then state the omitted count;
- no raw traces;
- no full occurrence source dump;
- no linear growth with all history candidates;
- structured-only strength summaries are capped at eight rendered occurrences and eight exercises per occurrence, with omission counts;
- render one canonical performed occurrence once even when it carries multiple provider recordings; the current activity-driven summary has not completed this deduplication yet;
- diagnostic may show the full persisted comparison decision/evidence needed to debug selection.

### Diagnostic output

Include:

- performedOccurrenceId;
- source kinds;
- structured/provider identity basis;
- component provenance;
- full bounded rejection reason list;
- underlying persisted telemetry already available today.

### Tests

- 100 historical candidate sessions do not grow planning output linearly;
- deterministic candidate selection and reason ordering;
- planning omits source-noise fields;
- diagnostic contains enough identity/provenance to reproduce why the comparator was selected/rejected.

### Exit criteria

The planning brief becomes more semantically precise without reversing #811's information-budget gains.

---

## WP8 — Documentation, governance and issue closure

**Status:** In progress — recommendation-engine and telemetry references plus structural authority guards are updated; final issue acceptance reconciliation remains open because WP3, WP6.4 and WP7 are incomplete.
**Blocked by:** WP1–WP7
**Purpose:** update living architecture and make the authority boundary difficult to regress.

### Update

- docs/architecture/recommendation-engine.md
- docs/architecture/activity-response-telemetry.md
- docs/plans/README.md status board and docs/README.md hub index
- ADR-0034 status/documentation only if the repository separately decides its shipped state warrants an ADR status transition; do not silently edit an accepted immutable ADR.
- issue #814 acceptance checklist/comment.

`docs/architecture/recommendation-engine.md` and `docs/architecture/activity-response-telemetry.md` reflect the current power–HR terminology, structured strength authority, exact-versus-day-level next-morning linkage, and deterministic identity/provider-data cutlines. Structural guards cover static and dynamic imports, keep the response-renderer chain inside the context-brief display boundary, reject transitive reachability from non-context-brief engine modules, and lock the normalized response schema (including nested source-resolution and prescribed-target shapes) against accidental raw-trace expansion. Cardinality bounds remain enforced by the existing ingestion/read-side validation and tests rather than by this structural test alone. These updates do not close the remaining data-dependent acceptance items or issue #814.

### Document explicitly

- canonical response evidence boundary;
- session versus segment identity distinction;
- comparison tiers;
- cycling power–HR terminology;
- controlled-running cutline;
- strength source authority;
- next-day linkage semantics;
- environmental unknown behavior;
- display-only authority.

### Architecture tests

Add structural tests that fail if:

- recommendation/ranking/readiness modules import response comparability outputs;
- a policy consumer starts reading them without explicit activation work;
- response code reintroduces provider exercise-name authority over structured exercise identity;
- raw native FIT samples appear in planning payloads.

### Close #814 only when

All issue-closure conditions in the linked analysis are met and no TODO is being hidden behind a misleading “high confidence” fallback.

---

## 5. Recommended PR sequence

Keep review units narrow. Suggested sequence:

### PR 1 — Evidence projection and identity plumbing

WP0 + WP1.

Why first:

- no longitudinal feature behavior needs to change;
- establishes the canonical input shape;
- easiest place to catch hydration/source-authority mistakes.

### PR 2 — Central comparability contract

WP2 plus migration of existing cycling comparator.

Why separate:

- makes threshold/confidence/rejection behavior easy to review;
- keeps identity plumbing out of semantic policy review.

### PR 3 — Authored identity / segment overlay

WP3.

Why separate:

- segment reconciliation has different failure modes from session comparison;
- avoids a false “matched occurrence == exact segment” shortcut.

### PR 4 — Strength and next-day response

WP4 + WP5.

Why together:

- both are mostly canonical source-identity corrections;
- both benefit from occurrence-to-execution mapping.

### PR 5 — Cycling terminology/context and controlled running

WP6.

Why later:

- depends on the generic comparability contract;
- keeps science/context decisions reviewable;
- environment source audit may split into its own PR if data-model work is needed.

### PR 6 — Final rendering/docs/closure hardening

WP7 + WP8.

Why last:

- planning text can then reflect settled provenance semantics;
- issue checklist can be closed against actual delivered behavior.

Do not squash all six concerns into one feature PR.

## 6. File-level change map

Expected or likely files; exact names may evolve during implementation.

### Canonical occurrence / evidence

- app/src/training-occurrence/activitiesReadModelService.ts
- app/src/training-occurrence/performedTrainingFactsService.ts
- app/src/training-occurrence/structuredSetDetail.ts
- app/src/training-occurrence/completedWorkoutView.ts
- new/refactored shared occurrence-source hydration primitive (name decided during WP1)
- new app/src/training-occurrence/trainingResponseEvidence.ts
- associated tests

### Response engine

- app/src/engine/contextBriefResponseFeatures.ts
- app/src/engine/contextBriefSessionResponse.ts
- app/src/engine/contextBriefResponseSummary.ts
- new app/src/engine/contextBriefComparability.ts
- associated tests

### Context assembly/rendering

- app/src/services/contextBriefService.ts
- app/src/engine/contextBriefActivityTelemetry.ts
- app/src/engine/contextBriefPlanningHandoff.ts only if final rendering requires it

### Models / parsers only if source audit justifies them

- app/src/engine/models.ts
- Garmin canonical/mapper/parser files for already-acquired comparison-context fields
- parser/cross-language contract tests

### Documentation

- docs/architecture/recommendation-engine.md
- docs/architecture/activity-response-telemetry.md
- docs/plans/README.md status board
- docs/README.md documentation hub
- this plan and linked analysis

## 7. Candidate-selection rules

When multiple prior sessions pass comparability:

1. exclude self/current occurrence;
2. prefer highest semantic match tier;
3. prefer highest required measurement/context confidence;
4. prefer latest prior date;
5. use stable ID as deterministic final tie-breaker.

Do not select the latest first and then stop before checking that an older exact protocol match exists.

Planning renders one selected comparator. Diagnostic may list rejected/higher-detail candidates within a bound.

## 8. Data-state and failure semantics

Every new path must preserve repository-wide “missing is not zero” behavior.

Examples:

- occurrence read unavailable -> canonical identity unavailable, not Garmin-only by assumption;
- structured execution ref exists but execution read fails -> source unavailable, not provider-authoritative strength identity;
- provider activity ref exists but telemetry record missing -> measured response unavailable;
- environmental field absent -> context unknown;
- threshold signature absent -> unknown, not same;
- sourceSessionRef cannot resolve -> unlinked observation, not exact;
- multiple provider sources with no primary selection contract -> insufficient for provider-specific response comparison.

## 9. Performance and request-budget constraints

### Reads

- reuse preloaded NormalizedGarminActivity range;
- avoid a second activity range read;
- occurrence/structured hydration must remain bounded to the response history window;
- no per-candidate N+1 provider calls.

### Compute

- candidate filtering is bounded by the existing fetched history horizon;
- use maps keyed by performedOccurrenceId / activityId / structured source ID;
- comparison derivation is pure after hydration;
- render only one selected prior comparator per feature in planning.

### Provider budget

- no new Garmin endpoint in WP0–WP5;
- WP6 source audit may use fields already present in existing payload/FIT only;
- any new download/endpoint needs a separate decision.

## 10. Privacy and persistence

- no web geocoding/weather join;
- no route GPS trace added to planning;
- no raw FIT record persistence;
- no new sensitive free-text inference;
- canonical response evidence is read-time where possible;
- if compact comparison-context fields are persisted later, they require the same parser/schema/provenance discipline as activityResponse.

## 11. Verification matrix

### Unit

- response evidence projection;
- comparability decisions;
- strength marker semantics;
- next-day exact/ambiguous linkage;
- running/cycling feature eligibility;
- rendering bounds.

### Cross-boundary

- structured execution + provider activity same occurrence;
- provider-only occurrence;
- structured-only occurrence;
- historical activity sidecar absent;
- activityResponse malformed/unsupported version;
- canonical read unavailable;
- check-in read unavailable.

### Regression

Retain #829/#850/#878 fixtures.

### Architecture/governance

Run:

- TypeScript compile;
- relevant Vitest suites;
- policy-drift checker;
- architecture import guards;
- make check;
- build;
- context-brief size/bounded-growth tests.

Because the work is display-only, simulations should be expected to show **zero recommendation-plan change**. If a simulation changes recommendation output, stop and identify the unintended policy coupling before merging.

### CI evidence to record in each PR

- exact command;
- pass/fail count;
- any flaky/performance-only failure separated from semantic failure;
- POLICY_VERSION unchanged;
- changed-file list;
- whether Garmin request behavior changed (expected “no”).

## 12. Rollback strategy

The plan should remain incrementally reversible.

- WP1 projection can be unused without deleting data.
- WP2 can retain the existing comparator behind an internal compatibility path for one PR if needed.
- canonical strength identity can fall back to provider-only behavior only when the structured source is genuinely unavailable, not merely because the new code errors.
- running response can be disabled independently without affecting cycling.
- environment enrichment is additive.
- no persisted raw telemetry migration means rollback does not require deleting large data.

## 13. Review checklist

A reviewer should be able to answer “yes” to all of these before #814 closes:

- Is one physical workout represented once?
- Does structured Adaptive identity win where it owns semantics?
- Does provider telemetry still own measured device facts?
- Can session identity be exact while segment identity remains FIT/manual?
- Is every longitudinal comparison routed through the same comparability contract?
- Can the output explain why a candidate was rejected?
- Does missing context lower confidence rather than create a correction?
- Is cycling NP/HR described as a response proxy rather than physiological efficiency?
- Is running restricted to defensible protocols?
- Are different-rep strength sets protected from false direct progression claims?
- Are exact tissue links distinguished from day-level recovery observations?
- Does planning remain bounded?
- Does diagnostic retain enough evidence to debug the result?
- Are raw FIT samples still transient?
- Is recommendation authority unchanged?
- Is POLICY_VERSION unchanged?

## 14. Definition of done

This plan is complete when:

1. WP0–WP8 are implemented or an explicitly documented issue-scope decision removes a work item;
2. issue #814 acceptance criteria are reconciled against actual main, not the 2026-09-25 baseline;
3. no deferred gap is disguised by a high-confidence fallback;
4. architecture documentation matches runtime behavior;
5. normal planning context remains bounded;
6. all response features remain observational/display-only;
7. issue #814 is closed with links to the implementation PRs and final validation evidence.
