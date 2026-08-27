import { describe, expect, it } from 'vitest';

import { assertPersonaFixtureIntegrity, buildPersonaFamilies } from '../personaScenarios.mjs';

describe('persona AI-judge fixtures', () => {
  it('keeps three anonymized persona families with state perturbations', () => {
    const families = buildPersonaFamilies();
    const summary = assertPersonaFixtureIntegrity(families);

    expect(summary).toEqual({ familyCount: 3, caseCount: 9 });
    expect(families.map((family) => family.familyId)).toEqual([
      'persona_strength_no_wearable',
      'persona_health_fat_loss',
      'persona_former_elite_return',
    ]);
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
});
