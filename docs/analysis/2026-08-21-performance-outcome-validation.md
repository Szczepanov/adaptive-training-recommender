# Performance outcome validation — closing the recommendation → adaptation loop

**Date:** 2026-08-21
**Status:** point-in-time analysis
**Scope:** determine how this repository should establish whether training recommendations are helping the athlete achieve training goals, and how that evidence should interact with the existing shadow-mode, session-response and M7 testing architecture.

---

## Executive verdict

The repository can increasingly answer **“was today’s recommendation safe, explainable and consistent with the intended plan?”** It cannot yet answer the more important longitudinal question:

> **“Did several weeks of these recommendations produce the adaptation the block was intended to produce?”**

That gap should now be closed.

The correct solution is **not** a universal performance score, another readiness coefficient, or a dashboard that declares success because the engine agrees with the athlete’s existing AI loop. It is a separate evidence loop with three levels:

1. **Daily decision quality** — was `proceed / scale / defer / skip` a defensible decision given today’s state?
2. **Training-process quality** — did the athlete actually receive the intended weekly/block stimuli with acceptable adherence, recovery and modification burden?
3. **Outcome quality** — did the goal-specific performance markers improve beyond plausible measurement noise, and did the goal event itself improve or meet its target?

Phase 9.0 addresses level 1 by prospectively comparing the app with the existing external-AI decision loop. M5 already gives substantial level-2 evidence through planned-versus-performed execution and occurrence-linked response. **Level 3 is the missing closure.**

The repository already anticipated the technical substrate: M7 in
[`multidomain-session-authoring-execution-and-evidence.md`](../plans/multidomain-session-authoring-execution-and-evidence.md)
reserves protocol-locked observations, comparable series and quality-aware progress. The usage trigger was deliberately “a repeated standardized test will actually be run and compared over time.” The athlete has now explicitly chosen that workflow. This is therefore evidence that the **M7 usage trigger has fired**, not a reason to invent a parallel measurement system.

The implementation should remain bounded:

* activate only the M7 capability needed by actual repeated tests;
* add an evidence-only block outcome report that joins goal-specific test outcomes with existing process/response evidence;
* keep all outcome evidence out of same-day recommendation authority until a later, explicit policy decision;
* use the current cycling race itself as the first ecological outcome rather than inserting a new exhaustive test into the peak/taper period;
* start the first protocol-locked baseline battery after the goal event and recovery, at the start of the next appropriate block;
* preserve raw test values, protocol, equipment/source and validity; derive interpretation later;
* never treat a single field result, a wearable trend, or “agreement with AI” as proof that the recommender is better.

---

## 1. The question is larger than shadow-mode agreement

The Phase 9.0 decision journal is intentionally narrow. It asks whether the deterministic engine and the athlete’s existing external-AI workflow reach similar daily decisions, records disagreement direction, and protects a prospective evidence segment from policy churn.

That is useful, but it has no ground-truth label for “best training.” If the engine says `scale`, the external AI says `proceed`, and the athlete scales the session, next-morning recovery cannot prove that `scale` was superior: the counterfactual full session was never performed. Conversely, agreement between the two systems can be perfectly consistent and still produce a mediocre training block.

Therefore:

```text
AI agreement != recommendation correctness
recommendation correctness != block effectiveness
block effectiveness != causal proof that one policy is superior
```

The product should make those distinctions explicit rather than hide them behind one score.

### 1.1 Daily decision quality

Existing relevant evidence:

* immutable recommendation/audit revisions;
* Phase 9.0 external verdict and agreement class;
* objective and subjective readiness provenance;
* hard safety/eligibility gates;
* same-day execution result.

This answers whether the day-level decision was coherent and auditable.

### 1.2 Training-process quality

Existing relevant evidence:

* intended weekly programming roles;
* planned-versus-performed session comparison;
* completed-training reconstruction;
* adherence/completion;
* session response and delayed follow-up;
* fatigue/readiness trajectory;
* frequency of `scale`, `defer` and `skip` decisions;
* occurrence-level evidence and deduplication.

This answers whether the plan was actually delivered and tolerated.

### 1.3 Outcome quality

Missing today:

