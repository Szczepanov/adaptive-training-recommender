# Persona simulation + AI plan judge review

**Date:** 2026-08-27  
**Status:** Implemented evaluation layer  
**Scope:** Synthetic persona simulations for heterogeneous real-world users; independent AI judging of resulting plans.

## Executive conclusion

The repository was already much closer to this idea than it first appears.

It already has:

- a deterministic multi-week scenario harness in `app/src/engine/simulation/`;
- hard invariant/adversarial tests;
- a plan-judge corpus with sensitivity families;
- pointwise AI judging with strict JSON validation and multi-sample stability aggregation;
- blinded/pairwise comparison support and an optional position-bias check.

What it did **not** have was a durable concept of different user archetypes. Existing judge families mostly perturb one physiological/planning axis around a common cyclist-like base case. That is excellent for rule sensitivity but weaker for a product question such as: *does the same engine behave appropriately for a strength athlete with no wearable, a health/fat-loss user with Garmin, and a former elite endurance athlete returning from intermittent training?*

This change adds that missing layer without putting real friends' names or personal health details into a public repository.

## Why personas are different from ordinary scenarios

A scenario answers: **what should happen if one input changes?**

A persona answers: **what does “good” mean for this type of user over many different current states?**

A useful persona therefore combines relatively stable characteristics with state perturbations:

- goal hierarchy;
- current training identity;
- available data sources;
- equipment/time constraints;
- relevant non-training load;
- current-vs-historical training background;
- injury/guardrail context;
- several day states such as normal recovery, fatigue, pain, missing data or conflicting signals.

The implementation keeps those two layers separate. Persona metadata is judge context; the planner receives only fields that already exist in production (`UserContext`, `TrainingIntentProfile`, preferences, readiness/check-in, wearable objective data and active guardrails). This is deliberate: an evaluation fixture should not silently give the planner powers production does not have.

## Added synthetic personas

### 1. Strength + manual work + no wearable

Decision-relevant characteristics:

- no Garmin or other objective recovery source;
- subjective check-in is the primary recovery signal;
- physically demanding occupation adds non-training fatigue through soreness/fatigue/stress reporting;
- maximal-strength orientation with bench/deadlift emphasis;
- intermittent shoulder/back symptoms;
- active symptoms tighten `avoid_overhead_pressing` and `avoid_heavy_spinal_loading` guardrails.

State cases:

1. normal check-in;
2. high occupational fatigue/soreness;
3. active shoulder/back symptom flare.

Critical evaluation principle: **wearable absence is not adverse physiology.** It must remain `null`, not be silently replaced with population-normal HRV/RHR/sleep values.

### 2. Health + fat-loss + Garmin

Decision-relevant characteristics:

- Garmin plus subjective check-in;
- evergreen goal: sustainable fat loss and cardiometabolic/general health;
- no event and no reason to peak;
- strength plus aerobic exposure should coexist;
- training recommendations should not invent calorie targets when nutrition/body-mass data are not provided.

State cases:

1. normal recovery;
2. adverse wearable + subjective recovery;
3. normal recovery but only 30 minutes available.

### 3. Former high-level endurance athlete returning from intermittent training

Decision-relevant characteristics:

- Garmin plus subjective check-in;
- current running is intermittent;
- historical high-level endurance/biathlon background;
- current history is intentionally sparse.

State cases:

1. good Garmin day with sparse current history;
2. adverse recovery despite strong historical background;
3. low motivation alone without physiological red flags.

Critical evaluation principle: **historical athletic identity is not current load tolerance.** The engine must not fabricate present training history or unlock an elite dose merely because a user was formerly elite.

## AI-judge design

`app/scripts/run-persona-ai-judge.mjs` reuses the repository's existing judge-provider abstraction, strict response schema, semantic validation, sample seeding and median/MAD aggregation.

It intentionally sends a compact packet containing:

- anonymized persona facts;
- current readiness and declared data availability;
- goals, constraints, preferences and evergreen intent;
- selected multi-day plan;
- only a small output summary.

It does **not** show the evaluator planner utility/rejection internals as an answer key. The candidate must be judged from user-facing evidence.

Run deterministic simulation only:

```bash
cd app
node scripts/run-persona-ai-judge.mjs --build-only
```

Run with any existing configured judge provider:

```bash
cd app
node scripts/run-persona-ai-judge.mjs --provider local --samples 3
# or --provider openai / gemini / deepseek using the same environment configuration
```

Artifacts are written under:

```text
app/artifacts/persona-plan-judge/latest/
  corpus.json
  families.jsonl
  judge-prompt.md
  judge-scores.jsonl       # after an AI-judge run
  judge-stability.json     # after an AI-judge run
```

## What the judge should score

The implementation intentionally keeps the existing plan-judge score contract so downstream tooling remains reusable, but gives the dimensions persona-specific semantics:

- `safety_recovery_fit` — current pain/fatigue/recovery and active guardrails;
- `goal_event_fit` — persona goal fit; these fixtures are event-free;
- `sequencing` — multi-day load coherence;
- `periodization_taper` — sustainable evergreen progression and *absence* of fake race tapering;
- `preference_capacity_fit` — time/equipment/preferences **and data-source fidelity**;
- `robustness` — sparse data, occupational fatigue, current-vs-historical uncertainty;
- `overall` — holistic quality.

The family-level sensitivity score then asks whether the plan changed proportionally when the **same persona's current state** changed.

## Deterministic checks remain the first safety layer

LLM judging is supplemental, not the oracle. `personaScenarios.test.mjs` and `assertPersonaFixtureIntegrity` verify facts the evaluator should never be asked to guess:

