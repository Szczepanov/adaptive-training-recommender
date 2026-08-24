import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'vite';

const outputDir = resolve('artifacts/ai-plan-judge/latest');
const familiesPath = resolve(outputDir, 'families.jsonl');
const corpusPath = resolve(outputDir, 'corpus.json');
const promptPath = resolve(outputDir, 'judge-prompt.md');
if (!existsSync(familiesPath)) throw new Error(`Missing base judge corpus: ${familiesPath}`);

function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
function addDays(date, days) {
  const [year, month, day] = date.split('-').map(Number);
  const value = new Date(Date.UTC(year, month - 1, day));
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
function requireScenario(scenarios, id) {
  const scenario = scenarios.find((candidate) => candidate.id === id);
  if (!scenario) throw new Error(`Missing simulation scenario '${id}'.`);
  return scenario;
}
function patchReadiness(base, subjectivePatch = {}, objectivePatch = {}) {
  const readiness = base.readinessForDate?.(base.startDate, 0) ?? base.readinessForWeek(0);
  return { ...clone(readiness), subjective: { ...clone(readiness.subjective), ...subjectivePatch }, objective: { ...clone(readiness.objective), ...objectivePatch } };
}
function userPreferences(overrides = {}) {
  return {
    userId: 'judge-user', preferredRecoveryStyle: 'passive', defaultWeekdayTimeMin: 60, defaultWeekendTimeMin: 120,
    preferredTimeOfDay: 'flexible', preferredModalities: [], deprioritizedModalities: [], avoidedModalities: [], unavailableModalities: [],
    explanationVerbosity: 'detailed', conservativeBias: false,
    preferredUnits: { distance: 'km', weight: 'kg', temperature: 'celsius' }, schemaVersion: 1, createdAt: '', updatedAt: '', ...overrides,
  };
}
function evergreenIntent() {
  return {
    userId: 'judge-user', planningMode: 'evergreen', priorities: ['balanced_performance'],
    weeklyCommitment: { minSessions: 2, targetSessions: 3, maxSessions: 4 }, organizationPreference: 'auto',
    schemaVersion: 1, createdAt: '', updatedAt: '',
  };
}
function variant(base, id, label, axis, options = {}) {
  const readiness = patchReadiness(base, options.subjective, options.objective);
  const context = clone(base.context);
  if (options.contextPatch) options.contextPatch(context);
  const event = clone(options.event !== undefined ? options.event : (base.event ?? null));
  const events = options.events !== undefined ? clone(options.events) : clone(base.events);
  if (options.eventDaysOut !== undefined && event) event.date = addDays(base.startDate, options.eventDaysOut);
  return {
    axis,
    scenario: {
      ...base, id, label, description: `AI-judge sensitivity case. Changed axis: ${JSON.stringify(axis)}.`, context, event,
      ...(events !== undefined ? { events } : {}),
      ...(options.preferences !== undefined ? { preferences: clone(options.preferences) } : {}),
      ...(options.trainingIntentProfile !== undefined ? { trainingIntentProfile: clone(options.trainingIntentProfile) } : {}),
      ...(options.authoredPlanBlocks !== undefined ? { authoredPlanBlocks: clone(options.authoredPlanBlocks) } : {}),
      ...(options.initialHistory !== undefined ? { initialHistory: clone(options.initialHistory) } : {}),
      startDate: base.startDate, weeks: options.weeks ?? 2,
      readinessForWeek: () => clone(readiness), readinessForDate: () => clone(readiness),
      tags: ['ai-plan-judge', ...(base.tags ?? [])],
    },
  };
}
function judgeContext(input) {
  return {
    readiness: input.readiness,
    event: input.event ?? null,
    events: input.events ?? null,
    preferences: input.preferences ?? input.context?.preferences ?? null,
    constraints: input.context?.constraints ?? null,
    trainingSettings: input.context?.trainingSettings ?? null,
    initialHistory: input.initialHistory ?? [],
    fixedActivities: input.fixedActivities ?? [],
    authoredPlanBlocks: input.authoredPlanBlocks ?? null,
    trainingIntentProfile: input.trainingIntentProfile ?? null,
  };
}
function serializeInput(definition) {
  const scenario = definition.scenario;
  const readiness = scenario.readinessForDate?.(scenario.startDate, 0) ?? scenario.readinessForWeek(0);
  const input = {
    caseId: scenario.id, label: scenario.label, changedAxis: definition.axis, startDate: scenario.startDate, weeks: scenario.weeks,
    readiness, event: scenario.event ?? null, events: scenario.events ?? null,
    preferences: scenario.preferences ?? scenario.context.preferences, context: scenario.context,
    initialHistory: scenario.initialHistory ?? [], fixedActivities: scenario.fixedActivities ?? [],
    authoredPlanBlocks: scenario.authoredPlanBlocks ?? null, trainingIntentProfile: scenario.trainingIntentProfile ?? null,
  };
  input.changedAxis = { ...definition.axis, judgeContext: judgeContext(input) };
  return input;
}
function planFromResult(result, templatesById) {
  return result.decisionTraces.map((trace) => {
    const template = templatesById.get(trace.selected.templateId);
    return {
      date: trace.date, mode: trace.mode, readinessTier: trace.readinessTier,
      session: {
        templateId: trace.selected.templateId, title: template?.title ?? trace.selected.templateId,
        category: trace.selected.category, modality: trace.selected.modality,
        durationMin: template?.durationMin ?? null, durationMax: template?.durationMax ?? null,
        systemicCost: trace.selected.projectedCost.systemic, costProfile: trace.selected.projectedCost,
        stimulusProfile: template?.stimulusProfile ?? null, safetyTags: template?.safetyTags ?? [],
        requiredEquipment: template?.requiredEquipment ?? [], environment: template?.environment ?? 'either',
      },
      projectedFatigue: trace.fatigue, activeObjectives: trace.activeObjectives,
      contributorObjectiveChanges: trace.contributorObjectiveChanges, fixedActivity: trace.fixedActivity,
      rejectionCounts: trace.rejectionCounts, utility: trace.utility,
    };
  });
}
function packetFromResult(definition, result, templatesById) {
  return {
    input: serializeInput(definition), plan: planFromResult(result, templatesById),
    engineSummary: {
      categoryDistribution: result.categoryDistribution, modalityDistribution: result.modalityDistribution,
      restOrRecoveryDayCount: result.restOrRecoveryDayCount, fatigueTierDayCounts: result.fatigueTierDayCounts,
      objectiveResolution: result.objectiveResolution, constraintViolations: result.constraintViolations,
      qualityWarnings: result.qualityWarnings, anchorWeeks: result.anchorWeeks,
    },
  };
}

const rows = readFileSync(familiesPath, 'utf8').split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map(JSON.parse);
const server = await createServer({ configFile: false, root: resolve('.'), logLevel: 'warn', server: { middlewareMode: true }, appType: 'custom' });
try {
  const scenariosModule = await server.ssrLoadModule('/src/engine/simulation/scenarios.ts');
  const analyzeModule = await server.ssrLoadModule('/src/engine/simulation/analyze.ts');
  const templatesModule = await server.ssrLoadModule('/src/engine/templates.ts');
  const base = requireScenario(scenariosModule.SCENARIOS, 'cycling_criterium_A');
  const templatesById = new Map(templatesModule.ENRICHED_TEMPLATES.map((template) => [template.id, template]));
  const neutral = (id, label, axis, options = {}) => variant(base, id, label, axis, options);

  const replacements = new Map();
  const preferences = [
    neutral('judge_pref_neutral', 'Preferences/capacity — passive recovery baseline', { preference: 'passive_recovery' }, { preferences: userPreferences({ preferredRecoveryStyle: 'passive' }) }),
    neutral('judge_pref_conservative', 'Preferences/capacity — conservative bias', { preference: 'conservative_bias' }, { preferences: userPreferences({ conservativeBias: true }), contextPatch: (c) => { c.preferences.conservativeBias = true; } }),
    neutral('judge_pref_active_recovery', 'Preferences/capacity — active recovery style', { preference: 'active_recovery' }, { preferences: userPreferences({ preferredRecoveryStyle: 'active' }), contextPatch: (c) => { c.preferences.preferredRecoveryStyle = 'active'; } }),
    neutral('judge_pref_mixed_recovery', 'Preferences/capacity — mixed recovery style', { preference: 'mixed_recovery' }, { preferences: userPreferences({ preferredRecoveryStyle: 'mixed' }), contextPatch: (c) => { c.preferences.preferredRecoveryStyle = 'mixed'; } }),
    neutral('judge_pref_45min', 'Preferences/capacity — 45 minute weekdays', { capacity: '45_min_weekday' }, { preferences: userPreferences({ defaultWeekdayTimeMin: 45 }), contextPatch: (c) => { c.constraints.maxTimeMinutes = 45; if (c.trainingSettings) c.trainingSettings.defaults.weekdayMaxMinutes = 45; } }),
    neutral('judge_pref_90min', 'Preferences/capacity — 90 minute weekdays', { capacity: '90_min_weekday' }, { preferences: userPreferences({ defaultWeekdayTimeMin: 90 }), contextPatch: (c) => { c.constraints.maxTimeMinutes = 90; if (c.trainingSettings) c.trainingSettings.defaults.weekdayMaxMinutes = 90; } }),
  ];
  const injuries = [
    neutral('judge_injury_none', 'Injury — healthy baseline', { injuryConstraint: 'none' }),
    neutral('judge_injury_running_restricted', 'Injury — restricted running modality', { injuryConstraint: 'restricted_running' }, { contextPatch: (c) => {
      c.constraints.restrictedModalities = ['Running'];
      c.constraints.impliedGuardrails = [...new Set([...(c.constraints.impliedGuardrails ?? []), 'avoid_high_impact'])];
      if (c.trainingSettings) c.trainingSettings.guardrails.avoid_high_impact = true;
    } }),
    neutral('judge_injury_lower_body_restricted', 'Injury — avoid heavy lower body', { injuryConstraint: 'avoid_heavy_lower_body' }, { contextPatch: (c) => {
      c.constraints.impliedGuardrails = [...new Set([...(c.constraints.impliedGuardrails ?? []), 'avoid_heavy_lower_body'])];
      if (c.trainingSettings) c.trainingSettings.guardrails.avoid_heavy_lower_body = true;
    } }),
    neutral('judge_injury_expired', 'Injury — expired review, no active engine restriction', { injuryConstraint: 'expired_review_inactive' }),
  ];
  const modes = [
    neutral('judge_mode_event_directed', 'Planning mode — event directed A-race', { planningMode: 'event_directed' }),
    variant(base, 'judge_mode_evergreen', 'Planning mode — evergreen fitness maintenance', { planningMode: 'evergreen' }, { event: null, events: [], trainingIntentProfile: evergreenIntent(), preferences: userPreferences({ preferredRecoveryStyle: 'mixed' }) }),
    neutral('judge_mode_travel_overlay', 'Planning mode — 3-day travel constraints + authored overlay', { planningMode: 'travel_overlay' }, {
      authoredPlanBlocks: [{ id: 'travel-block-1', userId: 'judge-user', phase: 'travel', startDate: base.startDate, endDate: addDays(base.startDate, 2), volumeScale: 0.5, intensityScale: 0.7, createdAt: '', updatedAt: '' }],
      contextPatch: (c) => {
        c.constraints.maxTimeMinutes = 30; c.constraints.hasFreeWeights = false; c.constraints.hasCableMachine = false; c.constraints.hasTreadmill = false; c.constraints.hasIndoorBike = false;
        if (c.trainingSettings) {
          for (const key of Object.keys(c.trainingSettings.equipment)) c.trainingSettings.equipment[key] = false;
          c.trainingSettings.defaults.weekdayMaxMinutes = 30; c.trainingSettings.defaults.weekendMaxMinutes = 30; c.trainingSettings.defaults.environment = 'indoor';
        }
      },
    }),
    neutral('judge_mode_conservative_preference', 'Planning mode — high conservative bias', { planningMode: 'conservative_overlay' }, { preferences: userPreferences({ conservativeBias: true }), contextPatch: (c) => { c.preferences.conservativeBias = true; } }),
  ];

  for (const [familyId, changedAxis, definitions] of [
    ['preferences_capacity', 'recovery preference / conservatism / time capacity', preferences],
    ['injury_constraints', 'structured injury guardrails and modality restrictions', injuries],
    ['planning_modes_overlays', 'macro planning modes and travel constraints/overlays', modes],
  ]) {
    const cases = [];
    for (const definition of definitions) cases.push(packetFromResult(definition, await analyzeModule.runScenario(definition.scenario), templatesById));
    replacements.set(familyId, { familyId, changedAxis, comparisonInstruction: 'Compare cases within this family. An unchanged plan is acceptable when the changed axis is not decision-relevant; hard safety constraints must always be obeyed.', cases });
  }

  const patched = rows.map((family) => replacements.get(family.familyId) ?? {
    ...family,
    cases: family.cases.map((item) => {
      const input = clone(item.input);
      const axis = input.changedAxis && typeof input.changedAxis === 'object' ? input.changedAxis : { value: input.changedAxis };
      input.changedAxis = { ...axis, judgeContext: judgeContext(input) };
      return { ...item, input };
    }),
  });
  writeFileSync(familiesPath, `${patched.map((family) => JSON.stringify(family)).join('\n')}\n`);

  if (existsSync(corpusPath)) {
    const corpus = JSON.parse(readFileSync(corpusPath, 'utf8'));
    corpus.schema = 'adaptive-training-recommender/ai-plan-judge-corpus@2';
    corpus.familyCount = patched.length;
    corpus.caseCount = patched.reduce((sum, family) => sum + family.cases.length, 0);
    corpus.families = patched;
    corpus.harnessCorrections = ['planner-facing preferences', 'active injury guardrail paths', 'valid evergreen intent', 'travel constraints', 'judge-context enrichment'];
    writeFileSync(corpusPath, `${JSON.stringify(corpus, null, 2)}\n`);
  }

  const prompt = `# AI plan judge instructions\n\nYou are an independent endurance-training plan evaluator. Engine rationale, fatigue tiers, rejection codes and utility are diagnostics, not ground truth. Evaluate the whole multi-day sequence.\n\nScore each case 0-10 on safety_recovery_fit, goal_event_fit, sequencing, periodization_taper, preference_capacity_fit, robustness and overall, plus family sensitivity_quality.\n\nCalibration rules:\n- Sensitivity does not require every perturbation to change the plan. Mild isolated variation (including ~1 SD HRV/RHR movement) can legitimately leave a good plan unchanged.\n- Low motivation alone is not a physiological safety signal.\n- Easy training yesterday does not make quality work today unsafe; judge actual delivered load and residual fatigue.\n- Judge taper by workload/volume reduction with appropriate intensity/specificity, not rest-day count alone.\n- Preferences are soft unless encoded as constraints; safety restrictions are hard.\n- Criterium/surge events should emphasize repeated surges/VO2/sprint qualities, while long gran-fondo demands emphasize sustained aerobic durability/fatigue resistance.\n- More recovery is not automatically better; more training is not automatically better.\n- Prefer repeated family patterns over one-off threshold tuning.\n\nReturn exactly one JSON object matching judge-response-schema.json. All flags, suggestedChanges and familyAssessment list fields must be JSON arrays of strings.\n`;
  writeFileSync(promptPath, prompt);
  console.log('Patched AI-judge corpus with corrected fixtures and enriched judge context.');
} finally {
  await server.close();
}