* an explicit goal → metric → protocol → assessment cadence contract;
* protocol-locked repeated performance observations;
* comparability rules between attempts;
* measurement-noise/reliability provenance;
* goal-direction and practical-change interpretation;
* a block-level report joining outcome, process and response evidence;
* stable policy-version segmentation for later longitudinal analysis.

This is the next evidence capability.

---

## 2. What the sports-science literature supports

This section is deliberately conservative. The objective is not to embed physiology claims into product code. It is to determine what the data model and reporting semantics must preserve so later interpretation is honest.

### 2.1 Monitoring load/readiness is not the same as measuring adaptation

The 2017 consensus statement on athlete training-load monitoring describes monitoring as a multidisciplinary process used to understand exposure, response and decision-making; it does not reduce performance development to one load metric. Subjective and objective monitoring measures can respond differently, and a systematic review found subjective self-report measures often reflected acute/chronic training-load changes more consistently than commonly used objective wellness measures.

HRV is useful context, but it is not a performance endpoint. A systematic review/meta-analysis of HRV-guided endurance training found a clearer effect on submaximal physiological parameters than on performance outcomes, where the pooled effect was small and not statistically significant.

**Product implication:** readiness, HRV, resting HR, sleep and subjective state belong in the **response/adjudication layer**. They may explain why a session was modified and whether recovery is trending well. They must not be used as a substitute for goal-specific performance testing.

### 2.2 Repeated tests can be reliable — but only when the protocol is stable

Cycling time-trial protocols can have useful test-retest reliability. Examples relevant to this repository:

* a standardized 20-minute cycling time trial in trained cyclists reported CV ≈ 2.9% and ICC ≈ 0.97 after familiarization;
* 4-minute and 20-minute time trials in trained cyclists showed high reliability, with reported typical errors of 8.1 W and 4.6 W respectively in one study;
* a 15-minute self-paced cycling time trial showed mean within-participant CV around 2.1%, improving further across repeated familiarized trials;
* longer laboratory/field time trials in trained cyclists have often shown approximately 1–3% test-retest variation depending on protocol and population.

Familiarization matters: multiple studies show the first exposure can be less repeatable than later trials.

**Product implication:** an observation without protocol identity is not a benchmark. The system needs a versioned protocol, comparable-series key, attempt validity and a way to distinguish a familiarization attempt from a benchmark attempt.

### 2.3 Device/source identity is part of measurement provenance

A systematic scoping review of cycling power meters emphasizes accuracy, repeatability, reproducibility and robustness across cadence, power range, temperature, position and other conditions. The repository’s own macrocycle already contains the correct practical rule: hotel-machine watts must not be compared with the athlete’s established cycling power sources.

**Product implication:** metric observations must preserve source/device and protocol context. A change of power source or material setup may create a new comparison series rather than silently extending the old one.

### 2.4 Store raw 20-minute power; do not promote `95% × 20 min` to physiological truth

The 20-minute TT is practical and repeatable, but the literature does not justify treating `95% × 20-minute mean power` as interchangeable with critical power, 60-minute mean power or an individual physiological threshold. Studies report large individual limits of agreement between these constructs.

**Product implication:** if a 20-minute test is used, its primary metric is **20-minute mean power**. A derived `0.95 × P20` estimate may exist for familiar training-language convenience, but it must be tagged as a derived estimate with algorithm version and must not replace the raw observation.

### 2.5 Submaximal tests are valuable low-burden monitoring, but not sufficient proof of performance gain

A systematic review of submaximal cycle tests found useful signals in submaximal power, RPE, HR recovery and predicted time-to-exhaustion constructs. Other work in professional cyclists found submaximal HR/RPE-derived variables could track changes in training status.

These tests are attractive because they can be repeated frequently with less fatigue than an all-out trial.

**Product implication:** support a low-burden submaximal trend as a **secondary/context metric**. Do not let improved heart rate at a fixed workload replace a primary outcome test or event result.

### 2.6 Durability/fatigue resistance is real, but it should not become v1 scope by fashion

Recent cycling literature increasingly treats durability — the maintenance of performance after accumulated work — as distinct from fresh-state performance. Recent field and laboratory studies suggest meaningful and repeatable declines in maximal mean power after accumulated work and support durability as a separate performance characteristic.

