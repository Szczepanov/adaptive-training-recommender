# Persona coverage gap review — event priority and state arbitration

**Date:** 2026-09-19  
**Scope:** active persona AI-judge suite only  
**Decision:** expand the active suite from 9 families / 30 cases to 10 families / 36 cases using one new event-priority family and three state perturbations of existing personas. Do not add several new athlete archetypes merely to increase corpus size.

## Executive decision

The current suite is already effective at finding planner defects. The latest external packet review gave strong family-sensitivity scores for most existing families: 9.5 walking, 9.4 established-history, 9.3 stacked-constraints, 9.2 former-elite, 9.0 balanced-performance, while the triathlon family scored 6.8 and exposed a real taper-proximity weakness. The strength symptom-flare case also scored materially lower than its family baseline.

Those results argue against adding more near-duplicate pain, generic adverse-recovery, low-time, walking or taper cases. Those axes already generate useful signal. The next judge budget should instead cover decision branches that are structurally absent from every active packet.

The selected expansion is:

| Addition | Type | Why it is distinct |
| --- | --- | --- |
| persona_running_event_priority with A/B/C 10K cases | new family, 3 cases | The active suite has event-directed triathlon only, always priority A. This isolates event priority while holding athlete, race, date, recovery and history constant. |
| persona_health_fatloss_fresh_subjective_adverse_wearable | existing-family case | Existing adverse cases make subjective and objective recovery agree. This creates a real cross-source disagreement. |
| persona_balanced_performance_already_trained_today | existing-family case | alreadyTrainedToday is a terminal current-day override in the engine but was false in every active packet. |
| persona_established_history_recent_hard_load | existing-family case | last_3_days_hard_sessions_count >= 2 changes readiness strain, but every active packet previously used zero recent hard sessions. |

This adds six cases total: +20% case count, while adding only one new family. That is a reasonable judge-cost tradeoff because each addition reaches a different decision authority.

## What was reviewed

The review covered the active/catalog persona fixtures, persona-suite integrity tests and judge prompt, plus the readiness, taper, event-preset and multi-event/fixed-activity engine paths. It also reviewed the repository's prior persona-expansion plan and subjective-readiness / periodization evidence packs, together with the 30-case external judge results produced immediately before this audit.

The existing fixture-design rule remains correct: **coverage value scales with distinct planner decisions, not with the number of personas.**

## Coverage audit before this change

### Already strong enough to avoid duplication

The existing suite already covers:

- no-wearable strength planning;
- occupational fatigue;
- active pain plus explicit guardrails;
- normal versus concordant adverse Garmin recovery;
- time caps;
- low motivation without physiological red flags;
- former-elite history versus sparse current capacity;
- current established endurance history;
- walking as a first-class aerobic modality;
- stacked injury/equipment constraints;
- hybrid cycling versus strength goal hierarchy;
- favorable wearable signals versus local tissue pain/guardrails;
- Olympic triathlon three-discipline coverage;
- A-event triathlon taper proximity.

The external review demonstrates that these cases are not inert. In particular, the triathlon taper and strength symptom-flare packets identified plan-quality concerns. Adding a second pain flare or another generic A-event taper persona would therefore have low incremental value.

### Structural gaps found

The following axes were absent from all 30 active packets:

1. **Event priority contrast**
   - only the triathlon family is event-directed;
   - every active event is priority A;
   - no active packet asks whether the same event should exert different planning authority as A, B or C.

2. **Already trained today**
   - every active subjective readiness object had alreadyTrainedToday=false;
   - every active objective readiness object had today_training=null;
   - rules.ts treats either signal as a terminal current-day recovery override.

3. **Recent hard-session density**
   - every active objective readiness object had last_3_days_hard_sessions_count=0;
   - rules.ts adds a dedicated recent-hard-session strain term when the count reaches two.

4. **Subjective/objective recovery disagreement**
   - existing adverse-recovery cases generally make subjective and Garmin evidence point in the same direction;
   - the hybrid local-tissue case is a different conflict: favorable global wearable readiness versus active local pain and mechanical guardrails;
   - there was no clean “I feel fresh, wearable recovery is clearly adverse” case.

5. **Fixed activities**
   - every active packet had an empty fixedActivities collection.

6. **True multi-event arbitration**
   - the engine has contributor/authority logic and contributor taper handling;
   - the active suite has no two-event family.

7. **Other event categories**
   - active event-directed coverage is triathlon only;
   - running race, cycling race, strength meet and general target are not active persona-judge families.

