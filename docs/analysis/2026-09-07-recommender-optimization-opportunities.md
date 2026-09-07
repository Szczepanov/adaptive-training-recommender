# Recommender optimization analysis — 2026-09-07

## Status and scope

This document is a point-in-time analysis of the recommender after reviewing the September
2026 simulation/persona/AI-judge report and tracing the current engine on `main`, with PR
#453 as the immediate correctness change under review.

It is **analysis and prioritization**, not an accepted architecture decision. Existing ADRs,
engine code, and policy-versioned knowledge remain authoritative until a follow-up change is
accepted.

The purpose is to preserve the highest-leverage follow-up opportunities discovered during
PR #453 so they are not reduced to a short PR-comment checklist or lost after the active-dose
projection defect is fixed.

## Executive summary

The report does not show a recommender with a broad safety or feasibility failure. The clearest
quality gap is **whole-week sequencing**:

- committed persona baseline: sequencing **7.88/10**, while safety/recovery fit is 8.90,
  goal/event fit 8.80, periodization/taper 9.07, preference/capacity fit 8.77, and robustness
  8.63 (`docs/analysis/persona-judge-baseline.json`);
- committed general plan-judge baseline: sequencing **8.00/10**
  (`docs/analysis/plan-judge-baseline.json`).

The initial temptation is therefore to add another hard-session spacing rule. Repository
inspection argues against that as the first optimization. The current engine already has:

- six-dimensional fatigue (`systemic`, `cardiovascular`, `lowerBody`, `upperBody`,
  `impactTissue`, `neuromuscular`);
- dimension-specific decay;
- fatigue-adjusted candidate cost;
- explicit recovery and strength-spacing constraints;
- anchor protection and weekly-role allocation;
- high-intensity stacking suppression;
- a bounded whole-sequence beam-search prototype whose live adoption was deliberately
  deferred in ADR-0015.

The most valuable work is therefore not “more generic conservatism”. The recommended order is:

1. **Add deterministic sequencing diagnostics to the simulation/evaluation output.**
2. **Make phase-specific sequence intent first-class without creating a second training-intent owner.**
3. **Audit the lexicographic ranking tiers before changing their precedence.**
4. **Evolve occupational/manual-work modeling from the existing D-1 check-in into persistent,
   non-double-counted load context.**
5. **Harden the evaluation harness so judge drift is separable from engine drift and pairwise
   comparisons can be trusted.**

A sixth, lower-priority conclusion follows from ADR-0015: **do not revisit beam-search adoption
until items 1–3 improve the objective function used to judge a whole sequence**. A more powerful
search over an under-instrumented or phase-agnostic score can optimize the wrong thing more
consistently.

---

# 1. What PR #453 fixes, and why it comes before calibration

PR #453 fixes a state-fidelity defect: the athlete could be shown an easier `activeDose`, while
week-ahead projection still charged the full authored template for fatigue, stimulus/objective
credit, duration, and projected history.

`optimizer.materializeEffectiveDose()` already defines the correct model: an active dose scales
session duration, systemic cost, the six-dimensional cost vector, and the stimulus vector
coherently. PR #453 threads that effective dose through live week-ahead projection.

This matters to every optimization below. Sequencing policies cannot be meaningfully calibrated
when the forecast state does not represent the dose actually prescribed.

**General rule:** correctness of projected state should precede tuning of fatigue weights,
spacing constants, sequence search, or judge targets.

---

# 2. Current architecture relevant to optimization

## 2.1 Fatigue is already multidimensional

`app/src/engine/fatigue.ts` tracks six dimensions independently and decays them using different
half-lives. `computeInternalResponseStrain()` also combines subjective and objective recovery
signals with localized load signals rather than relying on one scalar “readiness score”.

That means a new generic “session overlap penalty” is likely to duplicate information already in
the fatigue vector unless it measures a distinct sequence property.

## 2.2 Occupational/manual work already exists as a D-1 input

`SubjectiveInput.physicalWork` is a structured `PhysicalWorkCheckin` with:

- performed/not performed;
- duration bucket (`short`, `medium`, `extended`);
- intensity bucket (`moderate`, `hard`, `exhausting`);
- load areas (`grip_forearms`, `upper_body`, `lower_back_spine`, `legs_carrying`).

