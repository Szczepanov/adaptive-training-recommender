# Training-intent and periodization architecture analysis — 2026-08-10

## Scope

This is a point-in-time analysis of merged `main` at `34ddc30`, after PR #17. It
examines how an athlete's intent, capacity, event state, preferences, and coverage reach
the recommendation engine. It is evidence for the Phase 7 proposals, not an accepted
design; current code remains authoritative.

## Evidence summary

| Area | Verified current behaviour | Consequence |
|---|---|---|
| Eventless planning | `periodization.ts` `evaluatePeriodizationPhase` returns Base plus `DEFAULT_BASE_DEMAND`; `microcycle.ts` `generateWeeklyObjectives` then derives a fixed endurance/quality/strength weekly shape. | An eventless athlete is treated like a generic event, regardless of capacity or stated goal. |
| Capacity | `TrainingSettings.defaults` and `UserPreferences` hold per-session duration limits; no model holds weekly minimum, target, or maximum session count. | Weekly targets cannot be sized to the athlete. |
| Event direction | `evaluatePeriodizationPhase` returns an eligible focus event for cycling, running, triathlon, strength, and general events; simulations cover each. | A rich cycling `PlanDefinition` is not the same concept as being event-directed. |
| Structured plan capability | `planSchedule.ts` `resolvePlanDefinitionForEvent` returns a plan only for `cycling_event`. | Non-cycling events retain demand-derived objectives but do not have authored coverage plans. |
| Coverage | `coverage.ts` builds coverage from a plan definition and imports a cycling event coverage constant. | Exact weekly programming-role coverage is unreachable outside the cycling plan. |
| Preferences | `UserPreferences` owns duration defaults, modality preference arrays, recovery style, conservative bias, recovery margin, verbosity, and units. | A second persisted live owner for any of these fields would require migration and precedence rules. |
| Taper | `taperPolicy.ts` `resolveEventTaper` applies a legacy A/B fallback after the cycling-specific rule. | A 5-star dated `general_target` may receive an unintended default taper. |
| Weekly allocation | `planner.ts` `generateWeekAheadPlan` is a greedy day loop; `resolveWeeklyAnchors` nominates but does not reserve dates. | Supporting work can eliminate a later required role opportunity. |

## Relevant invariants

1. **Safety outranks planning.** Injury, feasibility, readiness, fatigue ceilings, spacing,
   and anchor protection may remove or move work; a plan must report rather than override
   that outcome.
2. **Exact identity outranks inferred role.** ADR-0016's coverage semantics prohibit
   awarding a programming role from title, broad modality, or stimulus overlap alone.
3. **Existing event-directed behaviour is a compatibility contract.** A profile migration
   must not change the current cycling, running, triathlon, strength, or general event
   scenarios merely because a rich coverage plan is unavailable for one category.
4. **Capacity is cardinality, not a promise of invented sessions.** Required role
   occurrences must fit stated capacity or produce a transparent, semantics-preserving
   shortfall; a guideline lower bound is not automatically a biological minimum. A session
   can fan out across adaptation credit, but only explicit authored mappings can award
   multiple programming roles.
5. **Forecast allocation is not completed training.** Projection diagnostics must not
   mutate completion credit or replace recommendation provenance.

## Design implications evaluated

### Planning mode and event capability are separate axes

The existing demand-derived paths make running, triathlon, strength, and general goals
genuine event-directed contexts. The absence of a cycling-style `PlanDefinition` means
only that they lack a `structured_plan` capability today. Treating that gap as Evergreen
would change the established periodization and fail the existing event-scenario
compatibility contract.

The proposed `PlanningContext` therefore needs both an effective `PlanningMode` and an
`EventStrategy`: `structured_plan` where a plan definition exists, `demand_derived` for an
eligible event without one, and `null` in Evergreen mode.

### One owner per persisted preference

The planned durable profile has a coherent narrow role: mode, priorities, weekly session
capacity, and executable organization policy. Existing user preferences already own the
execution-level choices. Copying fields such as duration, modality preference, or
conservative bias would create contradictory valid states and a permanent merge policy.
Hard modality unavailability should extend the existing preference model and reuse the
hard restriction path.

### Science policy must precede capacity and packing

The evidence cited here is expressed primarily as dose dimensions (minutes, volume,
frequency/exposure, intensity, progression, and specificity), not application session
counts. The proposed implementation therefore resolves **goal/event context + inferred
training state + evidence policy → adaptation-dose requirements → real time/session/window
capacity → preference-compatible implementation → exact weekly role packing →
readiness/history execution adaptation**.

