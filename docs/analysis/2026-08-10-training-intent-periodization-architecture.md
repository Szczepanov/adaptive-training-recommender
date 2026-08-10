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
   occurrences must fit the stated minimum capacity or produce a transparent shortfall.
   A session can fan out across adaptation credit, but only explicit authored mappings can
   award multiple programming roles.
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

### Capacity needs a ledger contract

The useful meaning of a `min / target / max` schedule is:

* minimum required roles fit within `minSessions`;
* required plus target roles fit within `targetSessions`;
* optional/stretch work alone uses the remaining capacity through `maxSessions`.

When this cannot be packed, the result is a minimum-dose shortfall. It is not evidence to
manufacture a combined session or to credit unrelated work as coverage. The initial
2–6-session table is consequently a documented product heuristic, not a universal
physiology prescription.

### Stateful feasibility is required for Phase 7A

Candidate role/date edges are not independent: a selected future session changes fatigue,
projected history, quality spacing, hard-lower-body spacing, and anchor protection for the
next session. A bipartite matching over individually feasible edges can therefore overstate
the jointly achievable role count. The smallest correct solver is a bounded deterministic
search over required role occurrences only, applying the existing projected-date evaluator
after every tentative assignment. It is distinct from ADR-0015's whole-horizon utility
beam search.

## Initial policy evidence and provenance

The following table is intentionally narrow: it identifies what supports an initial rule
and, equally importantly, what it does **not** support. It is not a universal training
prescription.

| Initial policy rule | Source | Population and outcome | Confidence / use in the engine |
|---|---|---|---|
| Health-priority floor | [WHO physical-activity guidance](https://www.who.int/initiatives/behealthy/physical-activity) | General adults; 150–300 minutes moderate aerobic activity (or equivalent) and muscle strengthening on 2+ days/week for health benefit. | High for a population health floor; it is not evidence for a fixed number of app sessions or a performance plan. |
| Strength/hypertrophy dose | [ACSM 2026 resistance-training position-stand overview](https://acsm.org/science-spotlight-acsm-releases-new-position-stand-on-resistance-training/) | Healthy adults; resistance-training prescription for muscle function, hypertrophy, and performance. | Medium for outcome-specific dose framing; Phase 7 must retain population/training-status caveats rather than map it directly to one universal weekly template. |
| Frequency as session packing | [Volume-equated hypertrophy frequency meta-analysis](https://pubmed.ncbi.nlm.nih.gov/30558493/) | Healthy adults in resistance training; frequency's hypertrophy effect is not meaningful when volume is equated. | Medium: supports treating a third strength day as a distribution/preference choice, not a required outcome rule. |
| Initial 2–6 session allocation table | Repository product policy | Capacity packing of required/target/optional roles. | Low as scientific evidence: versioned heuristic only, to be calibrated against explicit minimum-dose shortfall, adherence, readiness, and outcome evidence. |

Each implementation constant must retain this classification in its policy table: source,
population, outcome, confidence, and whether it is an evidence floor or a packing
heuristic. The UI must communicate a capacity/preference trade-off or minimum-dose
shortfall rather than silently claiming scientific certainty.

## Follow-up

* [Phase 7A](../plans/phase-7-weekly-allocation-and-role-reservations.md) addresses the
  current event-directed allocation defect with stateful required-role reservations.
* [Phase 7B](../plans/phase-7-training-intent-and-planning-modes.md) proposes Evergreen
  intent/capacity support while preserving event-directed demand paths.
* [ADR-0017](../adr/0017-training-intent-profile-and-planning-modes.md) and
  [ADR-0018](../adr/0018-weekly-allocation-and-role-reservations.md) remain Proposed.