That is relevant to road racing generally. However, the current macrocycle targets an approximately 50-minute race, not a multi-hour endurance event. A laboratory-style prolonged-work durability battery would add substantial fatigue and implementation complexity now.

**Product implication:** model the observation/protocol system so a durability test can be added later, but do **not** make a 1,000-kJ or multi-hour durability protocol part of the first implementation. For the current goal, late-race/simulation evidence can be recorded as ecological context without pretending it is a protocol-locked durability test.

### 2.7 Detecting “real improvement” in one athlete requires measurement-error context

For an individual athlete, group means and p-values are the wrong primary tool. Recent sports-science work on individual performance changes recommends combining measurement reliability/error information with a practical/worthwhile change criterion. Single-subject methodology is also appropriate for longitudinal athlete conditioning, while requiring care around serial dependence, carry-over, changing training phase and measurement noise.

**Product implication:** do not hard-code one universal “+2% = improvement” rule.

Every progress interpretation needs:

1. observed raw change;
2. protocol comparability;
3. reliability/error provenance;
4. practical-change threshold for the particular metric/goal, if one has been defined;
5. confidence/coverage state.

Until the system has enough personal repeatability data, a literature-derived reliability value can be shown as **reference context**, never silently treated as the athlete’s own measurement error.

### 2.8 Longitudinal evidence is not causal proof of recommender superiority

This is the most important epistemic constraint.

If policy version A is used for one block and policy version B for the next, improvement under B does not prove B caused it. Fitness carries over, block goals change, periodization changes, the event calendar changes, weather and motivation change, and the athlete cannot simultaneously complete the counterfactual block.

True individual causal inference needs much stronger single-subject designs, repeated phases or other counterfactual structure. That is rarely compatible with a real race build.

**Product implication:** the app may say:

* “goal markers improved during policy version X”;
* “this block achieved its primary outcome with high protocol comparability”;
* “modification burden fell while outcome markers improved”;
* “results are consistent with the policy working well.”

It must not automatically say:

* “policy X caused a 4% improvement”;
* “the recommender is 12% better than the external AI.”

A future policy-comparison report can segment data by `policyVersion`, but must preserve this causal limitation.

---

## 3. Product model: three evidence planes, no universal score

The system should expose three parallel evidence planes.

### Plane A — Decision evidence

Question: **Was today’s adjudication defensible?**

Primary sources:

* recommendation audit;
* Phase 9.0 external verdict;
* readiness/fatigue provenance;
* safety constraints;
* decision rationale.

### Plane B — Process/response evidence

Question: **Did the athlete execute and tolerate the intended training?**

Primary sources:

* plan role coverage;
* planned-versus-performed delta;
* adherence;
* session outcome (`passed / caution / reactive / unknown`);
* delayed response;
* modification/defer/skip frequency;
* delivered training load/stimulus evidence.

### Plane C — Outcome evidence

Question: **Did the athlete move toward the actual goal?**

Primary sources:

* protocol-locked performance tests;
* event/competition outcomes;
* secondary low-burden physiological trends;
* goal-specific derived metrics with explicit algorithm versions.

There should be **no arithmetic roll-up across these planes into one “training score.”** A block can legitimately be:

* high adherence + poor outcome;
* lower adherence + strong outcome;
* strong outcome + unacceptable response cost;
* good process + insufficient outcome evidence.

Those are different coaching problems and should remain visible.

---

## 4. Evidence hierarchy for block evaluation

For each goal metric, use this order:

1. **Primary goal event / ecological outcome**, when available.
2. **Protocol-locked maximal or near-maximal performance test** closely related to the goal.
3. **Protocol-locked secondary test** for an important supporting quality.
4. **Standardized submaximal trend** for low-burden monitoring.
5. **Training-derived best efforts / informal benchmarks**, clearly labelled non-protocol evidence.
6. **Wearable/readiness trends**, explanatory context only.

The report should never silently upgrade level 5 or 6 evidence to level 1–3 confidence.

---

## 5. Current cycling block: what to measure now