The first four are implemented here. Fixed activities and multi-event arbitration are deliberately deferred because they introduce additional fixture semantics and deserve their own narrow counterfactual review rather than being hidden inside a general persona-expansion PR.

## Why add a running-event family

A/B/C priority is not merely another readiness state. It changes event authority and taper policy.

The engine currently encodes:

- non-general-target A events: a default taper path;
- B events: a shorter default taper path;
- C events: no automatic taper;
- cycling A events: a category-specific race-week rule.

The active corpus previously gave the judge no way to evaluate whether priority labels produce an appropriately different user-facing plan.

The new family uses one established runner and one scheduled 10K on **2026-09-14**, with a start date of **2026-08-31**. The race, date, history, recovery, preferences and equipment are identical. Only priority changes:

- A: canonical running taper begins at the 14-day boundary;
- B: canonical running taper begins 5 days out;
- C: no default taper.

The fixture test asserts those three deterministic policy states directly via resolveEventTaper(). The LLM judge is then asked only for the qualitative question that deterministic tests cannot answer well: did the plans react in the right direction, without treating A/B/C as equivalent labels?

This separation matters. The exact 14/5/0 policy is a product calibration, not a scientific constant.

## Why add a subjective-vs-wearable disagreement case

The health/fat-loss family previously had normal subjective + normal Garmin, adverse subjective + adverse Garmin, and low-time + normal Garmin. That makes it impossible to tell whether the planner or judge can reason through disagreement between data sources.

The new case keeps the subjective check-in clearly favorable:

- readiness 8;
- sleep quality 8;
- fatigue 2;
- soreness 2;
- stress 3;
- motivation 8.

It pairs that with the existing clearly adverse Garmin fixture, including negative HRV delta, elevated resting heart rate and low wake body battery.

This is not intended to prove that one source should always dominate the other. The research and the repository's own evidence pack support the opposite framing: subjective and objective monitoring are complementary contextual signals with measurement limitations. The judge instruction therefore asks for a **proportionate response to disagreement**, not a diagnostic conclusion.

External research checked for this review:

- Burger et al., 2024, Athlete Monitoring Systems in Elite Men's Basketball (PMID 39464392): recommends integrating objective and subjective monitoring because each method has limitations. https://pubmed.ncbi.nlm.nih.gov/39464392/
- Monitoring Training Effects in Athletes: A Multidimensional Framework for Decision-Making, 2026 (PMID 41824225): frames readiness as a contextual operational proxy that should be interpreted longitudinally rather than as an isolated truth. https://pubmed.ncbi.nlm.nih.gov/41824225/

These sources support the **need for a disagreement test**. They do not validate the app's exact readiness thresholds; the repository's subjective-readiness evidence pack already records that limitation.

## Why add an already-trained-today case

rules.ts treats either subjective.alreadyTrainedToday=true or non-null objective.today_training as a terminal override that changes the current-day mode to recovery. That branch was previously invisible to the persona corpus.

The new balanced-performance case intentionally combines:

- good subjective readiness;
- normal Garmin;
- a same-day Strength preference;
- alreadyTrainedToday=true.

The conflict is real: readiness says the athlete could train, preference says Strength, but execution state says a substantive session has already occurred.

The fixture is explicitly **transient**. Week 0 reports already-trained; week 1 clears the flag. This prevents the synthetic simulator from accidentally interpreting a one-day completion fact as two weeks of chronic recovery.

The deterministic test checks that week 0 has the flag, week 1 does not, and the first planner decision is a recovery/rest-or-mobility selection. The judge can then assess whether the rest of the horizon preserves the balanced aerobic/strength objective rather than overreacting to a one-day execution fact.

## Why add a recent-hard-load case

The readiness engine has an explicit recent-hard-session penalty when last_3_days_hard_sessions_count >= 2, yet all prior active packets used zero.

The new established-history case keeps current subjective and Garmin readiness favorable but supplies:

- two recent planner-visible Running / Hard Endurance exposures on 2026-08-28 and 2026-08-30;
- last_3_days_hard_sessions_count=2.

The duplication between history and the summary field is intentional: the narrative/readiness summary and planner-visible exposure history must agree.

This case answers a different question from adverse recovery: can the planner avoid gratuitous quality stacking when the athlete feels good **but has already accumulated two hard sessions**?

The judge instruction is directional only. It does not impose a universal hard-session frequency limit or claim that every athlete needs the same recovery interval.

## Taper research boundary

A systematic review/meta-analysis supports tapering as a real performance strategy in endurance athletes. Wang et al. (2023; PMID 37163550) included 14 studies and found performance benefits across taper strategies; the synthesis reported effective approaches commonly reducing volume while retaining intensity/frequency over a taper of up to roughly three weeks.