`computeInternalResponseStrain()` maps this into systemic, upper-/lower-body, impact-tissue, and
neuromuscular strain. The report recommendation to “add occupational load” is therefore partly
stale relative to current `main`; the valuable remaining problem is **persistence, baseline vs
acute deviation, and double-count control**, not another independent occupational-load scalar.

## 2.3 The live planner is greedy, but whole-sequence search has already been prototyped

ADR-0015 records a bounded beam-search experiment. Compared with greedy planning in the then
11-scenario corpus, beam search:

- introduced no new hard-constraint or golden-week violations;
- resolved some weekly objectives that greedy left unresolved;
- changed rest/recovery frequency materially (34.5% -> 25.1% in that experiment);
- cost about 5.7x the batch scenario runtime.

The decision was to retain the greedy live planner and defer adoption, not to reject whole-week
search permanently. Importantly, the ADR identifies a second problem besides compute: the
harness could not determine whether the changed rest-day distribution was physiologically or
product-wise *better*.

That is exactly why deterministic sequence-quality metrics and phase intent should come before a
search-algorithm decision.

## 2.4 The simulation trace already exposes most inputs needed for better metrics

`app/src/engine/simulation/analyze.ts` already emits per-day `ScenarioDecisionTrace` data for:

- selected template/category/modality/duration/stimulus/projected cost;
- raw and clamped external fatigue;
- internal-response and combined fatigue vectors;
- active objectives;
- fixed-activity cost/stimulus;
- rejection counts;
- top/runner-up utility and selected-vs-best-benefit information.

This is a strong starting point. Recommendation 1 can mostly be implemented as **derived
observability**, with no production recommendation behavior change.

## 2.5 Ranking is lexicographic, not a single utility sort

The current candidate order in `optimizer.ts` is effectively:

1. `coverageNeedTier`;
2. `recoveryPreferenceTier`;
3. `benefitTier`;
4. `utilityScore`.

Within a tier, fatigue-adjusted utility matters. Across an ordinal tier boundary, it cannot win.
This is defensible for hard programming-role semantics, but it creates a concrete hypothesis for
some sequencing criticism: a substantially better fatigue-adjusted candidate can be unable to
overturn a candidate that is only slightly better on an earlier soft ordinal axis.

The right first step is to **measure how often that happens**, not to flatten the ordering into
one unconstrained score.

---

# 3. Design principles for follow-up work

1. **Observe before gating.** New sequence metrics should initially be diagnostics, not new hard
   constraints.
2. **Safety remains lexicographically dominant.** Injury, clinical, feasibility, and declared
   hard recovery constraints are not candidates for utility trade-offs.
3. **One owner per concept.** Phase intent should extend existing training-intent/periodization
   resolution; occupational defaults should not compete with the daily check-in; evaluation
   provenance should not create a second engine-output representation.
4. **Phase-specific organization beats universal spacing.** Reconditioning, VO2 development,
   threshold-density work, event-specific preparation, and taper should not be forced into one
   “optimal” hard-day pattern.
5. **Forecast truth and completed truth remain distinct.** Sequence diagnostics may inspect
   hypothetical projected work, but must not mutate performed-training truth.
6. **LLM judge scores are a secondary signal.** A score delta is most useful when paired with a
   deterministic explanation of what changed in the engine output.
7. **Prefer counterfactual instrumentation to hidden heuristic growth.** If we believe ranking
   order or phase policy is wrong, first record what the alternative winner would have been and
   why.

---

# 4. Priority 1 — deterministic sequencing diagnostics

## Problem

“Sequencing = 7.88” is useful prioritization evidence, but it does not tell us whether the
underlying failure is:

- adjacent high-cost sessions;
- loading the same fatigued tissue twice;
- placing quality too late/early relative to an event;
- spending a scarce long-duration window on low-value work;
- excessive recovery days;
- too little recovery after a dense block;
- a coverage reservation forcing a locally poor choice;
- or simply an LLM judge preference with no deterministic engine regression.

The existing simulation metrics cover constraints, rest share, objective resolution, template
streaks, fatigue tiers, and some utility fragility. They do not yet summarize **how the selected
session interacts with the residual fatigue vector or the surrounding key-session sequence**.

## Recommended metrics

### 4.1 Residual-fatigue collision score

