# PR #292 Finding 8 — health/balanced strength-floor policy

**Date:** 2026-08-29
**PR:** #292 — `fix(engine): fix endurance+strength priority starvation and time-cap dose overrun`

## Finding

After the Running `aerobic_volume` bridge became reachable, the `persona_health_fat_loss` path exposed a pre-existing policy asymmetry in `resolveEvidenceBackedStrategy`:

- `health` / `balanced_performance` resolved aerobic endurance as `required`;
- the same broad health goals resolved strength as `target`;
- required-tier packing therefore consumed the hard `minSessions` budget for aerobic work;
- target-tier strength had only opportunistic leftover capacity and could disappear in concrete day-by-day ranking;
- for a no-bike athlete whose preferences were `Strength`, `Walking`, `Cycling`, the concrete 14-day plan could consequently become Running-only despite free weights being available.

This was not a weekly-packer regression. The allocator was enforcing the priority semantics it had been given.

## Evidence review

The asymmetry was not supported by the evidence metadata already authored in the engine. Both `HEALTH_AEROBIC_PROVENANCE` and `STRENGTH_PROVENANCE` are high-confidence `guideline_target` requirements sourced to the WHO physical-activity guidance. The strength requirement already carries a `guideline_recommended_minimum` floor of two sessions per week.

Current public-health guidance also presents both components as adult recommendations:

- WHO: adults should perform 150–300 minutes of moderate aerobic activity (or the vigorous equivalent) and muscle-strengthening activity involving all major muscle groups on 2 or more days per week: https://www.who.int/europe/news-room/fact-sheets/item/physical-activity
- CDC: adults need 150 minutes of moderate-intensity activity per week and 2 days of muscle-strengthening activity: https://www.cdc.gov/physical-activity-basics/adding-adults/index.html

The engine therefore should not make the strength guideline purely opportunistic while treating the aerobic guideline as non-droppable.

## Decision

For `health` and `balanced_performance`, both guideline-backed adaptations now resolve as `required`:

- aerobic endurance: `required`;
- strength: `required`.

An explicit `endurance` or `strength_muscle` priority remains `required` as before.

This deliberately does **not** make preferred-modality order authoritative over evidence-backed health requirements. Preferences still influence candidate selection inside a satisfiable role, but they do not delete another required health adaptation.

It also avoids introducing a special rule where `target` requirements sometimes contribute to `coverageMinimumSessions`. `required`, `target`, and `optional` retain one consistent meaning across the strategy → packing → plan-definition → coverage pipeline.

## Capacity semantics

Making both health adaptations required does not pretend every athlete has enough weekly capacity to hit both complete guideline floors.

When capacity is insufficient:

1. the existing same-tier fair-share allocator gives feasible required peers representation rather than allowing one to starve the other;
2. the packer uses only roles that fit real remaining windows;
3. unmet dose remains an explicit shortfall instead of silently dropping an adaptation;
4. concrete coverage minima are derived only from required roles that were actually packed.

For a 3-session minimum week, this can mean partial aerobic dose plus at least one strength occurrence and an explicit guideline shortfall, which is more truthful than a Running-only week that silently treats strength as optional.

## Regression coverage

`evergreenStrategy.test.ts` now verifies that both `health` and `balanced_performance` resolve aerobic endurance and strength as `required`, while endurance-only intent still does not manufacture a strength requirement.

`evergreenPlanner.test.ts` reproduces the reported persona shape:

- priorities: `['health']`;
- weekly commitment: 3 minimum / 4 target / 5 maximum sessions;
- no indoor bike;
- free weights available;
- preferred modalities: `Strength`, `Walking`, `Cycling`;
- 14-day week-ahead projection.

The regression requires both `aerobic_volume` and `primary_strength` allocation and verifies that the concrete plan contains both the reachable Running base template and at least one Strength session.

## Policy version

Because this changes persisted recommendation decisions, the engine policy version is bumped from `2026-08-evergreen-priority-time-cap-v1` to `2026-08-evergreen-priority-time-cap-v2`, with v1 retained in the historical-version list.

## Resulting invariant

A guideline-backed adaptation included by `health` or `balanced_performance` cannot disappear merely because another guideline-backed adaptation is processed in a harder priority tier. Capacity constraints may produce an explicit partial-dose shortfall; they must not turn strength into an unreported optional extra.