- exactly three anonymized families / nine state cases;
- no real-person names in public persona metadata;
- no-wearable objective fields remain `null`;
- active symptom flare explicitly sets pain plus relevant guardrails;
- health persona actually carries `health` intent;
- former-elite persona does not receive fabricated current training history.

A future improvement should add output-level invariants only when the desired behavior can be stated unambiguously as a hard product/safety contract. Subjective quality preferences should stay in the judge layer rather than being smuggled into brittle tests.

## Research basis

### Subjective monitoring is not a second-class fallback

Saw et al. reviewed 56 studies and found subjective well-being measures were generally more sensitive and consistent in tracking acute/chronic training response than commonly used objective measures, with little consistent correlation between the two. This supports treating a well-designed check-in as a valid primary signal for a user who owns no wearable rather than fabricating wearable-like values.

- Saw AE et al. *Monitoring the athlete training response: subjective self-reported measures trump commonly used objective measures: a systematic review.* Br J Sports Med. 2016. https://pubmed.ncbi.nlm.nih.gov/26423706/
- Duignan CM et al. *Single-Item Self-Report Measures of Team-Sport Athlete Wellbeing and Their Relationship With Training Load: A Systematic Review.* J Athl Train. 2020. https://pubmed.ncbi.nlm.nih.gov/32991706/

### Health/fat-loss programming should not collapse into cardio-only or maximal-HIIT thinking

A 2024 network meta-analysis in adults with overweight/obesity found aerobic, resistance, combined and HIIT modalities can improve different metabolic outcomes. A 2025 systematic review/meta-analysis found aerobic and concurrent training outperform resistance-only training for some absolute fat-loss outcomes, while resistance training helps preserve fat-free mass. For a product-level persona evaluator, that argues for sustainable mixed training rather than equating fat loss with maximal cardio volume or HIIT frequency.

- Wang H et al. *Comparative efficacy of exercise training modes on systemic metabolic health in adults with overweight and obesity: a network meta-analysis of randomized controlled trials.* Front Endocrinol. 2024. https://pubmed.ncbi.nlm.nih.gov/PMC10823366/
- *Comparison of concurrent, resistance, or aerobic training on body fat loss: a systematic review and meta-analysis.* 2025. https://pubmed.ncbi.nlm.nih.gov/40405489/

### Former elite status cannot substitute for present capacity

A 2024 systematic review of detraining in endurance athletes reports declines in VO2max, lactate-threshold-related variables and performance after training cessation. The exact amount varies by athlete and detraining duration, but the product implication is strong: historical performance should not automatically unlock a current elite dose.

- *Cardiorespiratory and metabolic consequences of detraining in endurance athletes.* 2024. https://pubmed.ncbi.nlm.nih.gov/38344385/

### LLM judge is useful, but only with guardrails

LLM-as-judge can approximate human preference at useful scale, but published work documents position, verbosity and self-preference biases. G-Eval shows the value of explicit criteria and structured form-style scoring. The existing repository already addresses several of these concerns with strict schemas, multiple samples, blind packets and optional pairwise order swapping; the persona runner adds explicit anti-verbosity/source-discipline instructions and keeps deterministic facts outside the judge.

- Zheng L et al. *Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena.* 2023. https://arxiv.org/abs/2306.05685
- Liu Y et al. *G-Eval: NLG Evaluation using GPT-4 with Better Human Alignment.* EMNLP 2023. https://aclanthology.org/2023.emnlp-main.153/
- Shi L et al. *Judging the Judges: A Systematic Study of Position Bias in LLM-as-a-Judge.* 2024. https://arxiv.org/abs/2406.07791

## Important product gaps this evaluation is meant to expose

The persona harness deliberately does **not** pretend these are already solved:

1. **Occupational physical load has no dedicated production field.** Today it reaches the engine indirectly through fatigue/soreness/stress. If persona runs repeatedly show under-recovery after manual work, add explicit non-training physical-load modeling rather than teaching the judge to excuse it.
2. **`strength_muscle` is broader than powerlifting/max-strength intent.** If the strength persona repeatedly receives hypertrophy/general-strength work that is safe but poorly specific, the production intent model likely needs a `max_strength` objective or a more granular strength goal profile.
3. **Fat loss is represented as a health goal, not a dedicated training intent.** That is probably correct for the training engine unless body-composition/nutrition support becomes a first-class product feature, but the evaluator will show whether the current health strategy is adequate.
4. **Historical athletic background is not yet a formal planner input.** This is safer than automatically trusting it. A future physiological/user passport may expose historical competence as a prior, but current evidence and recent training must dominate current dose.
5. **Injury history vs active restriction should remain separate.** Historical shoulder/back issues should not permanently ban movements; active symptoms/clinician restrictions should activate guardrails. The persona pair makes that distinction explicit.

## Recommended acceptance workflow

For changes that materially affect planning:

1. run the deterministic unit/invariant suite;
2. build the normal plan-judge corpus;
3. build the persona corpus;
4. run the AI judge with 3-5 samples for these three families;
5. inspect stability (MAD/spread) rather than trusting one score;
6. if comparing two planner policies, use the repository's existing blind/pairwise order-swap path for the general corpus and add a persona pairwise extension only when there is a concrete A/B policy question;
7. periodically calibrate judge decisions against human review, especially for safety-adjacent disagreements.

The goal is not to make the AI judge the coach. The goal is to use heterogeneous synthetic users as a **regression surface** so optimization for one athlete archetype does not silently degrade recommendations for another.
