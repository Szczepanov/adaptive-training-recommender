# Issue #681 — health/fat-loss modality and intensity review

**Date:** 2026-09-19
**Status:** Implemented as a bounded product-policy refinement

## Deterministic evidence

The existing synthetic `health_fat_loss_garmin` persona already contained the three
requested states in `app/scripts/ai-judge/personaScenarios.mjs`:

- normal Garmin recovery;
- adverse Garmin and subjective recovery;
- a 30-minute daily time cap.

The generated two-week corpus showed meaningful resistance representation, but also
repeated Running/Moderate Endurance sessions despite `Strength`, `Walking`, and `Cycling`
being the explicit preferences. The adverse-recovery forecast eventually allowed a
moderate session because the original forecast only carried the initial adverse state.
This confirmed a coherent adherence/intensity pattern rather than a missing-fixture-only
problem.

## Decision

Issue #681 is addressed without adding a `fat_loss` training priority. Fat loss remains
persona context mapped to the existing evergreen `health` priority. The new
`healthPlanningPolicy.ts` policy:

- gives feasible low-impact aerobic modalities a soft preference when Running is not
  explicitly supported;
- limits unnecessary quality-endurance density to one prior session per rolling seven
  days;
- withholds quality endurance from an adverse-recovery forecast until a fresh planning
  check is available;
- leaves Running allowed, event-directed planning unchanged, and the required aerobic
  and strength roles intact.

The policy is registered as a product heuristic under
`health.adherence.modality_intensity_prior_v1`. The persona judge is an evidence tool,
not clinical validation, and no nutrition or calorie behavior is inferred from training
data.
