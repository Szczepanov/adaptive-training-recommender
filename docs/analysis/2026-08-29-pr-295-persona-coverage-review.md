# PR #295 — persona coverage expansion review

**Date:** 2026-08-29
**Scope:** evergreen AI-judge persona coverage expansion

## Implemented coverage

This pass expands the persona suite from **3 families / 9 cases** to **5 families / 15 cases** while keeping the existing three-perturbation family pattern.

### `persona_balanced_performance`

Directly exercises the `balanced_performance` priority through the real evergreen planner instead of assuming the existing `health` persona is an equivalent proxy.

Perturbations:

- normal recovery;
- adverse recovery;
- a same-day Strength preference.

The judge contract is intentionally weekly rather than day-specific: both aerobic and strength requirements should remain represented, while a same-day preference is only a soft ranking signal and must not erase the other adaptation.

### `persona_stacked_constraints`

Exercises independent hard-gating mechanisms together:

- Running is a restricted modality;
- `avoid_heavy_lower_body` is active;
- free weights, cable machine, treadmill, indoor bike, and pull-up bar are unavailable;
- the durable priority remains `health`.

Perturbations:

- normal recovery;
- adverse recovery;
- only 30 minutes available today.

Fixture-integrity assertions keep the restriction, guardrail, and equipment absence active in every perturbation. The execution regression additionally requires `runScenario()` to report zero hard-constraint violations for every persona case.

## Review findings not implemented in this pass

### 1. Walking-only coverage is an architectural decision, not just a missing fixture

`resolveEvidenceBackedStrategy()` permits `Walking` as an aerobic substitution modality, but `SessionTemplate['modality']` currently has no `Walking` member and the workout/session catalog therefore cannot select a Walking template directly. The existing health persona can express Walking as a preference, but the planner cannot fulfill that preference as a first-class modality.

Adding a Walking-only persona before deciding the product model would mostly encode a known impossible request. A follow-up should choose explicitly between:

1. adding first-class Walking session/workout support and aerobic coverage credit; or
2. documenting/mapping walking to an existing modality such as Cross Training with an explicit semantic contract.

The first option is clearer if walking is intended to satisfy health aerobic-volume requirements directly.

### 2. Established-history candidate cannot currently prove the intended branch through `runScenario()`

The established-athlete branch requires `inferAthleteTrainingState()` to see at least 28 observed days plus >=12 sessions / >=720 minutes. `resolveEvergreenPlan()` takes the observed window from `historySnapshot?.windowDays`.

The simulation harness in `runScenario()` currently supplies a synthetic `TrainingHistoryProvider` with `reconstruct()` only, so `prepareTrainingHistorySnapshot()` returns `null`. Evergreen strategy therefore receives an observed window of `0`, regardless of how many `initialHistory` rows are seeded, and cannot reach `dataQuality: 'high'` / `trainingAgeProxy: 'established'` through this harness.

A follow-up should make the simulation provider expose a deterministic `getSnapshot()` (or otherwise pass an explicit observed-window contract) before adding the established-history judge family. The fixture should then prove the optional `high_intensity` requirement and `hardSessionCap: 2` end-to-end rather than merely checking `inferAthleteTrainingState()` in isolation.

## Regression coverage added

`personaScenarios.test.mjs` now verifies:

- the expected five family IDs and 15-case cross-section;
- `balanced_performance` is present explicitly on every case in its family;
- stacked injury/equipment constraints cannot disappear between perturbations;
- all 15 cases execute through the real multi-week planner;
- every simulated case reports zero hard-constraint violations.

`update-persona-judge-baseline.mjs` is updated to reject reviewed artifacts unless they contain exactly five families and 15 cases.

## Validation notes

The persona fixture module itself was syntax-checked independently and `assertPersonaFixtureIntegrity(buildPersonaFamilies())` returns `{ familyCount: 5, caseCount: 15 }`.

The repository's full `npm run check` and local LLM-backed `persona:local:stability` require the checked-out application dependencies / configured judge runtime. Those should remain mandatory before promoting a new committed persona judge baseline. This change deliberately does **not** fabricate or promote a baseline without a reviewed judge run.