The in-repository macrocycle defines the current phase as a cycling-priority build toward an approximately 50-minute road race, with a decisive race-specific week followed by taper.

That changes the immediate testing recommendation.

### 5.1 Do not insert a new exhaustive battery into peak/taper

A maximal 20-minute test plus a separate maximal short test would itself be meaningful training stress. Adding it now would alter the block being evaluated and potentially degrade the goal event.

The first outcome of this capability should therefore be the **race itself**, recorded as an ecological outcome.

Useful race facts include, where available:

* completion/result context;
* elapsed time/distance/course identity;
* average and normalized power;
* best standardized duration powers available from the race file (for example 1/5/20 min), labelled as race-derived rather than protocol tests;
* late-race versus early-race high-power ability where a transparent definition exists;
* final effort/sprint context;
* subjective execution note and whether race execution matched the intended tactical demand.

These data are valuable but tactically and environmentally confounded. They must not be inserted into a protocol-locked 20-minute TT series unless the protocol contract actually matches.

### 5.2 Establish the formal baseline after the event

After the goal event and adequate recovery, the next appropriate block should start with a compact cycling battery.

Recommended initial protocol family:

| Metric | Role | Why | Burden |
|---|---|---|---|
| 20-minute TT mean power | primary sustained-performance benchmark | practical, reliable when standardized; close to sustained race demand | high |
| 4-minute TT mean power | secondary high-aerobic benchmark | demonstrated test-retest reliability and complementary duration | high |
| fixed-load submaximal HR + RPE | context / low-burden trend | can be repeated more frequently; useful for efficiency/fatigue context | low |
| goal race/event result | primary ecological outcome | closest measure of actual goal | event-determined |
| short sprint power | maintenance/context only initially | useful later if sprint capacity is an explicit block goal | moderate |

Do not make “FTP” the canonical metric. The canonical sustained metric is `cycling_tt_20m_mean_power_w`; an optional derived FTP estimate can be displayed separately.

### 5.3 Cadence

Recommended default semantics, configurable per goal:

* **daily:** readiness and session response — already present;
* **weekly:** process review — role coverage, adherence, modification burden, response distribution;
* **every 4–8 weeks / block boundary:** one compact goal-specific maximal benchmark set, or substitute a competition that already supplies the primary outcome;
* **mid-block:** optional low-burden submaximal checkpoint when it answers a real question;
* **every ~12–16 weeks:** broader multidomain battery only for qualities that remain active goals;
* **major competition:** record the event as an ecological outcome.

Testing cadence should be periodization-aware. A date on the calendar is not sufficient reason to add an exhaustive test during taper, recovery or a key competition week.

---

## 6. What “improved” should mean in the app

The first implementation should use transparent classifications rather than fake statistical precision.

For two comparable observations:

```text
raw change
  + protocol comparability
  + validity
  + measurement-error context
  + goal direction
  + optional practical threshold
  -> progress interpretation
```

Suggested result vocabulary:

* `meaningful_improvement`
* `possible_improvement`
* `unclear_within_noise`
* `possible_decline`
* `meaningful_decline`
* `non_comparable`
* `insufficient_evidence`

The exact statistical mapping should be versioned and initially conservative.

### 6.1 Reliability provenance

A protocol may carry a `ReliabilityEstimate`:

```text
source: literature_reference | personal_repeatability | manual
metric: cv_pct | typical_error_abs | typical_error_pct | sem_abs
value: number
population/context note
reference
estimatedAt
```

Rules:

* literature values are reference context only;
* personal values require deliberately close-spaced repeated comparable trials where true fitness change is expected to be small;
* never pool different protocol/device series to estimate repeatability;
* never infer a personal CV from months of training data where true adaptation is expected.

### 6.2 Practical significance is goal-specific

Measurement-resolved change and practically important change are not the same.

A metric binding may optionally define a practical threshold such as an absolute value, percentage or event-specific target. If none is defined, the system should say “change exceeds/does not exceed the available measurement-error context” rather than invent a worthwhile-change threshold.

---

## 7. Block outcome report

The first useful product surface should be a **report**, not a dashboard.

For one block, show:

### Goal outcomes

For each primary/secondary metric:

