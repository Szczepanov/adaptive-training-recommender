# Safety adversarial testing

This document describes the safety-regression strategy used by the adaptive training recommendation engine.

## Purpose

The adversarial suite is designed to detect policy regressions where athlete preference, event importance, optimistic wearable data, repeated dose adjustments, authored sessions, or incomplete data could bypass a hard safety/feasibility gate.

It is **synthetic policy-regression evidence, not clinical validation**. Passing these tests means the implemented decision rules behave consistently with the encoded safety contracts. It does not establish medical safety, diagnose illness/injury, or prove that a training prescription is physiologically optimal for a real athlete.

## Test layers

### 1. Deterministic property invariants

`app/src/engine/tests/safety/safetyInvariants.test.ts`

The lightweight property runner uses a seedable PRNG so every failure is reproducible. The suite currently checks:

- explicit safety restrictions dominate athlete modality preference;
- a `harder` adjustment cannot raise execution volume above the active plan ceiling;
- accepted authored sessions pass the exact production eligibility projection and systemic-cost budget;
- impossible contexts fall back to the canonical zero-dose Rest template with rationale;
- missing or partial 28-day baseline inputs cannot fabricate chronic multi-day drift;
- recommendation rationale and envelope reasons avoid diagnostic claims.

Default seeds are fixed in the tests. A failure reports the seed, iteration, and generated counterexample.

### 2. Focused adversarial domain combinations

`app/src/engine/tests/safety/adversarialDomainScenarios.test.ts`

These tests isolate specific physiological/scheduling collisions such as:

- high readiness with reported pain;
- excellent sleep after several hard days;
- post-training HRV suppression versus unexplained systemic signals;
- reported illness symptoms despite strong wearable metrics;
- injury restrictions versus event-related pressure;
- cumulative same-day authored-session load;
- repeated requests for a harder dose;
- missing/incomplete safety check-ins;
- high acute fatigue around competition;
- lower-body injury/guardrail conflicts with strength work.

These are deliberately narrow unit/integration contracts. They should test the real production helper used by the path under test rather than rebuilding a looser test-only approximation.

### 3. Multi-week adversarial simulations

Scenario definitions live in:

`app/src/engine/simulation/scenarios.ts`

Scenario-specific contracts live in:

`app/src/engine/tests/safety/adversarialSimulationScenarios.test.ts`

The simulation contracts currently verify that:

- reported pain keeps directly evaluated week starts in recovery despite optimistic readiness data;
- recent hard-session density does not escalate into hard-endurance work;
- an A-priority running event cannot re-enable Running while the modality is explicitly injury-restricted;
- `avoid_heavy_lower_body` excludes lower-body and full-body strength across the simulated horizon.

The distinction between a directly evaluated check-in date and a provisional future forecast matters. An acute `painFlag` is asserted against the dates on which that check-in is actually evaluated; persistent constraints such as a restricted modality or guardrail are asserted across the full generated horizon.

The global scenario suite in `app/src/engine/scenarios.test.ts` additionally checks equipment/injury constraint violations, recovery presence, horizon completeness, and typed reasons for required-role misses.

## Reproducing locally

From `app/`:

```bash
npm run test -- src/engine/tests/safety
npm run test -- src/engine/scenarios.test.ts
npm run simulate:scenarios
npm run simulate:diff
npm run check
```

Repository-level validation should also include the backend/static checks used by CI, for example:

```bash
uv run pytest
uv run ruff check .
uv run ruff format --check .
node scripts/check-policy-drift.mjs origin/main
```

Use the repository CI definition as the authoritative list when commands change.

## Adding a new invariant

Prefer the smallest layer that proves the contract:

1. Use a focused deterministic unit/property test for a pure hard gate.
2. Add a domain combination when several subsystems must interact.
3. Add a multi-week simulation only when state/history/event sequencing is part of the risk.

When adding a property test:

- use a fixed seed;
- generate the conflicting inputs intentionally rather than hoping random generation reaches them;
- disable unrelated gates that would make the assertion pass for the wrong reason;
- reuse production projections/helpers instead of reconstructing them in the test;
- assert the safety outcome, not just that the function returned successfully.

When adding a simulation:

- give the scenario a clear adversarial tag;
- add a scenario-specific contract for the behavior claimed by its description;
- distinguish direct check-in decisions from provisional future forecasts;
- do not rely only on aggregate rest percentages or generic equipment checks;
- keep event/injury/guardrail conflicts explicit in the fixture.

## Failure interpretation

A red test should be classified before changing thresholds or fixtures:

- **real policy regression:** production can select an inadmissible or overly aggressive option;
- **coverage bug:** the test passed/failed through an unrelated gate or reconstructed behavior inaccurately;
- **fixture drift:** the scenario no longer encodes the conflict its name/description claims;
- **intended policy change:** update the invariant only after the new contract is explicitly reviewed and documented.

Do not weaken a safety test merely to restore green CI. If the intended policy changed, update the policy rationale and the corresponding contract together.

## Known boundaries

The suite does not prove:

- clinical diagnosis or medical clearance;
- physiological optimality of thresholds;
- real-world injury prevention;
- correctness of wearable measurements;
- complete coverage of every possible authored workout or event sequence;
- long-term superiority of one training method.

Those questions require separate evidence, data, domain review, and where appropriate clinical assessment. The adversarial suite exists to ensure that encoded safety and feasibility rules remain dominant and deterministic as the recommendation engine evolves.
