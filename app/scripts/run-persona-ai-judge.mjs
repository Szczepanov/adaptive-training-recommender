import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'vite';

import { buildPersonaFamilies, assertPersonaFixtureIntegrity } from './ai-judge/personaScenarios.mjs';
import { resolveJudgeConfig } from './ai-judge/config.mjs';
import { generateFamilyResponseSchema } from './ai-judge/schema.mjs';
import { validateAndNormalizeJudgeRow } from './ai-judge/validation.mjs';
import { callProvider } from './ai-judge/providers/index.mjs';
import { aggregateFamilySamples, deriveSampleSeed } from './ai-judge/aggregate.mjs';

const OUTPUT_DIR = resolve('artifacts/persona-plan-judge/latest');
const BUILD_ONLY = process.argv.includes('--build-only');

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function planFromResult(result, templatesById) {
  return result.decisionTraces.map((trace) => {
    const template = templatesById.get(trace.selected.templateId);
    return {
      date: trace.date,
      mode: trace.mode,
      readinessTier: trace.readinessTier,
      session: {
        templateId: trace.selected.templateId,
        title: template?.title ?? trace.selected.templateId,
        category: trace.selected.category,
        modality: trace.selected.modality,
        durationMin: trace.selected.durationMin ?? template?.durationMin ?? null,
        durationMax: trace.selected.durationMax ?? template?.durationMax ?? null,
        requiredEquipment: template?.requiredEquipment ?? [],
        safetyTags: template?.safetyTags ?? [],
        systemicCost: trace.selected.projectedCost.systemic,
        costProfile: trace.selected.projectedCost,
        stimulusProfile: trace.selected.stimulusProfile ?? template?.stimulusProfile ?? null,
      },
    };
  });
}

function packetFromResult(definition, result, templatesById) {
  const scenario = definition.scenario;
  const readiness = scenario.readinessForDate?.(scenario.startDate, 0) ?? scenario.readinessForWeek(0);
  return {
    input: {
      caseId: scenario.id,
      label: scenario.label,
      persona: clone(definition.persona),
      startDate: scenario.startDate,
      weeks: scenario.weeks,
      readiness: clone(readiness),
      goals: clone(scenario.context.goals),
      constraints: clone(scenario.context.constraints),
      preferences: clone(scenario.preferences ?? scenario.context.preferences),
      trainingIntentProfile: clone(scenario.trainingIntentProfile),
      initialHistory: clone(scenario.initialHistory ?? []),
      fixedActivities: clone(scenario.fixedActivities ?? []),
    },
    plan: planFromResult(result, templatesById),
    engineSummary: {
      categoryDistribution: result.categoryDistribution,
      modalityDistribution: result.modalityDistribution,
      restOrRecoveryDayCount: result.restOrRecoveryDayCount,
      fatigueTierDayCounts: result.fatigueTierDayCounts,
      constraintViolations: result.constraintViolations,
      qualityWarnings: result.qualityWarnings ?? [],
    },
  };
}

const PROMPT = `# Persona plan judge instructions

You are an independent evaluator of adaptive training recommendations across strength, health/general-fitness and endurance personas. The planner output is a candidate, not ground truth. Judge only the user-visible inputs and plan below; do not reward internal-looking labels, utility scores or engine diagnostics.

Score each case 0-10 on the existing schema dimensions using these meanings:
- safety_recovery_fit: respects current pain, fatigue, soreness, recovery signals and active guardrails without over-medicalizing normal variation.
- goal_event_fit: aligns with the persona's actual evergreen goal. There is no event in these fixtures; do not reward invented peaking/tapering.
- sequencing: multi-day load is coherent and avoids unnecessary same-tissue/systemic stacking.
- periodization_taper: for these event-free personas, score sustainable evergreen progression and the absence of fake race periodization. A good evergreen plan may score 10 here without a taper.
- preference_capacity_fit: respects available time/equipment/preferences AND the declared data source. Never require a wearable for a check-in-only athlete and never hallucinate objective measurements.
- robustness: behaves sensibly under sparse/missing data, conflicting signals, occupational fatigue and historical-vs-current fitness uncertainty.
- overall: holistic recommendation quality.

Persona-specific calibration:
1. Check-in-only strength persona: subjective readiness/fatigue/soreness/pain are legitimate evidence. A physically demanding job contributes real non-training load through the check-in. Strength specificity should be preserved when safe; cardio is not the primary performance objective. An active shoulder/back flare should tighten the plan and active guardrails must be respected. Do not diagnose an injury.
2. Health/fat-loss persona: prefer a sustainable combination of aerobic and resistance training with adherence-friendly progression. Garmin can inform recovery but should not turn the plan into event-style performance training. Training can support fat loss, but absent nutrition data do not justify invented calorie targets or crash-diet assumptions.
3. Former high-level endurance persona: historical competitive achievement is context, not present-day load tolerance. Current recent training and current recovery govern dose. A good Garmin day alone does not justify an elite workload after intermittent current training.

Judge methodology:
- Missing data are different from adverse data.
- More recovery is not automatically better; more training is not automatically better.
- Low motivation alone is not a physiological red flag.
- Do not reward verbosity or complexity.
- Prefer repeated, explainable family patterns over one-off threshold tuning.
- The same persona should react appropriately when the current state changes.

Return exactly one JSON object matching the supplied strict schema.`;

