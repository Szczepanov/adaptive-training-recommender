import { describe, expect, it } from 'vitest';

import { EVENT_PRESETS } from '../../../src/engine/eventPresets.ts';
import { runScenario } from '../../../src/engine/simulation/analyze.ts';
import { assertPersonaFixtureIntegrity, buildPersonaFamilies } from '../personaScenarios.mjs';

const EXPECTED_FAMILY_IDS = [
  'persona_strength_no_wearable',
  'persona_health_fat_loss',
  'persona_former_elite_return',
  'persona_balanced_performance',
  'persona_stacked_constraints',
  'persona_walking_preferred',
  'persona_established_history',
  'persona_triathlon_novice_eighth',
  'persona_triathlon_intermediate_olympic',
  'persona_triathlon_advanced_half_iron',
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
        outdoor_bike: false,
        swim_access: false,
      });
    }
  });

  it('keeps Running restricted and Walking preferred in every walking-persona perturbation', () => {
    const family = buildPersonaFamilies().find((candidate) => candidate.familyId === 'persona_walking_preferred');
    expect(family).toBeDefined();

    for (const definition of family.cases) {
      const { context, preferences: prefs } = definition.scenario;
      expect(context.constraints.restrictedModalities).toContain('Running');
      expect(prefs.preferredModalities).toContain('Walking');
    }
  });

  it('seeds the established-history persona with a real, boundary-precise 28-day/12-session base', () => {
    const family = buildPersonaFamilies().find((candidate) => candidate.familyId === 'persona_established_history');
    expect(family).toBeDefined();

    for (const definition of family.cases) {
      expect(definition.scenario.trainingIntentProfile.priorities).toEqual(['endurance']);
      expect(definition.scenario.initialHistory.length).toBe(12);
      expect(definition.scenario.initialHistory.every((exposure) => exposure.trainingRecordLike.duration_min === 60)).toBe(true);
    }
  });

  it('models the 1/8, Olympic, and 70.3 triathlon ladder with authoritative demand profiles and current-history evidence', () => {
    const expected = [
      ['persona_triathlon_novice_eighth', 'eighth_im', 0],
      ['persona_triathlon_intermediate_olympic', 'olympic', 12],
      ['persona_triathlon_advanced_half_iron', 'half_iron', 18],
    ];

    for (const [familyId, presetId, historyCount] of expected) {
      const family = buildPersonaFamilies().find((candidate) => candidate.familyId === familyId);
      expect(family, familyId).toBeDefined();
      const expectedPreset = EVENT_PRESETS.triathlon.find((preset) => preset.id === presetId);
      for (const definition of family.cases) {
        expect(definition.scenario.event).toMatchObject({ category: 'triathlon', priority: 'A' });
        expect(definition.scenario.event.demandProfile).toEqual(expectedPreset.demandProfile);
        expect(definition.scenario.trainingIntentProfile).toBeNull();
        expect(definition.scenario.initialHistory).toHaveLength(historyCount);
        expect(definition.scenario.preferences.preferredModalities).toEqual(['Swimming', 'Cycling', 'Running']);
        expect(definition.scenario.context.trainingSettings.equipment.outdoor_bike).toBe(true);
      }
    }
  });

  it('keeps pool-access loss explicit and reserves the advanced triathlon case for the final 14 days before its event', () => {
    const families = buildPersonaFamilies();
    const novice = families.find((candidate) => candidate.familyId === 'persona_triathlon_novice_eighth');
    const poolUnavailable = novice.cases.find((definition) => definition.scenario.id === 'persona_triathlon_novice_eighth_pool_unavailable');
    expect(poolUnavailable.scenario.context.trainingSettings.equipment.swim_access).toBe(false);

    const advanced = families.find((candidate) => candidate.familyId === 'persona_triathlon_advanced_half_iron');
    const taper = advanced.cases.find((definition) => definition.scenario.id === 'persona_triathlon_advanced_half_iron_taper');
    expect(taper.scenario.event.date).toBe('2026-09-14');
    expect(taper.scenario.weeks).toBe(2);
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

  it('keeps all three race disciplines reachable when access exists and never fabricates swimming without a pool', async () => {
    const definitions = buildPersonaFamilies().flatMap((family) => family.cases);
    for (const definition of definitions.filter((item) => item.persona.personaId.startsWith('triathlon_'))) {
      const result = await runScenario(definition.scenario);
      const selectedModalities = new Set(result.decisionTraces.map((trace) => trace.selected.modality));
      if (definition.scenario.id === 'persona_triathlon_novice_eighth_pool_unavailable') {
        expect(selectedModalities.has('Swimming'), definition.scenario.id).toBe(false);
      } else if (!definition.scenario.id.endsWith('_adverse_recovery')) {
        for (const modality of ['Swimming', 'Cycling', 'Running']) {
          expect(selectedModalities.has(modality), definition.scenario.id).toBe(true);
        }
      }
      if (definition.scenario.id === 'persona_triathlon_advanced_half_iron_taper') {
        expect(result.decisionTraces.every((trace) => trace.date < definition.scenario.event.date), definition.scenario.id).toBe(true);
      }
    }
  });
});
