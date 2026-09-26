import { describe, expect, it } from 'vitest';
import { buildPersonaFamilies, assertPersonaFixtureIntegrity } from '../personaSuite.mjs';
import { familyForJudgeSample, shouldExposeHybridExpansionFacts } from '../hybridJudgeSampling.mjs';
import { generateFamilyResponseSchema } from '../schema.mjs';
import { transformSchemaForOllama } from '../providers/ollama.mjs';
import { runScenario } from '../../../src/engine/simulation/analyze.ts';
import { ENRICHED_TEMPLATES } from '../../../src/engine/templates.ts';
import { EVENT_PRESETS } from '../../../src/engine/eventPresets.ts';
import { resolvePlanningContext } from '../../../src/engine/planningMode.ts';
import { evaluatePeriodizationPhase } from '../../../src/engine/periodization.ts';
import { coverageKeysForTemplate } from '../../../src/engine/coverage.ts';
import { EVERGREEN_GENERAL_COVERAGE_SET } from '../../../src/workouts/event-plan.ts';
import { workoutIdForTemplateId } from '../../../src/engine/coverage.ts';
import { grantsPowerExposureCredit, powerIdentityFor } from '../../../src/workouts/powerExposure.ts';
import { inferAthleteTrainingState, resolveEvidenceBackedStrategy } from '../../../src/engine/evergreenStrategy.ts';

const families = buildPersonaFamilies({ includeHybridExpansion: true });
const definitions = families.filter(({ familyId }) => familyId.startsWith('persona_hybrid_')).flatMap(({ cases }) => cases);
const find = (suffix) => definitions.find(({ scenario }) => scenario.id === `persona_cycling_hybrid_${suffix}`);
const results = new Map();
async function resultFor(definition) {
  const id = definition.scenario.id;
  if (!results.has(id)) results.set(id, await runScenario(definition.scenario));
  return results.get(id);
}

