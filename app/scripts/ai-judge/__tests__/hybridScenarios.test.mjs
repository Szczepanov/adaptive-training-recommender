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
  it('adds seven cases in two comparison families without changing the reviewed active suite', () => {
    expect(assertPersonaFixtureIntegrity(buildPersonaFamilies())).toEqual({ familyCount: 9, caseCount: 30 });
    expect(assertPersonaFixtureIntegrity(families)).toEqual({ familyCount: 11, caseCount: 37 });
    expect(definitions).toHaveLength(7);
    expect(new Set(definitions.map(({ persona }) => persona.personaId)).size).toBe(1);
  });

  it('scopes expanded judge facts to the seven opt-in cases only', () => {
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

  it('H2: indoor-only bicycle access keeps using the existing indoor Cycling path', async () => {
    const indoor = await resultFor(find('capacity_reference'));
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
});