`AthleteTrainingState` should be inferred conservatively from existing completed history:
recent weekly duration/frequency, strength/aerobic/quality exposure, consistency/training
age proxy, tolerated load/progression, and sport-specific history. It must expose observed
history coverage, inference data quality, and diagnostics. This is not a literal training-
age claim; sparse or contradictory history must fall back toward `unknown`. Readiness is a
daily execution modifier, not a substitute for that prior.

The useful meaning of a `min / target / max` schedule is capacity, not a physiological
definition:

* evidence/goal minimums are independently derived, then packed into `minSessions` plus
  usable time/windows;
* required plus target coverage fits `targetSessions` and real time where feasible;
* optional/stretch work alone uses capacity through `maxSessions`.

When dose cannot be packed, the result preserves the requirement's semantics. Under a
population guideline range, 120 minutes of a 150–300-minute target is
`below_guideline_range` (or `guideline_target_shortfall`), not proof that benefit is zero
or a physiological failure. `goal_requirement_shortfall` applies to unmet
specificity/performance requirements; `minimum_dose_shortfall` is reserved for a genuine
evidence-supported minimum. No result justifies manufacturing a combined session, crediting
unrelated work as coverage, or lowering an underlying requirement to the user's session
count. The initial 2–6-session table is consequently a low-confidence product packing
heuristic, never the source of an adaptation requirement.

### Stateful feasibility is required for Phase 7A

Candidate role/date edges are not independent: a selected future session changes fatigue,
projected history, quality spacing, hard-lower-body spacing, and anchor protection for the
next session. A bipartite matching over individually feasible edges can therefore overstate
the jointly achievable role count. The smallest correct solver is a bounded deterministic
search over required role occurrences only, applying the existing projected-date evaluator
after every tentative assignment. It is distinct from ADR-0015's whole-horizon utility
beam search.

The measurable reservation invariant is a seven-date horizon, at most 14 required
occurrences, at most four canonically sorted exact candidates per occurrence, depth at most
the occurrence count, and 1,024 projected-state-transition nodes. The same budget applies
to every support/Rest viability check. Pruning can discard only a branch unable to beat the
best known fulfilled count; a cap returns the deterministic best-known partial result with
`unresolved_search_budget`, never a false infeasibility miss. A p95 <=50 ms / p99 <=100 ms
fixture budget is operational only; wall-clock time is not a semantic cut-off.

## Initial policy evidence and provenance

The following table is intentionally narrow: it identifies what supports an initial rule
and, equally importantly, what it does **not** support. It is not a universal training
prescription.

| Initial policy rule | Source | Population and outcome | Confidence / use in the engine |
|---|---|---|---|
| Health-priority guideline target | [WHO physical-activity guidance](https://www.who.int/initiatives/behealthy/physical-activity) | General adults; 150–300 minutes moderate aerobic activity (or equivalent) and muscle strengthening on 2+ days/week for health benefit. | High for a population guideline range, not a biological no-benefit threshold. Below-range dose remains meaningful and is reported separately from a true minimum-dose failure. |
| Strength/hypertrophy dose | [ACSM 2026 resistance-training position-stand overview](https://acsm.org/science-spotlight-acsm-releases-new-position-stand-on-resistance-training/) | Healthy adults; resistance-training prescription for muscle function, hypertrophy, and performance. | Medium for outcome-specific dose framing; Phase 7 must retain population/training-status caveats rather than map it directly to one universal weekly template. |
| Frequency as session packing | [Volume-equated hypertrophy frequency meta-analysis](https://pubmed.ncbi.nlm.nih.gov/30558493/) | Healthy adults in resistance training; frequency's hypertrophy effect is not meaningful when volume is equated. | Medium: supports treating a third strength day as a distribution/preference choice, not a required outcome rule. |
| Initial 2–6 session allocation table | Repository product policy | Capacity packing of required/target/optional roles. | Low as scientific evidence: versioned heuristic only, to be calibrated against explicit minimum-dose shortfall, adherence, readiness, and outcome evidence. |

Each implementation rule that claims scientific authority must retain: source,
population, outcome, confidence, applicability conditions, authority class
(`guideline_target`, `outcome_supported_default`, `conditional_prior`, or
`product_heuristic`), policy version, and review date. The UI must communicate a
capacity/preference trade-off or minimum-dose shortfall rather than silently claiming
scientific certainty.

## Follow-up

* [Phase 7A](../plans/phase-7-weekly-allocation-and-role-reservations.md) addresses the
  current event-directed allocation defect with stateful required-role reservations.
* [Phase 7B](../plans/phase-7-training-intent-and-planning-modes.md) proposes Evergreen
  intent/capacity support while preserving event-directed demand paths.
* [ADR-0017](../adr/0017-training-intent-profile-and-planning-modes.md) and
  [ADR-0018](../adr/0018-weekly-allocation-and-role-reservations.md) remain Proposed.