For day `t`, using selected session cost `C_t[d]` and pre-session combined fatigue `F_t[d]` across
six dimensions:

```text
collision_t = sum_d(F_t[d] * C_t[d]) / max(epsilon, sum_d(C_t[d]))
```

Interpretation: “how much of today's planned load is being placed onto systems that are still
fatigued?”

Why normalize by cost: a tiny mobility session should not look problematic just because one
fatigue component is high.

Emit both:

- overall collision;
- top contributing dimensions (`lowerBody`, `impactTissue`, etc.).

Do **not** immediately make this a gate. First establish corpus distributions and correlate it
with existing judge sequencing criticism.

### 4.2 Adjacent cost-vector overlap

For consecutive non-recovery sessions, compare the previous effective-dose cost vector (decayed
to the current date) with the current selected cost vector.

Useful outputs:

- normalized overlap score;
- maximum two-day lower-body overlap;
- maximum two-day impact-tissue overlap;
- maximum two-day neuromuscular overlap.

This differs from residual-fatigue collision because it is explicitly a **sequence shape** metric
and can be computed even when internal readiness is neutral.

### 4.3 Quality-session spacing distribution

Record calendar-day gaps between sessions classified as key quality work for the current
phase/event context.

Do not assume that `<2 days` is always wrong. Instead report:

- minimum gap;
- median gap;
- count of adjacent quality days;
- longest quality streak;
- quality sessions per rolling 3-day and 7-day window.

Later, phase intent can decide which distributions are desirable.

### 4.4 Hard-day concentration and recovery placement

Per week, emit:

- hard/quality day count;
- maximum hard streak;
- number of recovery days immediately following a high-collision day;
- number of recovery days occurring while fatigue is low and unresolved high-priority work is
  still feasible;
- number of train-tier Rest/Mobility selections (already partially tracked).

This helps separate “unsafe density” from “unnecessarily conservative recovery”.

### 4.5 Opportunity-cost / sequence-regret diagnostics

At each selection, retain:

- selected candidate ordinal tuple;
- highest raw-utility candidate;
- highest benefit candidate;
- utility difference to the best candidate blocked only by an earlier soft tier;
- whether the selected candidate preserves a weekly-role reservation that the local utility
  winner would break.

This lets later analysis distinguish necessary coverage sacrifice from unexplained myopia.

## Suggested implementation seam

Add a pure simulation module, for example:

`app/src/engine/simulation/sequencingMetrics.ts`

It should consume existing `ScenarioDecisionTrace[]` / projected days and return an immutable
summary. Extend `ScenarioResult` with a `sequencingDiagnostics` object and expose it in simulation
artifacts and judge packets.

Avoid production behavior changes in the first PR.

## Acceptance criteria

- deterministic output for identical scenario input;
- no live recommendation change;
- unit tests for metric normalization and date-gap arithmetic;
- scenario snapshots show the new metrics;
- persona and general judge packets can include them without changing the actual plan text;
- a corpus report can answer: “which cases have the worst sequence collision, and do they overlap
  with the cases the judge scores poorly on sequencing?”

## Expected value

**Very high.** This converts the largest observed quality gap from a subjective aggregate score
into testable hypotheses and lowers the risk of tuning the wrong heuristic.

---

# 5. Priority 2 — first-class phase-specific sequence intent

## Problem

The engine has periodization, training intent, weekly objectives, plan definitions, and authored
plan blocks, but “what constitutes a good *distribution* of stress this week?” is still partly
implicit in template benefit, anchors, spacing rules, and fatigue.

That works reasonably for generic weeks but becomes limiting when different phases legitimately
want different sequence shapes.

Examples:

- **reconditioning:** low initial density; one true quality exposure may be sufficient while
  mechanical tolerance is rebuilt;
- **VO2-development:** more quality exposure may be appropriate, but still protected by recovery
  and tissue constraints;
- **threshold-density / controlled double-session work:** some clustering can be intentional;
- **race-specific build:** scarce event-specific sessions and long-duration windows deserve
  stronger protection;
- **taper:** volume falls while selected intensity/specificity may be retained; generic “avoid
  hard work” is too crude.

A universal “never schedule hard days together” rule conflicts with these use cases.

## Architecture recommendation