describe('cycling hybrid targeted evaluation', () => {
  it('adds eleven cases in three comparison families without changing the reviewed active suite', () => {
    expect(assertPersonaFixtureIntegrity(buildPersonaFamilies())).toEqual({ familyCount: 10, caseCount: 36 });
    expect(assertPersonaFixtureIntegrity(families)).toEqual({ familyCount: 13, caseCount: 47 });
    expect(definitions).toHaveLength(11);
    expect(new Set(definitions.map(({ persona }) => persona.personaId)).size).toBe(1);
  });

  it('scopes expanded judge facts to the eleven opt-in cases only', () => {
    const activeDefinitions = buildPersonaFamilies().flatMap(({ cases }) => cases);
    expect(activeDefinitions.every(({ scenario }) => !shouldExposeHybridExpansionFacts(scenario, true))).toBe(true);
    expect(definitions.every(({ scenario }) => shouldExposeHybridExpansionFacts(scenario, true))).toBe(true);
    expect(definitions.every(({ scenario }) => !shouldExposeHybridExpansionFacts(scenario, false))).toBe(true);
  });

  it('rotates only targeted hybrid family order across repeated judge samples', () => {
    const targeted = families.find(({ familyId }) => familyId === 'persona_hybrid_capacity_equipment');
    const ids = targeted.cases.map(({ scenario }) => scenario.id);
    const rotated = familyForJudgeSample(targeted, { hybridExpansion: true, sampleIndex: 1 });
    expect(rotated.cases.map(({ scenario }) => scenario.id)).toEqual([...ids.slice(1), ids[0]]);

    const activeFamily = buildPersonaFamilies()[0];
    expect(familyForJudgeSample(activeFamily, { hybridExpansion: true, sampleIndex: 1 })).toBe(activeFamily);
    expect(familyForJudgeSample(targeted, { hybridExpansion: false, sampleIndex: 1 })).toBe(targeted);
  });

  it('keeps the strict output schema aligned with rotated judge presentation order', () => {
    const targeted = families.find(({ familyId }) => familyId === 'persona_hybrid_capacity_equipment');
    const rotated = familyForJudgeSample(targeted, { hybridExpansion: true, sampleIndex: 1 });
    const ids = rotated.cases.map(({ scenario }) => scenario.id);
    const schema = generateFamilyResponseSchema(targeted.familyId, ids);
    expect(schema.properties.caseScores.items.properties.caseId.enum).toEqual(ids);
    const ollamaSchema = transformSchemaForOllama(schema);
    expect(ollamaSchema.properties.caseScores.prefixItems.map((item) => item.properties.caseId.const)).toEqual(ids);
  });

  it('changes availability rather than fabricating extra capacity or experience', () => {
    const reference = find('capacity_reference').scenario;
    const extra = find('more_time').scenario;
    expect(extra.initialHistory).toEqual(reference.initialHistory);
    expect(extra.initialHistory).toHaveLength(24);
    expect(extra.initialHistory.reduce((sum, item) => sum + item.trainingRecordLike.duration_min, 0)).toBe(1680);
    expect(extra.trainingIntentProfile).toEqual(reference.trainingIntentProfile);
    expect(extra.context.trainingSettings.defaults).toMatchObject({ weekdayMaxMinutes: 180, weekendMaxMinutes: 180 });
    expect(extra.readinessForWeek(0).objective).toEqual(reference.readinessForWeek(0).objective);
    expect(extra.readinessForWeek(0).subjective).toEqual({ ...reference.readinessForWeek(0).subjective, timeAvailable: 180 });
  });

  it('rejects a perturbation that silently increases observed training', () => {
    const changed = buildPersonaFamilies({ includeHybridExpansion: true });
    changed.find(({ familyId }) => familyId === 'persona_hybrid_capacity_equipment').cases[1].scenario.initialHistory.push({ date: '2026-08-30' });
    expect(() => assertPersonaFixtureIntegrity(changed)).toThrow('preserve identity, observed history and commitment');
  });

  it('keeps detached cases and explicit outdoor-only bicycle access', () => {
    const outdoor = find('outdoor_only').scenario;
    expect(outdoor.context.constraints.hasIndoorBike).toBe(false);
    expect(outdoor.context.trainingSettings.equipment).toMatchObject({ indoor_bike: false, outdoor_bike: true, cable_machine: false });
    const readiness = outdoor.readinessForWeek(0);
    readiness.subjective.painFlag = true;
    expect(outdoor.readinessForWeek(0).subjective.painFlag).toBe(false);
    expect(find('capacity_reference').scenario.context.constraints.hasIndoorBike).toBe(true);
  });

  it('uses the canonical road-race demand and explicit event-directed authority', () => {
    const expectedDemand = EVENT_PRESETS.cycling_event.find(({ id }) => id === 'road_race').demandProfile;
    for (const suffix of ['event_build', 'event_adverse', 'event_taper']) {
      const scenario = find(suffix).scenario;
      expect(scenario.event.demandProfile).toEqual(expectedDemand);
      expect(scenario.events).toEqual([scenario.event]);
      expect(scenario.trainingIntentProfile.planningMode).toBe('event_directed');
      const periodization = evaluatePeriodizationPhase(scenario.events, scenario.startDate);
      expect(resolvePlanningContext(scenario.trainingIntentProfile, periodization, scenario.startDate)).toMatchObject({ mode: 'event_directed', eventStrategy: 'structured_plan' });
    }
    expect(find('event_adverse').scenario.readinessForWeek(0).subjective.timeAvailable)
      .toBe(find('event_build').scenario.readinessForWeek(0).subjective.timeAvailable);
  });

  it('makes the short-weekend constraint binding rather than merely describing a short weekend', async () => {
    const reference = await resultFor(find('capacity_reference'));
    const short = await resultFor(find('short_weekends'));
    const weekendDates = new Set(['2026-09-05', '2026-09-06', '2026-09-12', '2026-09-13']);
    expect(reference.decisionTraces.some((trace) => weekendDates.has(trace.date) && trace.selected.durationMax > 20)).toBe(true);
    expect(short.decisionTraces.filter((trace) => weekendDates.has(trace.date)).every((trace) => trace.selected.durationMax <= 20)).toBe(true);
  });

  it('keeps tissue re-entry as counterfactual states on one existing persona', () => {
    const reentryFamily = families.find(({ familyId }) => familyId === 'persona_hybrid_tissue_reentry');
    expect(reentryFamily?.cases).toHaveLength(4);
    expect(new Set(reentryFamily.cases.map(({ persona }) => persona.personaId))).toEqual(new Set(['cycling_primary_hybrid_advanced']));
    expect(reentryFamily.cases.every(({ scenario }) => scenario.startDate === '2026-09-04')).toBe(true);

    const active = find('reentry_active_back_guardrail').scenario;
    const pending = find('reentry_pending_recheck').scenario;
    const settled = find('reentry_settled').scenario;
    const stacked = find('reentry_stacked_guardrail_fallback').scenario;
    expect(active.readinessForWeek(0).subjective.painFlag).toBe(true);
    expect(pending.readinessForWeek(0).subjective.painFlag).toBe(false);
    expect(settled.readinessForWeek(0).subjective.painFlag).toBe(false);
    expect(stacked.readinessForWeek(0).subjective).toEqual(pending.readinessForWeek(0).subjective);
    expect(active.context.constraints.impliedGuardrails).toContain('avoid_heavy_spinal_loading');
    expect(pending.context.constraints.impliedGuardrails).toContain('avoid_heavy_spinal_loading');
    expect(settled.context.constraints.impliedGuardrails ?? []).toEqual([]);
    expect(stacked.context.constraints.impliedGuardrails).toEqual(expect.arrayContaining([
      'avoid_heavy_spinal_loading',
      'avoid_overhead_pressing',
    ]));
  });

  it('restores at least one exact primary-strength exposure after the tissue state is settled', async () => {
    const settled = await resultFor(find('reentry_settled'));
    const exactPrimaryStrength = settled.decisionTraces.slice(0, 7).filter((trace) => {
      const template = ENRICHED_TEMPLATES.find(({ id }) => id === trace.selected.templateId);
      return template && coverageKeysForTemplate(template, 'general', EVERGREEN_GENERAL_COVERAGE_SET).includes('primary_strength');
    });
    expect(exactPrimaryStrength.length).toBeGreaterThan(0);

    // If the exact role is not already consumed by today's recommendation, the remaining
    // weekly allocation must still expose it and ultimately fulfil it.
    const remainingPrimaryStrength = settled.allocationReports[0].report.outcomes
      .filter((outcome) => outcome.occurrence.coverageKey === 'primary_strength');
    if (remainingPrimaryStrength.length > 0) {
      expect(remainingPrimaryStrength.some((outcome) => outcome.status === 'fulfilled')).toBe(true);
    }
  });

  it('uses low-load strength as degraded support under stacked spinal/overhead guardrails without false exact credit', async () => {
    const guarded = await resultFor(find('reentry_stacked_guardrail_fallback'));
    expect(guarded.decisionTraces.some((trace) => trace.selected.templateId === 'str_low_load_maint_01')).toBe(true);

    const primaryStrength = guarded.allocationReports.flatMap(({ report }) => report.outcomes)
      .filter((outcome) => outcome.occurrence.coverageKey === 'primary_strength');
    expect(primaryStrength.length).toBeGreaterThan(0);
    expect(primaryStrength.some((outcome) => outcome.status === 'fulfilled')).toBe(false);
  });

  it.each(definitions)('runs $scenario.id with real equipment and per-date duration checks', async (definition) => {
    const result = await resultFor(definition);
    expect(result.constraintViolations).toEqual([]);
    expect(result.decisionTraces).toHaveLength(14);
    for (const trace of result.decisionTraces) {
      const template = ENRICHED_TEMPLATES.find(({ id }) => id === trace.selected.templateId);
      expect(template).toBeDefined();
      for (const equipment of template.requiredEquipment) {
        expect(definition.scenario.context.trainingSettings.equipment[equipment], `${trace.date}: ${equipment}`).toBe(true);
      }
      // Calendar arithmetic on an already-resolved Warsaw date, not conversion of an instant.
      const [year, month, day] = trace.date.split('-').map(Number);
      const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
      const weekend = weekday === 0 || weekday === 6;
      const defaults = definition.scenario.context.trainingSettings.defaults;
      const cap = weekend ? defaults.weekendMaxMinutes : defaults.weekdayMaxMinutes;
      expect(trace.selected.durationMax, `${trace.date}: ${template.id}`).toBeLessThanOrEqual(cap);
    }
  });

  it('H2: gives outdoor-only bicycle access a real easy aerobic Cycling option instead of substituting Walking', async () => {
    const outdoor = await resultFor(find('outdoor_only'));
    const cyclingTraces = outdoor.decisionTraces.filter((trace) => trace.selected.modality === 'Cycling');
    expect(cyclingTraces.length).toBeGreaterThan(0);
    expect(cyclingTraces.some((trace) => trace.selected.templateId === 'end_easy_04')).toBe(true);
    for (const trace of cyclingTraces) {
      const template = ENRICHED_TEMPLATES.find(({ id }) => id === trace.selected.templateId);
      expect(template.requiredEquipment).toContain('outdoor_bike');
      expect(template.requiredEquipment).not.toContain('indoor_bike');
    }
  });

  it('H2: true indoor-only bicycle access keeps using the existing indoor Cycling path', async () => {
    const base = find('capacity_reference');
    const indoorOnlyScenario = {
      ...base.scenario,
      context: {
        ...base.scenario.context,
        constraints: { ...base.scenario.context.constraints, hasIndoorBike: true },
        trainingSettings: {
          ...base.scenario.context.trainingSettings,
          equipment: { ...base.scenario.context.trainingSettings.equipment, indoor_bike: true, outdoor_bike: false },
        },
      },
    };
    const indoor = await runScenario(indoorOnlyScenario);
    const cyclingTraces = indoor.decisionTraces.filter((trace) => trace.selected.modality === 'Cycling');
    expect(cyclingTraces.length).toBeGreaterThan(0);
    for (const trace of cyclingTraces) {
      const template = ENRICHED_TEMPLATES.find(({ id }) => id === trace.selected.templateId);
      expect(template.requiredEquipment).toContain('indoor_bike');
      expect(template.requiredEquipment).not.toContain('outdoor_bike');
    }
  });

  it('H2 negative control: no bicycle access at all still selects no bicycle-dependent session', async () => {
    const base = find('outdoor_only');
    const noBikeScenario = {
      ...base.scenario,
      context: {
        ...base.scenario.context,
        constraints: { ...base.scenario.context.constraints, hasIndoorBike: false },
        trainingSettings: {
          ...base.scenario.context.trainingSettings,
          equipment: { ...base.scenario.context.trainingSettings.equipment, indoor_bike: false, outdoor_bike: false },
        },
      },
    };
    const result = await runScenario(noBikeScenario);
    expect(result.decisionTraces.some((trace) => trace.selected.modality === 'Cycling')).toBe(false);
  });

  it('preserves cycling-specific objectives in build and actually enters taper', async () => {
    const build = await resultFor(find('event_build'));
    expect(build.objectiveResolution.map(({ key }) => key)).toContain('race_specific_endurance');
    expect(build.objectiveResolution.map(({ key }) => key)).toContain('strength_maintenance');
    const taperDefinition = find('event_taper');
    const taper = await resultFor(taperDefinition);
    expect(taperDefinition.scenario.event.taper.startDate).toBe(taperDefinition.scenario.startDate);
    expect(taper.decisionTraces.every(({ date }) => date < taperDefinition.scenario.event.date)).toBe(true);
    expect(taper.objectiveResolution.map(({ key }) => key)).not.toContain('threshold_quality');
  });

  // Issue #802: power exposure = an exact authored power identity selected on a full-dose
  // (train-mode) day. Readiness-modified or recover-mode sessions never count.
  const powerDates = (result) => result.decisionTraces
    .filter((trace) => trace.mode === 'train'
      && grantsPowerExposureCredit({ workoutId: workoutIdForTemplateId(trace.selected.templateId) }))
    .map(({ date }) => date);
  const weekOf = (result, weekIndex) => ({
    ...result,
    decisionTraces: result.decisionTraces.filter((trace) => trace.weekIndex === weekIndex),
  });
  const findAnyCase = (id) => families.flatMap(({ cases }) => cases).find(({ scenario }) => scenario.id === id);

  it('preserves the weekly power-maintenance target inside strength sessions for the normal-recovery hybrid', async () => {
    const reference = await resultFor(find('capacity_reference'));
    for (const weekIndex of [0, 1]) {
      expect(powerDates(weekOf(reference, weekIndex)).length).toBeGreaterThanOrEqual(1);
    }
    // Embedded, not additive: every power day is an exact primary-strength role occurrence.
    expect(powerDates(reference).every((date) => {
      const trace = reference.decisionTraces.find((item) => item.date === date);
      return coverageKeysForTemplate(ENRICHED_TEMPLATES.find(({ id }) => id === trace.selected.templateId), 'general', EVERGREEN_GENERAL_COVERAGE_SET)
        .includes('primary_strength');
    })).toBe(true);
  });

  it('gives the persona fixtures a real power requirement that adverse recovery withholds', () => {
    const scenario = find('capacity_reference').scenario;
    const state = inferAthleteTrainingState(scenario.initialHistory, 28);
    expect(state.trainingAgeProxy).toBe('established');
    const normal = resolveEvidenceBackedStrategy({ priorities: scenario.trainingIntentProfile.priorities }, state);
    expect(normal.requirements.find(({ adaptation }) => adaptation === 'neuromuscular_power'))
      .toMatchObject({ delivery: 'embedded', target: { target: 1, maximum: 2 } });
    const adverse = resolveEvidenceBackedStrategy({ priorities: scenario.trainingIntentProfile.priorities, isAdverseRecovery: true }, state);
    expect(adverse.requirements.some(({ adaptation }) => adaptation === 'neuromuscular_power')).toBe(false);
    expect(adverse.warnings.map(({ code }) => code)).toContain('power_exposure_withheld');
  });

  it('withholds power while recovery is adverse and resumes it only after full-dose readiness returns', async () => {
    const baseline = await resultFor(findAnyCase('persona_cycling_hybrid_baseline'));
    const adverse = await resultFor(findAnyCase('persona_cycling_hybrid_adverse_recovery'));
    const firstTrainDay = adverse.decisionTraces.find((trace) => trace.mode === 'train')?.date;
    expect(powerDates(adverse)[0] > powerDates(baseline)[0]).toBe(true);
    expect(powerDates(adverse).every((date) => firstTrainDay !== undefined && date >= firstTrainDay)).toBe(true);
    // A modify-mode power-capable strength day may run, but earns no power credit (above).
    expect(adverse.decisionTraces
      .filter((trace) => trace.mode === 'recover')
      .every((trace) => !powerIdentityFor(workoutIdForTemplateId(trace.selected.templateId)))).toBe(true);
  });

  it('does not prescribe impact plyometrics to satisfy power under an impact/heavy-lower-body guardrail', async () => {
    const conflict = await resultFor(findAnyCase('persona_cycling_hybrid_local_tissue_conflict'));
    expect(conflict.decisionTraces
      .every((trace) => !powerIdentityFor(workoutIdForTemplateId(trace.selected.templateId))?.impact)).toBe(true);
  });
});
