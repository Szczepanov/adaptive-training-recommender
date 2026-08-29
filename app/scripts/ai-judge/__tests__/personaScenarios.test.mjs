import { describe, expect, it } from 'vitest';

import { runScenario } from '../../../src/engine/simulation/analyze.ts';
import { assertPersonaFixtureIntegrity, buildPersonaFamilies } from '../personaScenarios.mjs';

const EXPECTED_FAMILY_IDS = [
  'persona_strength_no_wearable',
  'persona_health_fat_loss',
  'persona_former_elite_return',
  'persona_balanced_performance',
  'persona_stacked_constraints',
];

describe('persona AI-judge fixtures', () => {
  it('keeps the expected anonymized persona families with three state perturbations each', () => {
    const families = buildPersonaFamilies();
    const summary = assertPersonaFixtureIntegrity(families);

    expect(summary).toEqual({ familyCount: EXPECTED_FAMILY_IDS.length, caseCount: EXPECTED_FAMILY_IDS.length * 3 });
    expect(families.map((family) => family.familyId)).toEqual(EXPECTED_FAMILY_IDS);
    expect(families.every((family) => family.cases.length === 3)).toBe(true);
  });

  it('represents wearable absence as null rather than invented normal values', () => {
    const family = buildPersonaFamilies().find((candidate) => candidate.familyId === 'persona_strength_no_wearable');
    expect(family).toBeDefined();

    for (const definition of family.cases) {
      const objective = definition.scenario.readinessForWeek(0).objective;
      expect(objective.hrv_last_night).toBeNull();
      expect(objective.rhr).toBeNull();
      expect(objective.sleep_score).toBeNull();
      expect(objective.body_battery_wake).toBeNull();
    }
  });

  it('does not convert former elite status into fabricated current training history', () => {
    const family = buildPersonaFamilies().find((candidate) => candidate.familyId === 'persona_former_elite_return');
    const baseline = family.cases.find((definition) => definition.scenario.id === 'persona_former_elite_sparse_history_baseline');

    expect(baseline.persona.historicalBackground).toContain('former high-level');
    expect(baseline.scenario.initialHistory).toEqual([]);
    expect(baseline.scenario.event).toBeNull();
    expect(baseline.scenario.trainingIntentProfile.planningMode).toBe('evergreen');
  });

  it('activates explicit shoulder/back guardrails only in the symptom-flare case', () => {
    const family = buildPersonaFamilies().find((candidate) => candidate.familyId === 'persona_strength_no_wearable');
    const baseline = family.cases.find((definition) => definition.scenario.id === 'persona_strength_no_wearable_baseline');
    const flare = family.cases.find((definition) => definition.scenario.id === 'persona_strength_no_wearable_symptom_flare');

    expect(baseline.scenario.context.constraints.impliedGuardrails).toEqual([]);
    expect(flare.scenario.readinessForWeek(0).subjective.painFlag).toBe(true);
    expect(flare.scenario.context.constraints.impliedGuardrails).toEqual([
      'avoid_overhead_pressing',
      'avoid_heavy_spinal_loading',
    ]);
  });

  it('exercises balanced_performance directly rather than assuming health is equivalent', () => {
    const family = buildPersonaFamilies().find((candidate) => candidate.familyId === 'persona_balanced_performance');
    expect(family).toBeDefined();

    for (const definition of family.cases) {
      expect(definition.scenario.trainingIntentProfile.priorities).toEqual(['balanced_performance']);
      expect(definition.scenario.event).toBeNull();
      expect(definition.scenario.events).toEqual([]);
    }
  });

  it('keeps injury and equipment constraints stacked in every constrained-persona perturbation', () => {
    const family = buildPersonaFamilies().find((candidate) => candidate.familyId === 'persona_stacked_constraints');
    expect(family).toBeDefined();

    for (const definition of family.cases) {
      const { context } = definition.scenario;
      expect(context.constraints.restrictedModalities).toContain('Running');
      expect(context.constraints.impliedGuardrails).toContain('avoid_heavy_lower_body');
      expect(context.trainingSettings.equipment).toEqual({
        free_weights: false,
        cable_machine: false,
        treadmill: false,
        indoor_bike: false,
        pullup_bar: false,
      });
    }
  });

  it('executes every persona state through the real multi-week planner without hard-constraint violations', async () => {
    const definitions = buildPersonaFamilies().flatMap((family) => family.cases);

    for (const definition of definitions) {
      const result = await runScenario(definition.scenario);
      expect(result.decisionTraces.length, definition.scenario.id).toBeGreaterThan(0);
      expect(result.decisionTraces.every((trace) => Boolean(trace.selected?.templateId)), definition.scenario.id).toBe(true);
      expect(result.constraintViolations, definition.scenario.id).toEqual([]);
    }
  });
});