Do **not** introduce a second persisted phase model. Extend the existing resolution chain described
in `docs/analysis/2026-08-10-training-intent-periodization-architecture.md`.

A derived, immutable execution policy could be resolved from:

```text
PlanningContext
+ PeriodizationResult
+ TrainingIntentProfile
+ PlanDefinition / authored block (when present)
+ observed AthleteTrainingState
-> SequenceIntentPolicy
```

The exact name is not important; ownership is.

### Candidate fields

Start with a small set of sequence-shaping semantics rather than template IDs:

- `qualityExposureTarget`: expected range / target count for the planning window;
- `qualityDensityMode`: `spread` | `cluster_allowed` | `density_emphasis`;
- `minimumPreferredKeyGapDays`: **soft preference**, not a safety constraint;
- `longSessionPriority`: relative importance of preserving the largest time window;
- `strengthPlacementBias`: e.g. protect cycling/running quality from heavy lower-body strength;
- `recoveryProtection`: ordinary / elevated / taper-specific;
- `progressionMode`: recondition / build / intensify / specialize / taper (or an equivalent
  mapping from existing canonical phases).

Avoid adding fields until each changes a clearly defined planner decision.

## Separation of concerns

### Hard safety / feasibility

Still owned by existing injury, clinical, equipment, time, recovery-hour, and hard-spacing gates.
Phase intent cannot override them.

### Weekly programming requirements

Still owned by objectives / exact role allocation. Phase intent can influence where an eligible
role is best placed but must not fabricate role completion.

### Sequence preference

This new policy says how to organize otherwise valid work. That is the missing layer.

## Incremental implementation

### Phase A — observe-only

Resolve `SequenceIntentPolicy` and emit it in simulation traces without changing ranking.
Validate that scenarios receive expected phase intent.

### Phase B — soft scoring

Use phase intent only inside already-soft ranking/scoring decisions:

- protect key sessions from unnecessary adjacent moderate load;
- reward or permit intentional density when the phase says clustering is allowed;
- prefer the largest availability window for long-session roles;
- alter strength-placement preference without weakening hard strength-spacing rules.

### Phase C — whole-week planner experiment

Only after metrics are stable, re-run the ADR-0015 beam-search comparison using the phase-aware
sequence objective. This is a better adoption test than re-running the old beam search against the
same phase-agnostic utility.

## Scientific / coaching rationale

The research already cited in PR #453 does not support one universal weekly distribution rule:

- Sandbakk et al. (2025), PubMed 40278987, describes successful endurance practice where multiple
  intensive sessions can be concentrated into a smaller number of key workout days within a
  broader low-intensity structure;
- Talsnes et al. (2024), PubMed 39139482, shows lower acute internal cost when an equal
  moderate-intensity workload is split, supporting the plausibility of controlled density but
  **not** proving chronic superiority of double-threshold organization;
- Galán-Rioja et al. (2023), PubMed 36640771, reports benefits from both block and traditional
  periodization in trained cyclists.

These support making clustering **context-dependent**, not universally prohibited or required.

## Acceptance criteria

- one authoritative resolver, no second persisted phase source;
- explicit provenance/diagnostics for why a density policy was selected;
- phase-intent unit tests across reconditioning/build/specialization/taper contexts;
- safety and exact-role invariants unchanged;
- simulation can compare sequence metrics by phase before any policy is promoted to a gate.

## Expected value

**Very high but more architectural than Priority 1.** This is the most promising route to improve
sequencing without simply making the system more conservative.

---

# 6. Priority 3 — audit lexicographic ranking tiers

## Problem

The current ranking order protects important semantics but can create large discontinuities:

```text
coverageNeedTier
-> recoveryPreferenceTier
-> benefitTier
-> utilityScore
```

Suppose candidate A is one benefit tier better by a tiny margin, while candidate B is materially
cheaper against today's residual fatigue. B cannot win across the tier boundary, regardless of
its utility advantage.

That may be correct when the earlier tier encodes a required weekly role. It is less obviously
correct when the difference is a soft benefit bucket or a recovery preference.

## Do not flatten the ranking yet

A single weighted score would make behavior harder to reason about and could allow a strong
preference or utility term to override exact weekly-role semantics. The current lexicographic
structure has real safety/interpretability value.

Instead, instrument the discontinuities.

## Recommended decision-trace additions