https://pubmed.ncbi.nlm.nih.gov/37163550/

That evidence supports having **event-priority/taper behavior in the evaluation corpus**. It does not scientifically validate this product's exact A/B/C mapping or exact 14/5/0 windows. Those remain explicit product policy and are tested deterministically rather than smuggled into the judge as scientific truth.

## Why not add more families now

### Fixed-activity family — defer, high priority

The active suite still has no fixed activities, even though the engine can add fixed-activity load, credit objectives, deduplicate occurrence identity and fail closed on conflicting fixed-activity revisions.

This is a strong next candidate. It is deferred because a useful persona packet should expose enough activity identity for an external judge to understand what happened; the current packet projection exposes only date/title/duration/fixed. That deserves a small packet-design review first.

### Multi-event authority/contributor family — defer, high priority

The engine has explicit multi-event objective contribution and canonical contributor taper logic. A family such as A-primary + B-contributor could test whether secondary events influence the plan without stealing authority from the primary event.

This is probably the next new family after the current PR, but it should be designed around exact event timing and packet visibility rather than added opportunistically.

### Cycling-event priority — defer

The new running family establishes the A/B/C comparison pattern using the simplest category with clearly distinct default taper states. Cycling A events have a special race-week taper rule. Once the generic priority family is stable, a cycling-specific family can target that category-specific policy without conflating two new axes.

### Strength/speed/power typed outcome targets — wait for executable semantics

PR #669 merged the detailed architecture/implementation plan for typed strength, speed and power performance goals and feasibility assessment. It is a docs/plan change, not yet an executable planner authority on main.

A future persona family should cover realistic versus unrealistic target horizon, high versus low baseline confidence, target-specific frequency/capacity constraints, and strength/speed/power subject identity. Those cases should be added **after the runtime feature exists** so the persona corpus tests real product behavior rather than prose that the planner cannot yet consume.

### No-wearable endurance — defer, medium priority

No-wearable coverage currently exists only for strength. An established endurance/check-in-only family could be useful, but it mostly crosses two already-tested dimensions (missing wearable + established endurance) and does not currently outrank the untouched execution/event branches implemented here.

## Judge-calibration changes

The evaluator prompt is expanded narrowly:

- recognize A/B/C event priority directionality without demanding an exact undocumented taper percentage;
- treat conflicting subjective/objective recovery as disagreement rather than missing data;
- treat already-trained as a same-day execution fact rather than chronic fatigue;
- recognize two recent hard sessions as load context even if today's readiness is good.

The prompt still withholds planner diagnostics and per-template answer-key information.

## Fixture-integrity changes

The PR adds deterministic guards for every new axis:

- health disagreement must have favorable subjective values and clearly adverse wearable values;
- balanced already-trained must be true in week 0 and false in week 1;
- recent-hard-load must report two hard sessions and include exactly two recent hard exposures in history;
- running event family must contain exactly A/B/C, use the same date and 10K demand profile, stay event-directed, and retain the same 12-exposure Running history.

The focused test also checks the canonical taper resolver for the new A/B/C fixtures:

- A -> 2026-08-31;
- B -> 2026-09-09;
- C -> no default taper.

## Baseline policy

This PR intentionally does **not** update docs/analysis/persona-judge-baseline.json.

A baseline is evidence from an actual reviewed judge run. The current environment can change fixtures and rely on CI for deterministic generation/tests, but it does not have the configured local Ollama judge used by the committed baseline. Fabricating or copying scores would destroy baseline provenance.

After review, the correct sequence remains:

1. run persona:local:stability (or another configured provider run);
2. inspect every family, especially the six new cases;
3. verify any LLM complaint against corpus.json;
4. only then run persona:update-baseline with the reviewed flag.

Until that happens, the README explicitly states that the active fixture suite is 10/36 while the committed reviewed baseline is still the prior 9/30 corpus.

## Expected result

The expanded suite should answer four previously impossible questions:

1. Does event priority actually change the user-facing event plan in a sensible direction?
2. Does the planner handle conflicting recovery sources without silently treating disagreement as certainty?
3. Does a same-day completed-training fact suppress duplicate work without over-deloading the future?
4. Does recent hard-load density constrain quality stacking even when today's snapshot otherwise looks good?

If the suite cannot distinguish those cases, that is useful product evidence. It is a stronger failure signal than adding another persona whose only difference is age, sport label or narrative background while exercising the same planner branches.