async function buildCorpus() {
  if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });
  const definitions = buildPersonaFamilies();
  const integrity = assertPersonaFixtureIntegrity(definitions);

  const server = await createServer({
    configFile: false,
    root: resolve('.'),
    logLevel: 'warn',
    server: { middlewareMode: true },
    appType: 'custom',
  });

  try {
    const analyzeModule = await server.ssrLoadModule('/src/engine/simulation/analyze.ts');
    const templatesModule = await server.ssrLoadModule('/src/engine/templates.ts');
    const templatesById = new Map(templatesModule.ENRICHED_TEMPLATES.map((template) => [template.id, template]));
    const families = [];

    for (const family of definitions) {
      const cases = [];
      for (const definition of family.cases) {
        const result = await analyzeModule.runScenario(definition.scenario);
        cases.push(packetFromResult(definition, result, templatesById));
      }
      families.push({
        familyId: family.familyId,
        changedAxis: family.changedAxis,
        comparisonInstruction: family.comparisonInstruction,
        cases,
      });
    }

    const corpus = {
      schema: 'adaptive-training-recommender/persona-plan-judge-corpus@1',
      capturedAt: new Date().toISOString(),
      familyCount: families.length,
      caseCount: families.reduce((sum, family) => sum + family.cases.length, 0),
      fixtureIntegrity: integrity,
      privacy: 'Synthetic anonymized personas only; no real-person names or identifying measurements are persisted.',
      families,
    };

    writeFileSync(resolve(OUTPUT_DIR, 'corpus.json'), `${JSON.stringify(corpus, null, 2)}\n`);
    writeFileSync(resolve(OUTPUT_DIR, 'families.jsonl'), `${families.map((family) => JSON.stringify(family)).join('\n')}\n`);
    writeFileSync(resolve(OUTPUT_DIR, 'judge-prompt.md'), `${PROMPT}\n`);
    console.log(`Generated ${corpus.caseCount} persona cases across ${corpus.familyCount} families in ${OUTPUT_DIR}`);
    return corpus;
  } finally {
    await server.close();
  }
}

async function judgeCorpus(corpus) {
  const config = resolveJudgeConfig(process.argv.slice(2).filter((arg) => arg !== '--build-only'));
  const scoreRows = [];
  const stabilityRows = [];

  console.log(`Persona judge: ${config.provider}/${config.model}; samples=${config.samples}`);
  for (const family of corpus.families) {
    const expectedCaseIds = family.cases.map((item) => item.input.caseId);
    const familySchema = generateFamilyResponseSchema(family.familyId, expectedCaseIds);
    const samples = [];

    for (let sampleIndex = 0; sampleIndex < config.samples; sampleIndex += 1) {
      const seed = deriveSampleSeed(config.baseSeed, family.familyId, sampleIndex, config.seedStrategy);
      const response = await callProvider({
        packetJson: JSON.stringify(family),
        schema: familySchema,
        promptContent: PROMPT,
        schemaContent: JSON.stringify(familySchema),
        config,
        sampleIndex,
        seed,
      });
      const result = validateAndNormalizeJudgeRow(response.value, family.familyId, new Set(expectedCaseIds));
      samples.push({ sampleIndex, seed, result, telemetry: response.telemetry ?? null });
    }

    const { aggregateResult, stability } = aggregateFamilySamples(family.familyId, samples, expectedCaseIds);
    scoreRows.push(aggregateResult);
    stabilityRows.push(stability);
    const medianOverall = aggregateResult.caseScores.reduce((sum, item) => sum + item.scores.overall, 0) / aggregateResult.caseScores.length;
    console.log(`${family.familyId}: mean overall ${medianOverall.toFixed(2)}/10; sensitivity ${aggregateResult.familyAssessment.sensitivity_quality}/10`);
  }

  writeFileSync(resolve(OUTPUT_DIR, 'judge-scores.jsonl'), `${scoreRows.map((row) => JSON.stringify(row)).join('\n')}\n`);
  writeFileSync(resolve(OUTPUT_DIR, 'judge-stability.json'), `${JSON.stringify(stabilityRows, null, 2)}\n`);
  console.log(`Wrote persona AI-judge results to ${OUTPUT_DIR}`);
}

const corpus = await buildCorpus();
if (!BUILD_ONLY) await judgeCorpus(corpus);