Per accepted candidate, record:

```text
coverageNeedTier
recoveryPreferenceTier
benefitTier
benefitScore
costPenalty
utilityScore
```

For the selected day, also compute:

- `bestUtilityTemplateId`;
- `bestUtilityScore`;
- `selectedVsBestUtilityGap`;
- `utilityWinnerBlockedByCoverageTier`;
- `utilityWinnerBlockedByRecoveryTier`;
- `utilityWinnerBlockedByBenefitTier`;
- `selectionPreservedRequiredRoleAllocation`.

Aggregate counts by scenario/persona/phase.

## Key questions the audit should answer

1. How often does the lexicographic winner differ from the pure-utility winner?
2. How large is the foregone utility when they differ?
3. Which tier causes the difference?
4. Are the differences concentrated in low-scoring sequencing cases?
5. Does the current winner protect an exact weekly role that the utility winner would make
   infeasible?
6. Are large gaps mostly caused by fatigue cost, preference multipliers, or raw stimulus benefit?

## Candidate policy changes — only after measurement

### Option A — keep coverage strict, soften benefit tiers

Preserve `coverageNeedTier` as an ordinal contract, but allow utility to arbitrate across adjacent
benefit tiers when benefit difference is within a narrow evidence-backed band.

### Option B — bounded override

Allow a lower soft tier to win only when:

- no required-role feasibility is lost;
- utility improvement exceeds a calibrated ratio/absolute gap;
- safety/recovery hard gates are unchanged.

### Option C — Pareto frontier within the same programming role

When two candidates satisfy the same role, discard candidates dominated on both objective benefit
and fatigue cost before lexicographic sorting.

This can reduce arbitrary bucket effects without weakening role semantics.

## Acceptance criteria for an audit PR

- zero production behavior change;
- deterministic counterfactual traces;
- corpus report with counts and utility-gap distributions;
- explicit list of the top 20 largest ordinal-vs-utility disagreements;
- judge-case cross-reference for sequencing scores;
- a follow-up ADR only if data justifies changing precedence.

## Expected value

**High.** This is a plausible source of locally poor sequencing and is cheap to measure relative
to redesigning the planner.

---

# 7. Priority 4 — evolve occupational/manual-work modeling, do not re-add it

## Current state

The current engine already captures preceding-day unlogged manual work through
`SubjectiveInput.physicalWork`, and `computeInternalResponseStrain()` turns it into dimensional
fatigue floors.

This is a meaningful capability and should be preserved.

## Remaining gaps

### 7.1 No durable “usual work” baseline

A user with a physical job may have to repeatedly report what is normal. Conversely, treating a
normal occupational day as an exceptional acute event every day can keep the system permanently
conservative.

### 7.2 Baseline vs acute deviation is not explicit

The decision-relevant distinction is often:

```text
normal workload for this athlete
vs
unusually long / heavy / localized workload today
```

not simply “manual work occurred”.

### 7.3 Double-count risk

The same real-world load can appear through several channels:

- physical-work check-in;
- subjective fatigue/soreness;
- ambient step surge;
- possibly a logged activity or fixed activity.

The current use of `max`-style floors already reduces some additive double counting, but the
system should make source overlap observable rather than relying on incidental saturation.

### 7.4 Repeated exposure and adaptation are not represented explicitly

A one-off three-hour carrying job and the same task performed five days every week should not
necessarily have the same prior interpretation, even if the acute day still matters.

## Recommended model

Keep `PhysicalWorkCheckin` as the daily acute authority. Add, only if product need justifies it, a
small user-authored or conservatively inferred **occupational load baseline** such as:

- usual workdays;
- typical duration/intensity buckets;
- typical load areas;
- confidence/source (`user_authored`, `history_inferred`, `unknown`).

Then derive:

```text
acute work strain = today's load relative to usual exposure
```

Do not infer load from occupation title (“construction worker”, “nurse”, etc.). Job title is too
heterogeneous to be a safe physiological proxy.

## Double-count diagnostics

For every readiness computation, record which sources contributed materially:

- subjective fatigue;
- soreness;
- physical work;
- ambient steps;
- wearable recovery;
- completed training.

Add a debug-only overlap indicator such as:

`physicalWorkAndAmbientStepSurge = true/false`

and measure how often both are active.