* baseline observation;
* latest/post-block observation;
* raw and percentage change;
* protocol and series identity;
* validity/comparability;
* reliability context;
* practical target if present;
* progress interpretation.

### Training process

Reuse existing sources:

* intended key sessions/roles;
* completed key sessions/roles;
* overall adherence;
* planned-versus-performed dose/step deltas;
* `proceed / scale / defer / skip` distribution;
* unplanned rest;
* session outcome distribution;
* missing delayed-response coverage.

### Cost / tolerance

Report, do not fuse:

* reactive/caution session responses;
* repeated adverse next-morning responses;
* persistent subjective/objective strain context;
* injury/safety interruptions if present in canonical data.

### Policy context

Record:

* stable `policyVersion` segments active during the block;
* planning mode / plan identity;
* whether Phase 9.0 was running;
* material schema/policy boundary if the segment changed.

### Verdict

Use a categorical report-level conclusion rather than a numeric score:

* `on_track`
* `mixed`
* `off_track`
* `insufficient_evidence`

The conclusion must include reasons. Examples:

* **on_track:** primary outcome improved beyond available error context; key-session coverage high; response cost acceptable;
* **mixed:** sustained metric improved but short-duration power declined; high adherence; repeated caution responses;
* **off_track:** primary outcomes declined beyond available error context despite adequate process execution;
* **insufficient_evidence:** test missing/non-comparable or adherence too low to evaluate the planned intervention honestly.

Do not compute a weighted average of these dimensions.

---

## 8. Relationship to M7

M7 already has the right low-level boundaries:

* `MetricDefinition` registry;
* immutable `MeasurementProtocol` revisions;
* raw `MetricObservation` persistence;
* source/device/protocol/comparison-series provenance;
* validity and attempt handling;
* protocol-locked testing mode;
* quality-aware progress derivation;
* no automatic engine-policy effect.

The new work should **activate and concretize M7**, not duplicate it.

What M7 does not yet specify in enough detail is the higher-level product contract:

* how a training goal names primary/secondary outcome metrics;
* when a test should be scheduled relative to a block;
* how ecological event outcomes differ from protocol series;
* how measurement error and practical significance are represented;
* how existing M5/process evidence joins outcome evidence;
* how a block verdict is derived without claiming causality.

That is the scope of the accompanying implementation plan.

---

## 9. Interaction with Phase 9.0

The performance-outcome capability can be implemented during the Phase 9.0 evidence period **only while it stays evidence-only**.

Safe during a running shadow segment:

* observation/protocol persistence;
* manual test entry;
* testing UI;
* progress derivation;
* block report/export;
* architecture guards proving no selector imports.

Not safe without ending/versioning the segment:

* using test progress to modify daily readiness thresholds;
* automatically changing session selection or weekly allocation;
* changing the macrocycle because a derived outcome score says so;
* turning a performance trend into a new fatigue term.

The first report may inform a human/AI-authored **next block**, but the current production recommender remains unchanged until a separate evidence-backed policy decision.

---

## 10. What not to build yet

Do not build:

* a universal “fitness” or “athleticism” score;
* an ACWR-style injury predictor;
* automatic next-block generation from one test result;
* a full force-plate/timing-gate/VBT integration layer;
* a giant metric catalogue before tests are actually used;
* a sophisticated Bayesian causal model before several blocks of stable data exist;
* a multi-hour durability protocol just because durability is fashionable in current cycling research;
* automatic 20-minute-FTP calibration that rewrites training zones after every test;
* a rich progress dashboard before report/export use proves the questions that need a UI.

This is consistent with the 2026-08-19 product-scope cutline: build evidence-producing capability because actual usage now requires it, not because M7 happens to be next numerically.

---

## 11. Decision from this analysis

