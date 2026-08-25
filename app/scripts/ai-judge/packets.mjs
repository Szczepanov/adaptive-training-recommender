import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { computeDerivedPlanFeatures } from './derivedFeatures.mjs';

export function compactFamilyForJudge(rawFamily) {
  if (!rawFamily || typeof rawFamily !== 'object') {
    throw new Error('compactFamilyForJudge requires an object rawFamily');
  }

  return {
    familyId: rawFamily.familyId,
    changedAxis: rawFamily.changedAxis,
    cases: (rawFamily.cases ?? []).map((item) => ({
      caseId: item.input?.caseId,
      label: item.input?.label,
      changedAxis: item.input?.changedAxis,
      day1: {
        tier: item.plan?.[0]?.readinessTier,
        mode: item.plan?.[0]?.mode,
        session: item.plan?.[0]?.session?.title,
        category: item.plan?.[0]?.session?.category,
        durationMin: item.plan?.[0]?.session?.durationMin,
        durationMax: item.plan?.[0]?.session?.durationMax,
        systemicCost: item.plan?.[0]?.session?.systemicCost,
      },
      plan14d: (item.plan ?? []).map((day, index) => ({
        day: index + 1,
        mode: day?.mode,
        session: day?.session?.title,
        category: day?.session?.category,
        cost: day?.session?.systemicCost,
      })),
      engineSummary: {
        restDays: item.engineSummary?.restOrRecoveryDayCount,
        tierCounts: item.engineSummary?.fatigueTierDayCounts,
        categories: item.engineSummary?.categoryDistribution,
        warnings: item.engineSummary?.qualityWarnings,
        violations: item.engineSummary?.constraintViolations,
      },
    })),
  };
}

export function buildBlindFamilyPacket(rawFamily) {
  if (!rawFamily || typeof rawFamily !== 'object') {
    throw new Error('buildBlindFamilyPacket requires an object rawFamily');
  }

  return {
    packetSchema: 'adaptive-training-recommender/ai-plan-judge-packet@2',
    familyId: rawFamily.familyId,
    changedAxis: rawFamily.changedAxis,
    comparisonInstruction: rawFamily.comparisonInstruction ?? 'Compare cases within this family. Judge both absolute plan quality and whether the algorithm reacts appropriately to the changed input axis.',
    cases: (rawFamily.cases ?? []).map((item) => {
      const input = item.input ?? {};
      const context = input.context ?? {};

      const inputContext = {
        readiness: input.readiness ? {
          objective: input.readiness.objective ?? null,
          subjective: input.readiness.subjective ?? null,
        } : null,
        event: input.event ? {
          title: input.event.title,
          date: input.event.date,
          priority: input.event.priority,
          eventPreset: input.event.eventPreset,
          demandProfile: input.event.demandProfile,
        } : null,
        events: input.events ?? null,
        preferences: input.preferences ?? context.preferences ?? null,
        constraints: context.constraints ?? null,
        trainingSettings: context.trainingSettings ? {
          equipment: context.trainingSettings.equipment,
          defaults: context.trainingSettings.defaults,
          guardrails: context.trainingSettings.guardrails,
        } : null,
        recentTraining: (input.initialHistory ?? []).map((h) => ({
          date: h.date,
          category: h.category,
          modality: h.modality,
          durationMin: h.trainingRecordLike?.duration_min ?? h.durationMin ?? null,
          costProfile: h.costProfile ?? null,
        })),
        fixedActivities: (input.fixedActivities ?? []).map((f) => ({
          date: f.date,
          title: f.title,
          durationMin: f.durationMin,
          fixed: f.fixed,
        })),
        authoredPlanBlocks: input.authoredPlanBlocks ?? null,
        trainingIntentProfile: input.trainingIntentProfile ?? null,
      };

      const plan14d = (item.plan ?? []).map((day, index) => {
        const session = day?.session ?? {};
        return {
          day: index + 1,
          date: day?.date,
          session: {
            templateId: session.templateId,
            title: session.title,
            category: session.category,
            modality: session.modality,
            durationMin: session.durationMin,
            durationMax: session.durationMax,
            systemicCost: session.systemicCost,
            costProfile: session.costProfile,
            stimulusProfile: session.stimulusProfile,
            requiredEquipment: session.requiredEquipment,
            environment: session.environment,
            safetyTags: session.safetyTags,
          },
          ...(day?.fixedActivity ? { fixedActivity: day.fixedActivity } : {}),
        };
      });

      const derivedFeatures = computeDerivedPlanFeatures(plan14d, inputContext);

      return {
        caseId: input.caseId,
        label: input.label,
        changedAxis: input.changedAxis,
        inputContext,
        plan14d,
        derivedFeatures,
      };
    }),
  };
}

export function formatFamilyForPacketVersion(rawFamily, packetVersion = 'v1') {
  if (packetVersion === 'v2' || packetVersion === 'blind') {
    return buildBlindFamilyPacket(rawFamily);
  }
  return compactFamilyForJudge(rawFamily);
}

export function loadJudgeArtifacts(outputDir = resolve('artifacts/ai-plan-judge/latest')) {
  const familiesPath = resolve(outputDir, 'families.jsonl');
  const promptPath = resolve(outputDir, 'judge-prompt.md');
  const schemaPath = resolve(outputDir, 'judge-response-schema.json');
  const corpusPath = resolve(outputDir, 'corpus.json');

  for (const path of [familiesPath, promptPath, schemaPath]) {
    if (!existsSync(path)) {
      throw new Error(`Missing required AI plan judge artifact: ${path}`);
    }
  }

  const promptContent = readFileSync(promptPath, 'utf8');
  const schemaContent = readFileSync(schemaPath, 'utf8');
  const familyRows = readFileSync(familiesPath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`${familiesPath}:${index + 1} invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
      }
    });

  const expectedByFamily = new Map();
  for (const family of familyRows) {
    if (!family || typeof family !== 'object' || typeof family.familyId !== 'string' || !Array.isArray(family.cases)) {
      throw new Error('Malformed sensitivity family in families.jsonl.');
    }
    if (expectedByFamily.has(family.familyId)) {
      throw new Error(`Duplicate familyId in judge corpus: ${family.familyId}`);
    }
    const caseIds = family.cases.map((item) => item?.input?.caseId);
    if (caseIds.some((id) => typeof id !== 'string' || !id.trim())) {
      throw new Error(`Family ${family.familyId} contains a missing caseId.`);
    }
    if (new Set(caseIds).size !== caseIds.length) {
      throw new Error(`Family ${family.familyId} contains duplicate caseIds.`);
    }
    expectedByFamily.set(family.familyId, caseIds);
  }

  return {
    outputDir,
    familiesPath,
    promptPath,
    schemaPath,
    corpusPath,
    promptContent,
    schemaContent,
    familyRows,
    expectedByFamily,
  };
}