If later calibration shows systematic overreaction, change fusion policy intentionally rather than
silently lowering one threshold.

## Acceptance criteria

- daily explicit check-in always overrides inferred baseline;
- missing baseline behaves exactly like current `main`;
- no occupation-title inference;
- no additive double charging by default;
- scenario coverage for normal physical worker, unusually heavy workday, step-heavy non-work day,
  and physical work plus logged training;
- judge/persona packets clearly distinguish “usual baseline” from “acute deviation”.

## Expected value

**Medium-high overall, very high for athletes with physical occupations.** The core capability
already exists; the opportunity is better context, not a new scalar.

---

# 8. Priority 5 — evaluation harness hardening

The repository already has a comparatively strong evaluation stack:

- deterministic simulation scenarios;
- plan-judge corpus and drift checks;
- persona corpus and drift checks;
- prompt/schema/case-set hashes;
- model provenance;
- repeated samples and MAD-based stability handling;
- deterministic invariant gates.

The next improvements should make it easier to separate **engine change**, **corpus change**, and
**judge noise**.

## 8.1 Engine-output identity pre-check

Before interpreting an LLM score delta, compute a canonical hash of the actual engine output used
for each judge case.

Suggested provenance per case:

```text
engineInputSha256
engineOutputSha256
normalizedPlanSha256
```

If baseline and current engine outputs are byte-/semantically identical but judge scores differ,
classify that delta as judge variance rather than an engine regression.

At summary level, report:

- identical-output case count;
- changed-output case count;
- score changes on identical-output cases;
- score changes only on changed-output cases.

This would materially improve the signal quality of `check-plan-judge-drift.mjs` and
`check-persona-judge-drift.mjs`.

## 8.2 Pairwise judging with order reversal

Absolute 0–10 scores are useful for dashboards but are noisy for deciding whether PR B is better
than baseline A.

For behavior-changing PRs, add an optional blind pairwise mode:

1. present A/B without branch names;
2. ask which plan is better on each rubric axis and why;
3. repeat with B/A order;
4. require preference consistency or classify as unstable;
5. retain absolute scoring as secondary context.

Recommended outputs:

- A wins / B wins / tie;
- order-reversal agreement;
- per-dimension preference;
- judge confidence;
- deterministic engine-output diff alongside the preference.

Do not make pairwise judging mandatory for every documentation-only PR; use it for meaningful
engine behavior changes.

## 8.3 Expand the triathlon persona ladder

The committed persona baseline currently includes one
`persona_triathlon_established_olympic` family. That is valuable but does not cover the range of
triathlon planning problems.

Add at least:

- novice / low-history sprint-distance athlete;
- established Olympic-distance athlete (existing family);
- established 70.3 athlete with larger long-session and fueling/availability demands.

A long-course/Iron-distance family should be added only when the engine has explicit requirements
and enough swim/bike/run/fueling context to judge it without inventing unsupported assumptions.

Each family should have controlled perturbations for recovery, time, missing modality/equipment,
and race proximity.

## 8.4 Convert judge critique into deterministic failure tags

LLM rationales are rich but difficult to aggregate. Add a post-processing taxonomy such as:

- `adjacent_quality_density`;
- `same_tissue_stack`;
- `excess_recovery`;
- `late_quality_before_event`;
- `unresolved_priority_objective`;
- `phase_mismatch`;
- `capacity_miss`;
- `preference_miss`;
- `unsupported_assumption`.

The tagger should not replace raw rationale. Its purpose is to show whether 20 different judge
comments are actually the same planner failure.

## 8.5 Simulation fidelity check discovered during this review

`app/src/engine/simulation/analyze.ts::toCompletedExposure(day)` currently constructs the next
completed exposure from `day.template` fields directly. A `WeekAheadDay` can carry an
`activeDose`, so a multi-week simulation can potentially roll a reduced displayed dose forward as
full authored duration/cost/stimulus.

That is a **simulation/evaluation fidelity issue**, analogous to the live projection issue fixed by
PR #453, and should be reviewed in a small follow-up. The simulation should materialize the
effective dose before creating the synthetic completed exposure, while retaining authored template
identity.

This is not a reason to expand PR #453 indefinitely, but it is high-value because inaccurate
simulation roll-forward can hide or fabricate the effect of future tuning.

