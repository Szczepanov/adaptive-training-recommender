import { describe, expect, it } from 'vitest';

import { EVENT_PRESETS } from '../../../src/engine/eventPresets.ts';
import { resolveEventTaper } from '../../../src/engine/taperPolicy.ts';
import { runScenario } from '../../../src/engine/simulation/analyze.ts';
import { assertPersonaFixtureIntegrity, buildPersonaFamilies } from '../personaSuite.mjs';

const EXPECTED_FAMILY_CASE_COUNTS = new Map([
  ['persona_strength_no_wearable', 3],
  ['persona_health_fat_loss', 4],
  ['persona_former_elite_return', 3],
  ['persona_balanced_performance', 4],
  ['persona_stacked_constraints', 3],
  ['persona_walking_preferred', 3],
  ['persona_established_history', 4],
  ['persona_cycling_primary_hybrid', 5],
  ['persona_running_event_priority', 3],
  ['persona_triathlon_established_olympic', 4],
]);

const EXPECTED_FAMILY_IDS = [...EXPECTED_FAMILY_CASE_COUNTS.keys()];
const EXPECTED_CASE_COUNT = [...EXPECTED_FAMILY_CASE_COUNTS.values()].reduce((sum, count) => sum + count, 0);

describe('active persona AI-judge suite', () => {
  it('keeps the expected anonymized persona families and state coverage', () => {
    const families = buildPersonaFamilies();
    const summary = assertPersonaFixtureIntegrity(families);

    expect(summary).toEqual({ familyCount: EXPECTED_FAMILY_IDS.length, caseCount: EXPECTED_CASE_COUNT });
    expect(families.map((family) => family.familyId)).toEqual(EXPECTED_FAMILY_IDS);
    for (const family of families) {
      expect(family.cases.length, family.familyId).toBe(EXPECTED_FAMILY_CASE_COUNTS.get(family.familyId));
    }
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

  it('seeds the established-history persona with a boundary-precise base and explicit recent-hard-load evidence', () => {
    const family = buildPersonaFamilies().find((candidate) => candidate.familyId === 'persona_established_history');
    expect(family).toBeDefined();

    for (const definition of family.cases) {
      expect(definition.scenario.trainingIntentProfile.priorities).toEqual(['endurance']);
      if (definition.scenario.id === 'persona_established_history_recent_hard_load') {
        const readiness = definition.scenario.readinessForWeek(0);
        const hardExposures = definition.scenario.initialHistory.filter((exposure) => exposure.category === 'Hard Endurance');
        expect(definition.scenario.initialHistory).toHaveLength(14);
        expect(hardExposures).toHaveLength(2);
        expect(hardExposures.map((exposure) => exposure.date)).toEqual(['2026-08-28', '2026-08-30']);
        expect(readiness.objective.last_3_days_hard_sessions_count).toBe(2);
        expect(readiness.subjective.readiness).toBeGreaterThanOrEqual(8);
      } else {
        expect(definition.scenario.initialHistory).toHaveLength(12);
        expect(definition.scenario.initialHistory.every((exposure) => exposure.trainingRecordLike.duration_min === 60)).toBe(true);
      }
    }
  });

  it('represents a real subjective-vs-wearable recovery disagreement instead of another concordant adverse case', () => {
    const family = buildPersonaFamilies().find((candidate) => candidate.familyId === 'persona_health_fat_loss');
    const conflict = family.cases.find((definition) => definition.scenario.id === 'persona_health_fatloss_fresh_subjective_adverse_wearable');
    const readiness = conflict.scenario.readinessForWeek(0);

    expect(readiness.subjective.readiness).toBeGreaterThanOrEqual(8);
    expect(readiness.subjective.fatigue).toBeLessThanOrEqual(2);
    expect(readiness.objective.hrv_delta).toBeLessThanOrEqual(-10);
    expect(readiness.objective.rhr_delta).toBeGreaterThanOrEqual(5);
    expect(readiness.objective.body_battery_wake).toBeLessThanOrEqual(35);
  });

  it('models already-trained-today as a transient execution fact rather than persistent fatigue', async () => {
    const family = buildPersonaFamilies().find((candidate) => candidate.familyId === 'persona_balanced_performance');
    const definition = family.cases.find((candidate) => candidate.scenario.id === 'persona_balanced_performance_already_trained_today');

    expect(definition.scenario.readinessForWeek(0).subjective.alreadyTrainedToday).toBe(true);
    expect(definition.scenario.readinessForWeek(1).subjective.alreadyTrainedToday).toBe(false);

    const result = await runScenario(definition.scenario);
    expect(result.decisionTraces[0].mode).toBe('recover');
    expect(['Rest', 'Mobility/Recovery']).toContain(result.decisionTraces[0].selected.category);
  });

  it('adds an anonymized cycling-primary hybrid persona with explicit hierarchy and evidence-backed mixed history', () => {
    const family = buildPersonaFamilies().find((candidate) => candidate.familyId === 'persona_cycling_primary_hybrid');
    expect(family).toBeDefined();
    expect(family.cases).toHaveLength(5);

    for (const definition of family.cases) {
      expect(definition.persona.personaId).toBe('cycling_primary_hybrid_advanced');
      expect(definition.persona.goalHierarchy).toContain('cycling performance is primary');
      expect(definition.scenario.trainingIntentProfile).toMatchObject({
        planningMode: 'evergreen',
        priorities: ['endurance', 'strength_muscle'],
      });
      expect(definition.scenario.preferences.preferredModalities).toEqual(['Cycling', 'Strength']);
      expect(definition.scenario.preferences.deprioritizedModalities).toEqual(['Running']);
      expect(definition.scenario.context.trainingSettings.equipment.indoor_bike).toBe(true);
      expect(definition.scenario.context.trainingSettings.equipment.outdoor_bike).toBe(true);
      expect(definition.scenario.initialHistory).toHaveLength(12);

      const cyclingHistory = definition.scenario.initialHistory.filter((exposure) => exposure.modality === 'Cycling');
      const strengthHistory = definition.scenario.initialHistory.filter((exposure) => exposure.modality === 'Strength');
      expect(cyclingHistory).toHaveLength(8);
      expect(strengthHistory).toHaveLength(4);
      expect(cyclingHistory.length).toBeGreaterThan(strengthHistory.length);
      expect(strengthHistory.every((exposure) => exposure.category === 'Full-body Strength')).toBe(true);
      expect(definition.scenario.event).toBeNull();
    }

    const tissueConflict = family.cases.find((definition) => definition.scenario.id === 'persona_cycling_hybrid_local_tissue_conflict');
    const tissueReadiness = tissueConflict.scenario.readinessForWeek(0);
    expect(tissueReadiness.subjective.painFlag).toBe(true);
    expect(tissueConflict.scenario.context.constraints.impliedGuardrails).toEqual(['avoid_high_impact', 'avoid_heavy_lower_body']);
    expect(tissueReadiness.objective.sleep_score).toBeGreaterThanOrEqual(90);
    expect(tissueReadiness.objective.body_battery_wake).toBeGreaterThanOrEqual(80);
    expect(tissueReadiness.objective.hrv_delta).toBeGreaterThan(0);
    expect(tissueReadiness.objective.rhr_delta).toBeLessThan(0);

    const strengthPreference = family.cases.find((definition) => definition.scenario.id === 'persona_cycling_hybrid_strength_preference');
    expect(strengthPreference.scenario.readinessForWeek(0).subjective.preferredModalityToday).toBe('Strength');
  });

  it('adds an established 10K family where A/B/C priority is the only event-axis change', () => {
    const family = buildPersonaFamilies().find((candidate) => candidate.familyId === 'persona_running_event_priority');
    expect(family).toBeDefined();
    expect(family.cases).toHaveLength(3);

    const byPriority = new Map(family.cases.map((definition) => [definition.scenario.event.priority, definition]));
    expect([...byPriority.keys()].sort()).toEqual(['A', 'B', 'C']);

    for (const priority of ['A', 'B', 'C']) {
      const definition = byPriority.get(priority);
      expect(definition.persona.personaId).toBe('running_event_established_10k');
      expect(definition.scenario.trainingIntentProfile).toBeNull();
      expect(definition.scenario.event).toMatchObject({
        title: 'Scheduled 10K',
        date: '2026-09-14',
        priority,
        category: 'running_race',
      });
      expect(definition.scenario.initialHistory).toHaveLength(12);
      expect(definition.scenario.initialHistory.every((exposure) => exposure.modality === 'Running')).toBe(true);
    }

    expect(resolveEventTaper(byPriority.get('A').scenario.event)?.startDate).toBe('2026-08-31');
    expect(resolveEventTaper(byPriority.get('B').scenario.event)?.startDate).toBe('2026-09-09');
    expect(resolveEventTaper(byPriority.get('C').scenario.event)).toBeNull();
  });

  it('exposes exactly one established Olympic-distance triathlon persona while preserving the unique triathlon edge cases', () => {
    const families = buildPersonaFamilies();
    const triathlonFamilies = families.filter((candidate) => candidate.familyId.startsWith('persona_triathlon_'));
    expect(triathlonFamilies).toHaveLength(1);

    const family = triathlonFamilies[0];
    expect(family.familyId).toBe('persona_triathlon_established_olympic');
    expect(family.cases).toHaveLength(4);
    const expectedPreset = EVENT_PRESETS.triathlon.find((preset) => preset.id === 'olympic');

    for (const definition of family.cases) {
      expect(definition.persona.personaId).toBe('triathlon_established_olympic');
      expect(definition.scenario.event).toMatchObject({ category: 'triathlon', priority: 'A' });
      expect(definition.scenario.event.demandProfile).toEqual(expectedPreset.demandProfile);
      expect(definition.scenario.trainingIntentProfile).toBeNull();
      expect(definition.scenario.initialHistory).toHaveLength(12);
      expect(definition.scenario.preferences.preferredModalities).toEqual(['Swimming', 'Cycling', 'Running']);
      expect(definition.scenario.context.trainingSettings.equipment.outdoor_bike).toBe(true);
    }
  });

  it('keeps taper proximity explicit on the triathlon persona', () => {
    const family = buildPersonaFamilies().find((candidate) => candidate.familyId === 'persona_triathlon_established_olympic');
    const taper = family.cases.find((definition) => definition.scenario.id === 'persona_triathlon_established_olympic_taper');
    expect(taper.scenario.event.date).toBe('2026-09-14');
    expect(taper.scenario.weeks).toBe(2);
  });

  it('keeps health/fat-loss plans mixed, event-free and conservative about moderate intensity', async () => {
    const family = buildPersonaFamilies().find((candidate) => candidate.familyId === 'persona_health_fat_loss');
    expect(family).toBeDefined();

    for (const definition of family.cases) {
      const { scenario } = definition;
      expect(scenario.event).toBeNull();
      expect(scenario.events).toEqual([]);
      expect(scenario.trainingIntentProfile).toMatchObject({ planningMode: 'evergreen', priorities: ['health'] });
      expect(scenario.preferences.preferredModalities).toEqual(['Strength', 'Walking', 'Cycling']);
      expect(JSON.stringify(scenario).toLowerCase()).not.toContain('calorie');

      const result = await runScenario(scenario);
      const traces = result.decisionTraces;
      const strengthCount = traces.filter((trace) => trace.selected?.modality === 'Strength').length;
      expect(strengthCount, scenario.id).toBeGreaterThanOrEqual(2);
      expect(traces.every((trace) => (trace.selected?.durationMin ?? 0) <= (scenario.context.constraints.maxTimeMinutes ?? 60)), scenario.id).toBe(true);

      const qualityEnduranceDates = traces
        .filter((trace) => ['Moderate Endurance', 'Hard Endurance'].includes(trace.selected?.category))
        .map((trace) => trace.date);
      if (scenario.id === 'persona_health_fatloss_adverse_recovery') {
        expect(qualityEnduranceDates, scenario.id).toHaveLength(0);
      } else {
        for (const date of qualityEnduranceDates) {
          const target = new Date(`${date}T00:00:00Z`).getTime();
          const priorQualityEndurance = qualityEnduranceDates.filter((candidate) => {
            const candidateTime = new Date(`${candidate}T00:00:00Z`).getTime();
            return candidateTime >= target - 7 * 24 * 60 * 60 * 1000 && candidateTime < target;
          });
          expect(priorQualityEndurance, `${scenario.id} ${date}`).toHaveLength(0);
        }
      }
    }
  });

  it('executes every active persona state through the real multi-week planner without hard-constraint violations', async () => {
    const definitions = buildPersonaFamilies().flatMap((family) => family.cases);

    for (const definition of definitions) {
      const result = await runScenario(definition.scenario);
      expect(result.decisionTraces.length, definition.scenario.id).toBeGreaterThan(0);
      expect(result.decisionTraces.every((trace) => Boolean(trace.selected?.templateId)), definition.scenario.id).toBe(true);
      expect(result.constraintViolations, definition.scenario.id).toEqual([]);
    }
  });

  it('keeps all three triathlon race disciplines reachable when access exists and never fabricates swimming without a pool', async () => {
    const family = buildPersonaFamilies().find((candidate) => candidate.familyId === 'persona_triathlon_established_olympic');
    for (const definition of family.cases) {
      const result = await runScenario(definition.scenario);
      const selectedModalities = new Set(result.decisionTraces.map((trace) => trace.selected.modality));
      if (!definition.scenario.id.endsWith('_adverse_recovery')) {
        for (const modality of ['Swimming', 'Cycling', 'Running']) {
          expect(selectedModalities.has(modality), definition.scenario.id).toBe(true);
        }
      }
      if (definition.scenario.id === 'persona_triathlon_established_olympic_taper') {
        expect(result.decisionTraces.every((trace) => trace.date < definition.scenario.event.date), definition.scenario.id).toBe(true);
      }
    }
  });
});