1. **The M7 repeated-testing usage trigger is now satisfied.** The athlete explicitly wants recurring performance testing to determine whether training is achieving its goals.
2. Build a bounded **Performance Outcome Validation** capability on top of M7 rather than a parallel subsystem.
3. Keep outcome evaluation evidence-only through the current Phase 9.0 block.
4. Treat the current target race as the first ecological outcome; do not insert an additional exhaustive test battery into peak/taper.
5. Start protocol-locked cycling baseline testing after the event/recovery at the next appropriate block boundary.
6. Preserve raw observations and comparability/provenance before deriving progress labels.
7. Use measurement reliability plus optional goal-specific practical thresholds; do not hard-code one universal improvement percentage.
8. Produce a block report combining **outcomes + process + response**, but no universal score.
9. Segment reports by `policyVersion` for future longitudinal learning, while explicitly avoiding causal claims from simple before/after comparisons.
10. Revisit automated training-policy use only after multiple prospective blocks provide stable outcome evidence.

---

## Research references

Primary/review literature used for the design conclusions above:

1. Bourdon PC et al. **Monitoring Athlete Training Loads: Consensus Statement.** *Int J Sports Physiol Perform.* 2017. PMID 28463642. https://pubmed.ncbi.nlm.nih.gov/28463642/
2. Saw AE et al. **Monitoring the athlete training response: subjective self-reported measures trump commonly used objective measures: a systematic review.** *Br J Sports Med.* 2016. PMID 26423706. https://pubmed.ncbi.nlm.nih.gov/26423706/
3. Düking P et al. **Monitoring and adapting endurance training on the basis of heart rate variability monitored by wearable technologies: A systematic review with meta-analysis.** *J Sci Med Sport.* 2021. PMID 34489178. https://pubmed.ncbi.nlm.nih.gov/34489178/
4. Borszcz FK et al. **Reliability of the Functional Threshold Power in Competitive Cyclists.** 2020. PMID 31952081. https://pubmed.ncbi.nlm.nih.gov/31952081/
5. MacInnis MJ et al. **The Reliability of 4-Minute and 20-Minute Time Trials and Their Relationships to Functional Threshold Power in Trained Cyclists.** *Int J Sports Physiol Perform.* 2019. PMID 29809063. https://pubmed.ncbi.nlm.nih.gov/29809063/
6. Borszcz FK et al. **Functional Threshold Power in Cyclists: Validity of the Concept and Physiological Responses.** 2018. PMID 29801189. https://pubmed.ncbi.nlm.nih.gov/29801189/
7. Sitko S et al. **Relationship Between the Critical Power Test and a 20-min Functional Threshold Power Test in Cycling.** *Front Physiol.* 2021. PMID 33551839. https://pubmed.ncbi.nlm.nih.gov/33551839/
8. Bouillod A et al. **Caveats and Recommendations to Assess the Validity and Reliability of Cycling Power Meters: A Systematic Scoping Review.** 2022. PMID 35009945. https://pubmed.ncbi.nlm.nih.gov/35009945/
9. Lamberts RP et al. / review: **A Systematic Review of Submaximal Cycle Tests to Predict, Monitor, and Optimize Cycling Performance.** 2016. PMID 27701968. https://pubmed.ncbi.nlm.nih.gov/27701968/
10. Weakley J et al. **Statistical Tests for Sports Science Practitioners: Identifying Performance Gains in Individual Athletes.** 2024. PMID 38662890. https://pubmed.ncbi.nlm.nih.gov/38662890/
11. Kinugasa T et al. **Single-subject research designs and data analyses for assessing elite athletes’ conditioning.** 2004. PMID 15575794. https://pubmed.ncbi.nlm.nih.gov/15575794/
12. Mateo-March M et al. **Reliability of the durability concept in professional cyclists: a field-based study.** 2025. PMID 40373793. https://pubmed.ncbi.nlm.nih.gov/40373793/
13. Valenzuela PL et al. **Durability in Professional Cyclists: A Field Study.** 2023. PMID 36521188. https://pubmed.ncbi.nlm.nih.gov/36521188/
14. Muriel X et al. **Durability and repeatability of professional cyclists during a Grand Tour.** 2022. PMID 34586952. https://pubmed.ncbi.nlm.nih.gov/34586952/
15. Mann JB et al. **Recommendations for Measurement and Management of an Elite Athlete.** 2019. PMID 31067746. https://pubmed.ncbi.nlm.nih.gov/31067746/

The literature informs measurement and inference semantics. It does **not** authorize any new production recommendation coefficient or readiness threshold.