## Acceptance criteria

- unchanged engine outputs are identifiable before judge comparison;
- pairwise mode is reproducible and order-balanced;
- new persona families are deterministic and provenance-hashed;
- critique tags can be traced back to raw judge rationale;
- active-dose simulation roll-forward uses the same effective-dose contract as production
  projection;
- judge drift scripts still fail closed on prompt/schema/model incompatibility.

## Expected value

**High.** Better evaluation prevents optimization toward judge noise and makes the other four
priorities safer to execute.

---

# 9. Why not add a universal hard-day adjacency ban?

The engine already contains true hard recovery constraints where the repository has decided they
are required. Adding a second universal “no hard days together” rule would mix three different
concepts:

1. **safety / recovery infeasibility** — should remain a hard gate;
2. **ordinary preferred distribution** — should be phase-specific soft intent;
3. **deliberate training density** — may be appropriate for selected trained athletes/phases.

The scientific evidence cited above supports context-dependent organization and does not establish
one universal adjacency rule for all athletes and mesocycles.

The better path is:

```text
accurate effective dose
-> deterministic sequence diagnostics
-> explicit phase intent
-> ranking counterfactual audit
-> behavior change
-> pairwise + deterministic evaluation
```

not:

```text
low sequencing judge score
-> another hard-coded spacing constant
```

---

# 10. Revisit of ADR-0015 beam search

Whole-sequence search remains interesting because the original prototype did resolve objectives
that greedy missed. But search quality is bounded by the score it optimizes.

Revisit only after:

1. sequencing diagnostics exist;
2. phase-specific sequence intent exists;
3. rank-tier disagreements are understood;
4. single-call latency/memoization is profiled;
5. rest-day-frequency changes can be evaluated against deterministic phase-aware targets rather
   than one broad global percentage bound.

At that point compare at least:

- current greedy;
- greedy + phase-aware scoring;
- bounded beam + phase-aware scoring.

The key question should not be “does beam resolve more objectives?” but:

> Does whole-sequence search improve phase-appropriate sequence quality and objective resolution
> without worsening safety, recovery adequacy, adherence proxies, or operational latency?

---

# 11. Proposed implementation sequence

## PR A — sequencing observability (no behavior change)

- add `sequencingMetrics.ts`;
- extend `ScenarioResult` and artifacts;
- add rank counterfactual fields needed for Priority 3;
- add report script ranking worst sequence collisions;
- correlate with persona/general judge sequencing cases.

**Risk:** low.

## PR B — evaluation fidelity and identity

- materialize active dose in simulation roll-forward;
- add per-case engine-output hashes;
- teach drift scripts to classify identical-output judge drift;
- add deterministic tests.

**Risk:** low; high leverage for later experiments.

## PR C — phase-intent observation model

- add derived `SequenceIntentPolicy` (or equivalent);
- map existing periodization/training-intent contexts to it;
- emit diagnostics only;
- add scenario coverage.

**Risk:** low-medium because it introduces a new derived semantic model but does not yet change
selection.

## PR D — ranking-tier experiment

- use accumulated diagnostics to select one bounded policy experiment;
- compare baseline vs candidate using deterministic metrics + pairwise judge;
- do not change coverage/hard-safety semantics.

**Risk:** medium.

## PR E — phase-aware sequencing behavior

- make the smallest phase-intent terms live;
- verify against macrocycle-specific fixtures/personas;
- decide whether greedy is sufficient.

**Risk:** medium-high because recommendation behavior changes across many weeks.

## PR F — beam-search re-evaluation (optional)

- only if greedy remains measurably myopic after phase-aware scoring;
- profile latency and memoization;
- stage behind a simulation/feature selector before live adoption.

**Risk:** high blast radius; not justified as the immediate next PR.

Occupational-load persistence can proceed in parallel with PR C/D because it is largely orthogonal
to the sequence-search architecture, provided its changes are covered by the same deterministic
metrics and persona corpus.

---

# 12. Priority matrix

