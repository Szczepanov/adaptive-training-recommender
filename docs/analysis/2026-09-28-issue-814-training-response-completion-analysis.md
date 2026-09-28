# Issue #814 training-response completion analysis — 2026-09-28

**Status:** Point-in-time architecture and evidence review  
**Source:** [GitHub issue #814](https://github.com/Szczepanov/adaptive-training-recommender/issues/814)  
**Baseline:** main at the start of this review, after PRs #829, #860, #878 and the training-occurrence backfill/replay work through #886  
**Scope:** comparable-session response features, key-session summaries, canonical workout identity, strength progression, next-day response, running support, and contextual comparability  
**Decision authority:** analysis only. Nothing in this document grants training-response features recommendation, readiness, fatigue, load, progression, or safety authority.

## Executive conclusion

Issue #814 is **substantially implemented but not complete**.

The original issue described a greenfield need for a conservative response-feature layer. Since then:

- PR #829 implemented deterministic cycling interval repeatability, Pw:HR decoupling, a power/HR steady-session comparison, strength top-set summaries, next-morning observations, and semantic planning summaries.
- #811's purpose-driven context-brief architecture is complete: planning is bounded and semantic; diagnostic retains richer evidence.
- #850 / PR #860 added multi-resolution activity-response telemetry, semantic FIT workout-step segmentation, sprint/short-duration support, deterministic steady halves, bounded planning output and a resolution-preservation harness.
- PR #878 hardened the semantic work-set logic after a real cooldown tail produced a false late-collapse signal.
- ADR-0034's canonical PerformedTrainingOccurrence implementation is now materially deployed. The 2026-09-28 backfill verification reports canonical links for all 73/73 eligible Garmin activities in the measured 90-day corpus, while recommendation authority remains unchanged.

That work removes most of the original telemetry and export gaps. The remaining architectural problem is now narrower:

> **Response features are still primarily derived from standalone Garmin activities, while the repository now has a stronger canonical identity model for the physical workout.**

The remaining closure work should therefore **not** create another telemetry pipeline and should **not** add more ad-hoc thresholds to contextBriefResponseFeatures.ts. It should introduce a canonical response-evidence projection and one centralized, feature-family-aware comparability contract.

The highest-value remaining gaps are:

1. exact performed-occurrence / authored-session identity is not consumed by the #814 response layer;
2. reconciled authored step identity is reserved in the telemetry schema but not actually wired;
3. strength progression still identifies exercises by Garmin exercise-name strings rather than Adaptive canonical exercise identity when a structured execution exists;
4. next-day response is linked by calendar adjacency for general soreness/fatigue even though tissue feedback can carry a source-session reference;
5. the steady cycling comparison calls NP / HR “efficiency” even though it is a response proxy, and its current comparability contract does not know heat, hydration, indoor/outdoor context, terrain or cadence context;
6. running pace/HR comparison is still absent, and arbitrary outdoor running is not safe to add without a tighter context contract;
7. confidence is currently a single label even though identity confidence, measurement confidence, threshold provenance and environmental comparability are separate questions.

The recommended completion path is to preserve the current display-only boundary and make comparisons **more conservative, more canonical, and more explicit about what is unknown**.

## 1. Current-state audit against issue #814

| #814 requirement | Current main | Assessment |
|---|---|---|
| Structured interval repetition summary | Semantic FIT work segments are preferred; legacy lap heuristic is fallback | **Implemented** |
| First-to-last / fade / collapse | Implemented for interval and sprint families, including real-world cooldown hardening | **Implemented** |
| Variable ride must not receive misleading drift | Decoupling requires steady endurance/recovery, low VI and adequate evidence; semantic continuous halves now available | **Implemented** |
| Comparable steady cycling response | NP / HR comparison exists with type, stimulus, duration and threshold-signature checks | **Partial** — identity/context contract is still weak |
| Exact structured workout identity preferred | FIT fingerprint can strengthen the current comparison; canonical performed occurrence is not consumed | **Partial** |
| Reconciled authored workout-step identity | Schema reserves reconciled_workout_step, architecture says it remains future integration | **Not complete** |
| FTP / zone provenance | Power-zone boundary signature detects changed definitions; unknown provenance is allowed at low confidence | **Implemented but lossy** |
| Strength progression only with reliable identity | Garmin exercise names must exist on all working sets | **Partial** — wrong authority when structured execution exists |
| Canonical strength estimate if already supported | #829 intentionally avoids inventing e1RM | **Correct conservative behavior** |
| Next-day response is observational | Explicitly labelled observational and handles missing/unreadable/future cases | **Implemented** |
| Exact next-day session linkage | General soreness/fatigue still use D+1 calendar adjacency; tissue model has sourceSessionRef that is not used here | **Partial** |
| Planning uses semantic summaries | Yes; bounded key-session summaries coexist with bounded execution detail | **Implemented** |
| Diagnostic preserves evidence | Yes; all persisted laps/segments are available, while native raw FIT samples remain transient | **Implemented** |
| Running pace/HR response | Running telemetry is exportable, but no comparable-session pace/HR feature exists | **Not implemented** |
| Heat / terrain / fatigue context | No normalized comparison-context model; current activity model lacks temperature/elevation fields | **Not implemented** |
| Deterministic, insufficient rather than guessed | Strongly enforced across current response feature modules | **Implemented** |
| No recommendation authority | Explicit in code/docs and POLICY_VERSION has not changed for this feature family | **Implemented** |

The issue should remain open until the partial/not-complete items above are either implemented or explicitly narrowed with a documented evidence boundary.

## 2. What the current data flow actually does

The current planning/diagnostic path is approximately:

    Garmin activity range (>= sensor-observation horizon)
        |
        v
    NormalizedGarminActivity[]
        |
        +--> activityResponse sidecar
        |      - semantic FIT segments
        |      - power-duration peaks
        |      - steady halves
        |      - source resolution
        |
        +--> #814 response functions
        |      - interval/sprint response
        |      - decoupling
        |      - steady power/HR comparison
        |      - Garmin strength-set comparison
        |
        +--> ResponseContext(history, check-ins)
        |
        v
    semantic key-session summaries

In parallel, contextBriefService already reads canonical performed-training facts for coverage/exposure purposes, but those facts are **not the identity source for the #814 comparison layer**.

The repository also has a separate canonical completed-workout path:

    PerformedTrainingOccurrence
        |
        +--> structured_execution source
        |      - prescription hash
        |      - session definition
        |      - performed entries/rest
        |
        +--> provider_activity source
               - Garmin activity / measured telemetry
        |
        v
    CompletedWorkoutView / performed facts

This second path has the stronger answer to “which physical workout was this?” and, when structured evidence exists, the stronger answer to “what exercise/workout was intended?”. The #814 layer currently does not use it.

## 3. Detailed findings

### F1 — The original #814 identity dependency has changed materially

Issue #814 originally named #646 / structured-workout reconciliation as a dependency because identity was still maturing.

That premise is now dated.

The canonical PerformedTrainingOccurrence domain exists, source uniqueness is enforced, matched structured/provider workouts can coexist in one occurrence, and the 2026-09-28 backfill verification reports no uncovered eligible Garmin activity in the measured 90-day window.

This does **not** mean canonical history automatically gains recommendation authority. It means the response exporter now has a credible, provider-neutral identity substrate that is stronger than:

- title matching;
- same-day matching;
- Garmin exercise-name strings;
- a FIT workout fingerprint alone.

### F2 — A canonical occurrence link is session identity, not automatically step identity

The activity-response schema already includes the identity value reconciled_workout_step, but the current architecture document correctly says this tier is not wired.

That distinction matters.

A matched PerformedTrainingOccurrence can prove:

> this structured execution and this Garmin activity describe the same physical workout.

It does **not** by itself prove:

> Garmin segment 4 is Adaptive authored step 4.

Step identity should only be upgraded when there is defensible execution-to-step alignment: explicit correlation, compatible absolute timing, exact authored/device structure with execution linkage, or another deterministic mapping contract.

Therefore the implementation must not mark every FIT segment as reconciled_workout_step merely because its activity belongs to a matched occurrence. Occurrence-level exactness and segment-level exactness are separate provenance dimensions.

### F3 — Strength comparison is using the wrong authority when structured execution exists

contextBriefSessionResponse.ts currently groups working sets by normalized Garmin exerciseName.

That was a defensible first implementation before canonical occurrence hydration was available to this consumer. It is no longer the best available authority.

ADR-0034 says that when a structured execution exists:

- Adaptive owns exercise identity/order and prescribed structure;
- Garmin exercise recognition, repetitions and weights are fallback/diagnostic evidence.

CompletedWorkoutView already suppresses competing Garmin exercise-set semantics when structured evidence exists. The response layer should follow the same rule.

There is one additional implementation gap: StructuredStepDetail currently preserves stepId, title, prescription and performed sets, but drops SessionStep.exerciseRef. SessionStep itself already supports a canonical catalog ExerciseRef. The response projection therefore needs to retain that identity rather than reconstruct it from stepName/title.

### F4 — The steady cycling comparator is useful, but “same type + same stimulus + similar duration” is not a complete comparability contract

Current deriveEfficiencyComparison rejects a prior ride when:

- activity type differs;
- the prior activity is not steady/eligible;
- stimulus domain differs;
- duration ratio exceeds 1.25;
- power-zone boundaries prove the threshold definition changed.

A matching FIT workout fingerprint raises confidence.

That is substantially safer than arbitrary average-HR comparison, but it cannot currently observe:

- ambient temperature/humidity;
- hydration;
- meaningful indoor/outdoor differences beyond activity type naming;
- route/grade/terrain similarity;
- wind;
- comparable cadence behavior;
- pre-session fatigue/loading context.

The normalized activity model does not currently contain temperature or terrain/elevation context. Adding another “heat threshold” inside the comparator without first adding evidence would be false precision.

### F5 — NP / HR is not physiological “efficiency”

The current feature uses normalized power divided by average HR.

That can be a useful longitudinal **power–HR response proxy** under controlled conditions. It is not mechanical efficiency, gross efficiency, cycling economy measured by oxygen cost, or proof of adaptation.

The rendering/documentation should therefore prefer terminology such as:

- power–HR response;
- steady power/HR ratio;
- external-to-internal response proxy;

rather than implying a direct measurement of aerobic or mechanical efficiency.

Keeping the existing internal type name temporarily for compatibility is acceptable, but user-facing semantics should be tightened.

### F6 — Running should not copy the cycling comparator mechanically

The issue asks for representative pace and HR for eligible steady running protocols. That is reasonable, but “pace/HR” is not the same thing as laboratory running economy, which is normally based on oxygen cost at standardized speeds.

Running also adds larger context sensitivity to:

- grade;
- surface;
- wind;
- treadmill versus outdoor mechanics;
- temperature;
- stops/GPS quality.

A conservative first implementation should support:

1. exact/repeated treadmill protocols with compatible pace, duration and HR evidence;
2. other explicitly standardized running tests if canonical protocol identity proves comparability;
3. outdoor road running only after route/grade/context evidence is available;
4. trail running as ineligible for generic pace/HR longitudinal comparison unless a specific repeated-course protocol is represented.

### F7 — Next-morning response has stronger linkage available for tissue observations

Daily check-ins contain RegionTissueResponse.sourceSessionRef with a kind/id/date linkage to the provoking strength/execution session.

The current #814 next-day feature instead links the whole check-in to the preceding activity date.

For whole-day soreness/fatigue this calendar relationship should remain explicitly observational, especially if multiple workouts occurred on D-1.

For per-region tissue reaction, the existing sourceSessionRef can support stronger attribution **to the recorded session reference** without claiming physiological causality.

The response layer should therefore distinguish:

- exact linked tissue observation;
- one-session prior-day observational context;
- multi-session prior-day ambiguous context;
- no link / insufficient evidence.

### F8 — One confidence label hides different kinds of uncertainty

Current response features use high / moderate / low.

A comparison can simultaneously have:

- exact session identity;
- uncertain HR measurement lineage;
- known same FTP definition;
- unknown thermal context.

Collapsing those facts into one label makes it difficult to explain why confidence is limited.

The implementation should retain a compact overall confidence for rendering, but derive it from explicit components:

- identity/protocol provenance;
- measurement/sensor authority;
- threshold/units provenance;
- environment/context comparability;
- source completeness.

The overall confidence should be a **ceiling from the weakest required component**, not an average score.

### F9 — Avoid creating a third occurrence-hydration implementation

There is already duplicated-but-related hydration logic in:

- performedTrainingFactsService.ts;
- activitiesReadModelService.ts.

Adding a third custom “find structured execution for this Garmin activity” implementation in contextBriefService would increase divergence risk.

The response feature should consume a shared provider-neutral occurrence projection or extract a reusable hydration primitive from the existing canonical read path.

### F10 — The display-only boundary remains correct

Nothing found in this review justifies making a response feature a live recommendation input.

A lower HR at the same power can reflect adaptation, but it can also reflect temperature, hydration, fatigue, sensor behavior, cadence, medication, acute stress or protocol differences. A stronger response model improves what the planning agent can *see*; it does not automatically justify changing readiness, fatigue or workout selection.

Any future policy use must be a separate activation decision with:

- evidence registration;
- versioned policy;
- replay/counterfactual checks;
- simulation/plan-judge review;
- explicit failure behavior.

## 4. External evidence and what it means for architecture

This review used external exercise-science evidence only to constrain interpretation; it does not turn literature findings into hidden live thresholds.

### 4.1 Standardization is what makes HR–power comparison useful

Grazzi et al. standardized a cycling power-output/heart-rate test and reported repeatability of the PO/HR relationship under that controlled protocol.

Reference: https://pubmed.ncbi.nlm.nih.gov/10527323/

**Architecture implication:** exact/repeated protocol identity is materially stronger evidence than “same sport within 25% duration”.

### 4.2 Heat changes both HR and sustainable power

In trained cyclists, hot conditions can increase cardiovascular strain and reduce sustainable power. Périard et al. reported substantially higher HR and lower power during a 40 km trial at 35°C versus 20°C, while earlier elite-cyclist work also found lower power in heat.

References:

- https://pubmed.ncbi.nlm.nih.gov/20851861/
- https://pubmed.ncbi.nlm.nih.gov/11104310/
- https://pubmed.ncbi.nlm.nih.gov/21725106/

**Architecture implication:** do not call two outdoor power/HR observations “high-confidence comparable” when thermal context is unknown. Do not invent a temperature correction model inside #814.

### 4.3 Hydration can alter cardiovascular drift

Classic controlled cycling work shows dehydration/fluid replacement materially changes cardiovascular drift during prolonged exercise.

References:

- https://pubmed.ncbi.nlm.nih.gov/1447078/
- https://pubmed.ncbi.nlm.nih.gov/1757323/
- https://pubmed.ncbi.nlm.nih.gov/8157372/

**Architecture implication:** hydration is a legitimate unobserved confounder. Missing hydration data should be a documented limitation, not silently normalized away.

### 4.4 Cadence belongs in the interpretation context

Recent repeated standardized cycling observations found cadence decline associated with cardiovascular drift and aerobic decoupling. Older controlled studies also show cadence can alter cardiovascular/physiological responses, although results differ by protocol.

References:

- https://pubmed.ncbi.nlm.nih.gov/41923151/
- https://pubmed.ncbi.nlm.nih.gov/22509808/
- https://pubmed.ncbi.nlm.nih.gov/11080090/

**Architecture implication:** activityResponse.steadyHalves already gives useful cadence context. Render cadence change with decoupling where available and avoid interpreting decoupling as a pure fitness signal.

### 4.5 Indoor and outdoor responses are not automatically interchangeable

One outdoor-versus-laboratory cycling study found different power and HR despite matched perceived effort and broadly similar conditions.

Reference: https://pubmed.ncbi.nlm.nih.gov/24476776/

**Architecture implication:** venue/context belongs in comparability. “Cycling” alone is not enough.

### 4.6 Strength markers need identity and measurement-type provenance

A systematic review found generally high test–retest reliability for standardized direct 1RM testing, while a separate systematic review found that validity of load–velocity-derived 1RM predictions depends on methodology.

References:

- https://pubmed.ncbi.nlm.nih.gov/32681399/
- https://pubmed.ncbi.nlm.nih.gov/36301878/

**Architecture implication:** direct and estimated strength evidence must remain distinct. #814 should not add its own e1RM formula merely to make different-rep top sets look comparable.

### 4.7 Running context needs the same conservatism

Treadmill and track running can differ in thermoregulatory/performance behavior, and running energetic cost changes with grade.

References:

- https://pubmed.ncbi.nlm.nih.gov/25162647/
- https://pubmed.ncbi.nlm.nih.gov/9407746/

**Architecture implication:** start running response comparison with controlled/repeated protocols; do not infer “running efficiency improved” from arbitrary outdoor pace/HR pairs.

## 5. Recommended target architecture

### 5.1 Add a canonical response-evidence projection

Introduce a read-time, provider-neutral object conceptually equivalent to:

    TrainingResponseSessionEvidence
      performedOccurrenceId
      localDate
      modality
      occurrenceProvenance

      structured?
        executionId
        sessionOccurrenceId?
        prescriptionHash?
        authoredDefinitionIdentity?
        workoutId?
        workoutVariantId?
        steps[]
          stepId
          exerciseRef?
          prescribed dose/load/target
          performed rows

      measured?
        provider
        activityId
        normalized activity summary
        activityResponse
        HR measurement authority

      comparisonContext
        venue: indoor | outdoor | unknown
        thresholdProvenance
        cadenceContext?
        environment: known | partial | unknown
        preSessionLoadContext?
        sourceCompleteness

This should be a **projection**, not a new persisted canonical record. The source records remain authoritative in their roles.

### 5.2 Centralize comparability

Introduce one pure comparison decision API instead of embedding family-specific matching ad hoc inside each feature.

Conceptually:

    ComparisonDecision
      state: comparable | not_comparable | insufficient_evidence
      featureFamily
      matchBasis
      confidence
      hardRejections[]
      limitations[]
      provenance
        occurrenceIdentity
        protocolIdentity
        measurement
        threshold
        environment
        sourceCompleteness

Feature families should call the same contract with different required dimensions.

Do not create one numeric “similarity score”. Hard incompatibilities should remain hard incompatibilities.

### 5.3 Comparability tiers

Recommended semantic tiers:

**Tier A — exact authored protocol / canonical occurrence family**

- same canonical authored workout identity or prescription family;
- compatible version/revision/prescription semantics;
- compatible measurement evidence;
- feature-specific required context.

This is the only normal route to “high” protocol confidence.

**Tier B — semantic protocol equivalence**

- no exact authored identity;
- same modality;
- compatible stimulus;
- semantic work/recovery structure matches;
- duration/target structure compatible;
- measurement/threshold evidence adequate.

Maximum confidence should normally be moderate.

**Tier C — controlled steady protocol**

- steady cycling or controlled running only;
- no interval/race/mixed activity;
- compatible venue and duration;
- compatible power/pace domain;
- sufficient HR authority;
- context limitations explicit.

This is not “same workout”; it is a conservative observational comparison.

**Not comparable / insufficient**

- missing required measurement;
- ambiguous/multiple source identity;
- incompatible modality/venue/protocol;
- changed threshold definition when the feature depends on it;
- uncontrolled running terrain for pace/HR comparison;
- missing evidence needed to distinguish the cases.

### 5.4 Keep occurrence identity separate from segment identity

Use PerformedTrainingOccurrence to prove the physical-workout relationship.

Upgrade a segment to reconciled_workout_step only if an additional deterministic step-mapping contract passes.

Otherwise it is valid to say:

- session identity: exact canonical match;
- segment identity: FIT workout step.

That is more honest than manufacturing exact step identity.

### 5.5 Strength: canonical exercise identity first

When a structured execution is attached:

- carry SessionStep.exerciseRef through StructuredStepDetail / the response projection;
- compare catalog exercise IDs, not display titles;
- use performed structured set rows as the mechanical truth;
- keep Garmin exercise recognition diagnostic-only.

For provider-only strength:

- Garmin exerciseName may remain a fallback;
- confidence is explicitly lower;
- no cross-alias normalization by fuzzy text.

For the performance marker:

- exact same exercise + same rep count can support direct load comparison;
- different reps should be shown as performed evidence without claiming a direct like-for-like improvement;
- use an e1RM only by calling an existing canonical strength-capacity/evidence function whose provenance is suitable for this purpose;
- otherwise remain with load/reps and insufficient evidence for a single comparable marker.

### 5.6 Next-day response: two levels of linkage

**Exact tissue linkage**

If RegionTissueResponse.sourceSessionRef maps to the structured source of a performed occurrence, render the region-specific next-morning observation against that session reference.

**Day-level recovery observation**

General soreness/fatigue remain day-level observations:

- if exactly one prior-day occurrence exists, say it is the next morning after that recorded session but not proof of causality;
- if multiple prior-day occurrences exist, explicitly say attribution is ambiguous;
- never silently pick one activity.

### 5.7 Cycling steady response: rename and contextualize

Prefer “steady power–HR response” to “aerobic efficiency”.

Retain:

- power evidence;
- HR authority;
- steady-session eligibility;
- duration/protocol matching;
- threshold provenance.

Add:

- venue compatibility where determinable;
- cadence context when available;
- explicit environmental-context completeness;
- exact occurrence/protocol basis when available.

Do not normalize for heat/hydration with a formula in this issue.

### 5.8 Running: controlled scope first

Initial eligible set should be deliberately narrow:

- treadmill runs with stable/repeated protocol identity; or
- an authored standardized run test/session whose pace-duration structure is known.

Output should be named “pace–HR response”, not “running economy”.

Outdoor and trail pace/HR comparisons should remain insufficient until route/grade/environment evidence is represented strongly enough to defend the comparison.

### 5.9 Environmental context should be additive and source-backed

NormalizedGarminActivity currently has no ambient temperature/elevation comparison context.

Before adding fields:

1. audit which already-acquired Garmin summary/FIT payloads expose stable temperature/elevation/indoor evidence;
2. add only provider-backed fields with explicit provenance;
3. do not add a web-weather dependency to #814;
4. do not infer hydration;
5. use missing context to limit confidence rather than fabricate a correction.

## 6. Rejected approaches

### Close #814 because #829 exists

Rejected. #829 intentionally left running, canonical occurrence identity and contextual controls deferred, and those gaps are still observable in main.

### Keep extending deriveEfficiencyComparison with more conditionals

Rejected. It would turn one display function into an unreviewable comparability policy and duplicate identity logic already owned by the occurrence subsystem.

### Treat FIT workout fingerprint as authored identity

Rejected. The model and ADR evidence explicitly say the current FIT fingerprint is Garmin/device structure and not an Adaptive-authored correlation identity.

### Mark every segment reconciled when the occurrence is matched

Rejected. Session identity is not step identity.

### Add weather API lookups during context export

Rejected for this scope. It creates network/caching/location/privacy/failure semantics unrelated to the current canonical evidence pipeline.

### Use title/name fuzzy matching for structured strength

Rejected. Canonical exercise identity already exists in SessionStep.exerciseRef.

### Add a new e1RM formula to the exporter

Rejected. Measurement type and estimator validity would become hidden feature policy.

### Let response features modify recommendations while “just improving context”

Rejected. That would violate the existing evidence-first activation architecture.

## 7. Recommended issue-closure cutline

Issue #814 can be considered complete when all of the following are true:

1. response comparisons can be keyed to PerformedTrainingOccurrence where available;
2. exact authored session identity is exposed separately from provider/FIT identity;
3. segment identity is upgraded to reconciled_workout_step only with deterministic step linkage;
4. a centralized comparability contract owns eligibility, rejection reasons and confidence provenance;
5. strength comparison uses canonical structured exercise identity when available and does not prefer Garmin name recognition over it;
6. next-day tissue response uses exact sourceSessionRef linkage where available, while day-level soreness/fatigue remains explicitly observational/ambiguous;
7. the current cycling “efficiency” feature is rendered as a power–HR response proxy with context limitations;
8. controlled running pace–HR comparison exists for defensible standardized protocols, while uncontrolled outdoor/trail cases fail closed;
9. environmental/context absence is represented explicitly and prevents overconfident field comparisons;
10. planning output remains bounded and diagnostic output preserves the underlying persisted evidence;
11. no raw FIT trace is newly persisted/exported;
12. no recommendation policy consumes these features and POLICY_VERSION remains unchanged.

## 8. Test strategy implied by the analysis

At minimum, implementation should add regression coverage for:

- canonical matched structured + Garmin occurrence versus Garmin-only fallback;
- same Garmin activity attached to one canonical occurrence only;
- exact authored session identity but no step linkage: session exact, segment still FIT;
- exact authored + deterministic step alignment: reconciled segment identity allowed;
- strength structured exerciseRef wins over conflicting Garmin exerciseName;
- provider-only strength fallback remains lower-confidence;
- equal-rep strength comparison versus different-rep “not like-for-like” case;
- one prior-day workout versus two prior-day workouts for general next-morning response;
- exact sourceSessionRef tissue linkage;
- same steady cycling protocol with reliable HR;
- changed threshold signature rejection;
- indoor/outdoor mismatch;
- unknown environmental context capping confidence;
- treadmill running comparison;
- trail/outdoor uncontrolled running rejection;
- bounded rendering with many historical candidates;
- deterministic rejected-reason ordering;
- no new policy-drift / POLICY_VERSION change.

## 9. Final recommendation

Do **not** redesign #814 around more telemetry. The repository now has enough telemetry.

Complete it by joining the two architectures that have matured independently:

> canonical performed-workout identity + bounded response telemetry.

The result should be a small, explainable response-evidence graph where each comparison answers three separate questions:

1. **Are these actually the same kind of performed session?**
2. **Are the measurements fit for this feature?**
3. **Is enough execution context known to make the longitudinal comparison defensible?**

When any required answer is “no” or “unknown”, the system should say so rather than manufacture a trend.
