# Persona AI-judge fixtures

This directory contains the persona fixtures used to evaluate whether the planner preserves an athlete's goal hierarchy, current capacity, hard constraints, and recovery state across multi-week recommendations.

## Catalog vs active suite

The persona system has two layers on purpose:

- `personaScenarios.mjs` is the reusable **catalog**. It may contain multiple archetypes or variants that are useful for targeted development and regression work.
- `personaSuite.mjs` is the **active evaluation suite**. It composes a smaller set of personas and state perturbations that are run by `run-persona-ai-judge.mjs`.

Do not remove a useful catalog fixture merely because it is redundant in the active suite. Conversely, adding a catalog fixture does not automatically justify the ongoing AI-judge cost of making it active.

## Active-suite design rules

### Prefer state perturbations over duplicate archetypes

If several cases are intended to test the same underlying athlete identity, keep one persona and vary the decision-relevant axis: recovery, equipment/access, time, race proximity, pain/guardrails, or a soft preference.

The consolidated triathlon family follows this model: one established Olympic-distance athlete is tested across baseline recovery, adverse recovery, pool loss, short time, and taper proximity. The lower-level novice/intermediate/advanced triathlon catalog remains available for targeted tests.

### Persona prose must agree with observed evidence

The judge sees both narrative identity and planner-visible history. Do not claim a current capability in persona prose while deleting all evidence of it from `initialHistory`.

The cycling-primary hybrid fixture therefore keeps a **cycling-dominant mixed history**: 8 Cycling exposures and 4 Strength exposures. This is intentionally not a pure-cycling history because the persona's declared current identity includes regular resistance training and the evergreen intent contains both `endurance` and `strength_muscle` priorities.

Historical evidence is still not permission to over-prescribe. The hierarchy remains:

1. hard safety/equipment/time constraints;
2. active recovery or symptom evidence;
3. primary performance goal;
4. secondary maintenance/retention goals;
5. soft preferences.

### Adversarial cases must make the conflict real

A case named for a conflict should contain values that actually oppose each other. For example, the cycling hybrid local-tissue case uses clearly favorable wearable signals together with `painFlag=true` and explicit lower-body/impact guardrails. Neutral wearable values would not genuinely exercise the intended arbitration rule.

### Keep hard constraints deterministic

Use fixture and planner assertions for facts that can be checked deterministically: equipment availability, event modality, time caps, active guardrails, history composition, event dates, and reachability. Reserve the LLM judge for qualitative hierarchy questions such as whether a plan is cycling-primary without becoming cycling-only.

### Keep synthetic fixtures anonymous

Active fixtures are public test data. Do not encode a real person's name or identifying details. `assertPersonaFixtureIntegrity()` contains a basic regression guard, but fixture authors are responsible for keeping the data synthetic.

## Cycling-primary hybrid contract

The active hybrid family is evergreen rather than tied to a specific race date. Its stable contract is:

- Cycling is the primary performance objective.
- Strength/muscle retention is a real secondary requirement.
- Running is optional/deprioritized rather than required.
- More available time should not automatically create more hard sessions.
- Adverse recovery should lower near-term cost without permanently erasing the secondary strength requirement.
- A same-day Strength preference is soft and must not reverse the primary identity.
- Local pain and explicit mechanical guardrails outrank favorable wearable readiness.
- Body-composition progress must not be achieved by undermining key training or recovery.

When this contract changes, update fixture integrity assertions and tests in the same PR.

## Targeted hybrid expansion

`hybridScenarioFamilies.mjs` reuses the hybrid persona identity for two opt-in comparison
families: capacity/equipment (reference, extra time, a binding 20-minute weekend stress
case, outdoor bicycle only) and event lifecycle (build, adverse build, authored taper).
All seven cases share a synthetic four-week history of four 80-minute rides and two
50-minute strength sessions per week. This is seven hours/week of observed synthetic
training, not a declaration that the athlete already tolerates the larger time windows.
The default active suite and its reviewed baseline remain 9 families / 30 cases.

Run `npm run persona:hybrid:build` to generate 11 families / 37 cases, including the existing
controls, in `artifacts/hybrid-persona-plan-judge/latest/`. `corpus.json` is blinded;
`deterministic-results.json` separately records constraint violations, objective resolution,
effective session duration ranges and modeled cost/stimulus for inspection. These are
synthetic forecasts, not performed training or evidence of physiological adaptation.
Only the seven opt-in H1 packets expose the additional training-settings and authored-taper
facts required to judge their equipment, weekday/weekend limits and taper contract. The
existing 30 control packets keep the reviewed active-suite judge-visible shape.

To judge this corpus using configured local infrastructure:

```bash
node scripts/run-persona-ai-judge.mjs --hybrid-expansion --provider local --fresh --samples 5
```

For repeated hybrid judging, the two opt-in H1 families cyclically rotate case presentation
order by sample. Results are normalized back to canonical case IDs before aggregation. This
uses repeated samples to expose order-sensitive judge behavior without changing the active
suite or the deterministic corpus.

The existing seven scoring dimensions are sufficient; no hybrid-only rubric score is
introduced. These targeted artifacts are intentionally separate from the active baseline
promotion/diff path. They are exploratory until case-level findings and repeated judge
results have been reviewed. Do not copy scores into the active baseline or interpret a
passing deterministic safety test as proof of training adequacy. See
[`cycling-primary-hybrid-evaluation.md`](../../../docs/plans/cycling-primary-hybrid-evaluation.md)
for findings and the next acceptance contracts.

## Validation

From `app/`:

```bash
# Focused active-suite tests
npx vitest run scripts/ai-judge/__tests__/personaScenarios.test.mjs

# Build deterministic persona artifacts without calling an external judge
npm run persona:build

# Full repository validation
npm run check
```

`persona:run`, `persona:quick`, and provider-specific persona commands invoke the AI judge and may require provider credentials or local model infrastructure.

## Adding or changing an active persona

Before expanding the active suite, answer these questions:

1. What distinct planner decision does this case test?
2. Can the case be represented as a state perturbation of an existing persona instead of a new archetype?
3. Are narrative facts supported by planner-visible history/context, or explicitly framed as historical background rather than current capacity?
4. Is the intended conflict represented in the actual numeric/boolean fixture values?
5. Can any expected behavior be asserted deterministically before asking an LLM to judge it?
6. Does the case remain anonymous and reusable?

If those answers are clear, add the fixture, update `assertPersonaFixtureIntegrity()`, add focused assertions, and run the deterministic planner path before spending AI-judge budget.