| Opportunity | Expected impact | Confidence | Engineering effort | Behavior risk | Recommended timing |
|---|---:|---:|---:|---:|---|
| Deterministic sequencing diagnostics | Very high | High | Low-medium | Low | Next |
| Evaluation identity + active-dose simulation fidelity | High | High | Low-medium | Low | Next / parallel |
| Phase-specific sequence intent | Very high | Medium-high | Medium-high | Medium | After diagnostics |
| Lexicographic ranking audit | High | High for measurement, medium for policy change | Low for audit / medium for change | Low for audit | After diagnostics |
| Occupational baseline / acute-deviation context | Medium-high overall; very high for manual workers | Medium | Medium | Medium | Parallel follow-up |
| Pairwise judge + triathlon ladder | High evaluation value | High | Medium | No live behavior | Parallel |
| Beam-search live adoption | Potentially high | Medium-low until objective improves | High | High | Deferred |

---

# 13. Success criteria for the optimization program

Do not define success as “sequencing judge average reaches X”. A robust outcome should combine:

### Deterministic correctness

- zero hard-constraint regressions;
- exact role/coverage semantics preserved;
- active dose represented consistently in live and simulation state;
- no new unsupported data inference.

### Sequence quality

- lower residual-fatigue collision where the phase prefers spread quality;
- no penalty for intentional density where the phase explicitly permits it;
- fewer unexplained high-utility candidates blocked by soft ordinal discontinuities;
- required roles remain feasible and resolved.

### Evaluation quality

- judge deltas on identical engine output are classified as measurement variance;
- pairwise A/B preference is stable under order reversal;
- persona families cover materially different training states, not only perturbations of one
  endurance archetype.

### Operational quality

- week-ahead latency remains within an explicit budget;
- diagnostics are cheap enough for CI/simulation and do not require LLM execution;
- complex search is introduced only if it beats a phase-aware greedy baseline on meaningful
  metrics.

---

# 14. Concrete next recommendation

After PR #453 is merge-ready, the best next engineering change is **not another training rule**.
It is a small, behavior-neutral PR that adds deterministic sequencing and ranking-counterfactual
metrics to `simulation/analyze.ts` and the scenario artifacts, plus the active-dose simulation
roll-forward correction identified above.

That PR should produce a ranked report of the worst sequencing cases across both deterministic
scenarios and persona cases. Only then should the repository choose whether the next live behavior
change belongs in phase intent, rank-tier policy, or whole-sequence search.

This keeps optimization evidence-driven, minimizes accidental conservatism, and makes future
judge-score movement explainable in terms of actual planner behavior.

---

## Repository references

- `app/src/engine/planner.ts` — live greedy week-ahead planner and projection diagnostics.
- `app/src/engine/optimizer.ts` — candidate hard gates, benefit/cost utility, lexicographic ranking,
  effective-dose materialization.
- `app/src/engine/fatigue.ts` — six-dimensional fatigue, D-1 physical-work handling, decay/fusion.
- `app/src/engine/models.ts` — `PhysicalWorkCheckin`, readiness, fatigue, cost/stimulus models.
- `app/src/engine/simulation/analyze.ts` — scenario traces and aggregate metrics.
- `app/src/engine/sequenceSearch.ts` — bounded beam-search prototype.
- `app/scripts/compare-sequence-search.mjs` — greedy vs beam comparison harness.
- `app/scripts/check-plan-judge-drift.mjs` — general judge drift/provenance gate.
- `app/scripts/check-persona-judge-drift.mjs` — persona judge drift gate.
- `docs/adr/0015-sequence-planning-and-session-role-model.md` — accepted decision to retain greedy
  and defer beam adoption.
- `docs/analysis/2026-08-10-training-intent-periodization-architecture.md` — existing training-intent
  ownership and periodization analysis.
- `docs/analysis/plan-judge-baseline.json` — committed general judge baseline.
- `docs/analysis/persona-judge-baseline.json` — committed persona baseline.
- `docs/macrocycle-v5.md` — current macrocycle implementation/reference documentation.

## Research references already used in PR #453

- Sandbakk et al. (2025): https://pubmed.ncbi.nlm.nih.gov/40278987/
- Talsnes et al. (2024): https://pubmed.ncbi.nlm.nih.gov/39139482/
- Cove et al. (2025): https://pubmed.ncbi.nlm.nih.gov/39788807/
- Galán-Rioja et al. (2023): https://pubmed.ncbi.nlm.nih.gov/36640771/

These references motivate context-dependent training organization; they do not define universal
hard thresholds for this engine.