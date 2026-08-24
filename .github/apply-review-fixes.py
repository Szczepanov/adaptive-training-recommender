from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: str, old: str, new: str) -> None:
    target = ROOT / path
    text = target.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected exactly one replacement target, found {count}")
    target.write_text(text.replace(old, new, 1), encoding="utf-8")


def write_new(path: str, content: str) -> None:
    target = ROOT / path
    if target.exists():
        raise RuntimeError(f"{path}: expected file not to exist")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")


# Immutable judge family/case contract fingerprint.
replace_once(
    "app/scripts/analyze-plan-judge.mjs",
    """  expectedByFamily.set(family.familyId, new Set(caseIds));
}

const rawRows = parseJsonl(inputPath);
""",
    """  expectedByFamily.set(family.familyId, new Set(caseIds));
}

const caseSetContract = [...expectedByFamily.entries()]
  .map(([familyId, caseIds]) => ({ familyId, caseIds: [...caseIds].sort() }))
  .sort((a, b) => a.familyId.localeCompare(b.familyId));
const caseSetSha256 = createHash('sha256')
  .update(JSON.stringify(caseSetContract))
  .digest('hex');

const rawRows = parseJsonl(inputPath);
""",
)
replace_once(
    "app/scripts/analyze-plan-judge.mjs",
    """  corpusSha256: hashFile(corpusPath),
  familiesSha256: hashFile(familiesPath),
  promptSha256: hashFile(promptPath),
""",
    """  corpusSha256: hashFile(corpusPath),
  familiesSha256: hashFile(familiesPath),
  caseSetSha256,
  promptSha256: hashFile(promptPath),
""",
)

# Previous-run diff must use historical provenance rather than candidate provenance.
replace_once(
    "app/scripts/check-plan-judge-drift.mjs",
    "import { resolve, dirname } from 'node:path';",
    "import { resolve } from 'node:path';",
)
replace_once(
    "app/scripts/check-plan-judge-drift.mjs",
    """      provenance: {
        corpusCommit: data.current.corpusCommit,
        judgeModel: data.current.judgeModel,
        promptSha256: current.provenance?.promptSha256,
        responseSchemaSha256: current.provenance?.responseSchemaSha256,
      },
      familyCount: Object.keys(data.familyDeltas || {}).length || 11,
      caseCount: 60,
""",
    """      provenance: {
        corpusCommit: data.current.corpusCommit,
        judgeModel: data.current.judgeModel,
        judgeProvider: data.current.judgeProvider,
        promptSha256: data.current.promptSha256,
        responseSchemaSha256: data.current.responseSchemaSha256,
        caseSetSha256: data.current.caseSetSha256,
        corpusSha256: data.current.corpusSha256,
        familiesSha256: data.current.familiesSha256,
      },
      familyCount: data.current.familyCount,
      caseCount: data.current.caseCount,
""",
)
replace_once(
    "app/scripts/check-plan-judge-drift.mjs",
    """    if (candidate) {
      baselinePath = candidate.path;
      baselineLabel = `Previous Run (${candidate.file})`;
    }
  }
}
""",
    """    if (candidate) {
      baselinePath = candidate.path;
      baselineLabel = `Previous Run (${candidate.file})`;
    } else {
      console.error('No eligible previous judge diff artifact exists; refusing to relabel the committed baseline as a previous run.');
      process.exit(1);
    }
  } else {
    console.error(`No judge history directory exists at ${historyDir}; cannot compare with --previous.`);
    process.exit(1);
  }
}
""",
)
replace_once(
    "app/scripts/check-plan-judge-drift.mjs",
    """  if (baseline.provenance.responseSchemaSha256 !== current.provenance.responseSchemaSha256) {
    fatal.push('Judge response schema hash changed; score deltas are not comparable to the committed baseline.');
  }

  const baselineModel = baseline.provenance.judgeModel ?? 'unknown';
""",
    """  if (baseline.provenance.responseSchemaSha256 !== current.provenance.responseSchemaSha256) {
    fatal.push('Judge response schema hash changed; score deltas are not comparable to the committed baseline.');
  }

  if (usePrevious) {
    const baselineCaseSet = baseline.provenance.caseSetSha256;
    const currentCaseSet = current.provenance.caseSetSha256;
    if (!baselineCaseSet || !currentCaseSet) {
      fatal.push('Previous-run comparison is missing case-set provenance; legacy diff artifacts are not comparable.');
    } else if (baselineCaseSet !== currentCaseSet) {
      fatal.push('Judge family/case set changed; previous-run score deltas are not comparable.');
    }
  }

  const baselineModel = baseline.provenance.judgeModel ?? 'unknown';
""",
)
replace_once(
    "app/scripts/check-plan-judge-drift.mjs",
    """  baseline: {
    corpusCommit: baseline.provenance.corpusCommit ?? 'unknown',
    judgeModel: baseline.provenance.judgeModel ?? 'unknown',
    meanSensitivityQuality: round2(baseMean),
    scoreAverages: baseline.scoreAverages,
  },
  current: {
    corpusCommit: current.provenance.corpusCommit ?? 'unknown',
    judgeModel: current.provenance.judgeModel ?? 'unknown',
    meanSensitivityQuality: round2(currMean),
    scoreAverages: current.scoreAverages,
  },
""",
    """  baseline: {
    corpusCommit: baseline.provenance.corpusCommit ?? 'unknown',
    judgeModel: baseline.provenance.judgeModel ?? 'unknown',
    judgeProvider: baseline.provenance.judgeProvider ?? 'unknown',
    promptSha256: baseline.provenance.promptSha256,
    responseSchemaSha256: baseline.provenance.responseSchemaSha256,
    caseSetSha256: baseline.provenance.caseSetSha256,
    familyCount: baseline.familyCount,
    caseCount: baseline.caseCount,
    meanSensitivityQuality: round2(baseMean),
    scoreAverages: baseline.scoreAverages,
  },
  current: {
    corpusCommit: current.provenance.corpusCommit ?? 'unknown',
    judgeModel: current.provenance.judgeModel ?? 'unknown',
    judgeProvider: current.provenance.judgeProvider ?? 'unknown',
    promptSha256: current.provenance.promptSha256,
    responseSchemaSha256: current.provenance.responseSchemaSha256,
    caseSetSha256: current.provenance.caseSetSha256,
    corpusSha256: current.provenance.corpusSha256,
    familiesSha256: current.provenance.familiesSha256,
    familyCount: current.familyCount,
    caseCount: current.caseCount,
    meanSensitivityQuality: round2(currMean),
    scoreAverages: current.scoreAverages,
  },
""",
)

# 'either' means unrestricted, not a literal restrictive day override.
replace_once(
    "app/src/engine/schedule.ts",
    """    const userEnvironment = (userContext as { environment?: TrainingEnvironment } | null | undefined)?.environment
        ?? (userContext?.constraints as { environment?: TrainingEnvironment } | null | undefined)?.environment
        ?? null;

    return {
""",
    """    const userEnvironment = (userContext as { environment?: TrainingEnvironment } | null | undefined)?.environment
        ?? (userContext?.constraints as { environment?: TrainingEnvironment } | null | undefined)?.environment
        ?? null;
    const normalizedUserEnvironment = userEnvironment === 'either' ? null : userEnvironment;

    return {
""",
)
replace_once(
    "app/src/engine/schedule.ts",
    "environmentOverride: dayContext.environment ?? userEnvironment,",
    "environmentOverride: dayContext.environment ?? normalizedUserEnvironment,",
)

# Conservative projected thresholds must drive both candidate gating and fatigue tier.
replace_once(
    "app/src/engine/planner.ts",
    """export const PROJECTED_FATIGUE_RECOVER_THRESHOLD = 0.65;
export const PROJECTED_FATIGUE_MODIFY_THRESHOLD = 0.6;
export const PROJECTED_MODIFY_MAX_SYSTEMIC_COST = 0.5;

export function maxFatigueDimension""",
    """export const PROJECTED_FATIGUE_RECOVER_THRESHOLD = 0.65;
export const PROJECTED_FATIGUE_MODIFY_THRESHOLD = 0.6;
export const PROJECTED_MODIFY_MAX_SYSTEMIC_COST = 0.5;

export interface ProjectedFatigueThresholds {
    recover: number;
    modify: number;
    modifyMaxSystemicCost: number;
}

export function projectedFatigueThresholds(conservativeBias = false): ProjectedFatigueThresholds {
    return conservativeBias
        ? { recover: PROJECTED_FATIGUE_RECOVER_THRESHOLD * 0.88, modify: PROJECTED_FATIGUE_MODIFY_THRESHOLD * 0.88, modifyMaxSystemicCost: PROJECTED_MODIFY_MAX_SYSTEMIC_COST * 0.85 }
        : { recover: PROJECTED_FATIGUE_RECOVER_THRESHOLD, modify: PROJECTED_FATIGUE_MODIFY_THRESHOLD, modifyMaxSystemicCost: PROJECTED_MODIFY_MAX_SYSTEMIC_COST };
}

export function maxFatigueDimension""",
)
replace_once(
    "app/src/engine/planner.ts",
    """export function fatigueTierFor(peakFatigue: number): 'train' | 'modify' | 'recover' {
    if (peakFatigue >= PROJECTED_FATIGUE_RECOVER_THRESHOLD) return 'recover';
    if (peakFatigue >= PROJECTED_FATIGUE_MODIFY_THRESHOLD) return 'modify';
    return 'train';
}
""",
    """export function fatigueTierFor(peakFatigue: number, thresholds: ProjectedFatigueThresholds = projectedFatigueThresholds()): 'train' | 'modify' | 'recover' {
    if (peakFatigue >= thresholds.recover) return 'recover';
    if (peakFatigue >= thresholds.modify) return 'modify';
    return 'train';
}
""",
)
replace_once(
    "app/src/engine/planner.ts",
    """    const peakFatigue = maxFatigueDimension(rankingFatigue.combinedFatigue);
    const fatigueTier = fatigueTierFor(peakFatigue);

    const eligible = eligibleTemplates(ENRICHED_TEMPLATES, shared.context, availability.maxTimeMinutes, date)
""",
    """    const peakFatigue = maxFatigueDimension(rankingFatigue.combinedFatigue);

    const eligible = eligibleTemplates(ENRICHED_TEMPLATES, shared.context, availability.maxTimeMinutes, date)
""",
)
replace_once(
    "app/src/engine/planner.ts",
    """    const isConservative = shared.preferences?.conservativeBias ?? false;
    const recoverThreshold = isConservative ? PROJECTED_FATIGUE_RECOVER_THRESHOLD * 0.88 : PROJECTED_FATIGUE_RECOVER_THRESHOLD;
    const modifyThreshold = isConservative ? PROJECTED_FATIGUE_MODIFY_THRESHOLD * 0.88 : PROJECTED_FATIGUE_MODIFY_THRESHOLD;

    const fatigueGated = eligible.filter(t => {
        if (peakFatigue >= recoverThreshold) {
            return t.category === 'Rest' || t.category === 'Mobility/Recovery';
        }
        if (peakFatigue >= modifyThreshold) {
            return t.systemicCost <= (isConservative ? PROJECTED_MODIFY_MAX_SYSTEMIC_COST * 0.85 : PROJECTED_MODIFY_MAX_SYSTEMIC_COST);
        }
""",
    """    const isConservative = shared.preferences?.conservativeBias ?? false;
    const fatigueThresholds = projectedFatigueThresholds(isConservative);
    const fatigueTier = fatigueTierFor(peakFatigue, fatigueThresholds);

    const fatigueGated = eligible.filter(t => {
        if (peakFatigue >= fatigueThresholds.recover) {
            return t.category === 'Rest' || t.category === 'Mobility/Recovery';
        }
        if (peakFatigue >= fatigueThresholds.modify) {
            return t.systemicCost <= fatigueThresholds.modifyMaxSystemicCost;
        }
""",
)

# Propagate typed direct + injury-derived guardrails to optimizer ranking.
replace_once(
    "app/src/engine/optimizer.ts",
    """    FixedActivity,
    AuthoredPlanBlock,
    IntensityClass,
""",
    """    FixedActivity,
    AuthoredPlanBlock,
    GuardrailKey,
    InjuryConstraint,
    IntensityClass,
""",
)
replace_once(
    "app/src/engine/optimizer.ts",
    "import { resolvePlanDefinitionForEvent } from './planSchedule';",
    "import { resolvePlanDefinitionForEvent } from './planSchedule';\nimport { resolveInjuryRestrictions } from './injuryPolicy';",
)
replace_once(
    "app/src/engine/optimizer.ts",
    """    /** Explicit, user-authored date overlays applied to the focus event plan. */
    authoredPlanBlocks?: readonly AuthoredPlanBlock[];
}
""",
    """    /** Explicit, user-authored date overlays applied to the focus event plan. */
    authoredPlanBlocks?: readonly AuthoredPlanBlock[];
    /** Resolved safety guardrails, including structured injury-derived guardrails. */
    guardrails?: GuardrailKey[];
}
""",
)
replace_once(
    "app/src/engine/optimizer.ts",
    """    availability: ResolvedAvailability;
    injuryConstraints: string[];
    preferences: UserPreferences;
""",
    """    availability: ResolvedAvailability;
    injuryConstraints: string[];
    guardrails: GuardrailKey[];
    preferences: UserPreferences;
""",
)
replace_once(
    "app/src/engine/optimizer.ts",
    """    const availability = options.resolvedAvailability ?? resolveAvailability(date, null, fixedActivities, context);
    const injuryConstraints = context.constraints?.restrictedModalities ?? [];

    const rawHistory""",
    """    const availability = options.resolvedAvailability ?? resolveAvailability(date, null, fixedActivities, context);
    const injuries = context.trainingSettings?.injuries
        ?? (context.constraints as { injuries?: InjuryConstraint[] })?.injuries
        ?? (context as { injuries?: InjuryConstraint[] })?.injuries
        ?? [];
    const activeInjuries = resolveInjuryRestrictions(injuries, date);
    const injuryConstraints = Array.from(new Set([
        ...(context.constraints?.restrictedModalities ?? []),
        ...activeInjuries.restrictedModalities,
    ]));
    const directGuardrails = (context as { guardrails?: Partial<Record<GuardrailKey, boolean>> }).guardrails ?? {};
    const configuredGuardrails = context.trainingSettings?.guardrails ?? {};
    const enabledGuardrails = (record: Partial<Record<GuardrailKey, boolean>>) => Object.entries(record)
        .filter(([, enabled]) => enabled)
        .map(([key]) => key as GuardrailKey);
    const guardrails = Array.from(new Set<GuardrailKey>([
        ...(context.constraints.impliedGuardrails ?? []),
        ...activeInjuries.impliedGuardrails,
        ...enabledGuardrails(configuredGuardrails),
        ...enabledGuardrails(directGuardrails),
    ]));

    const rawHistory""",
)
replace_once(
    "app/src/engine/optimizer.ts",
    """        availability,
        injuryConstraints,
        preferences: effectivePreferences,
""",
    """        availability,
        injuryConstraints,
        guardrails,
        preferences: effectivePreferences,
""",
)
replace_once(
    "app/src/engine/optimizer.ts",
    """            coverageState,
            fatigueTier: options.fatigueTier ?? 'train',
            ...(intent.plannedDose ? { plannedDose: intent.plannedDose } : {}),
""",
    """            coverageState,
            fatigueTier: options.fatigueTier ?? 'train',
            guardrails,
            ...(intent.plannedDose ? { plannedDose: intent.plannedDose } : {}),
""",
)
replace_once(
    "app/src/engine/optimizer.ts",
    "const hasLowerBodyGuardrail = injuryConstraints.some(c => c.toLowerCase().includes('lower'));",
    "const hasLowerBodyGuardrail = (options.guardrails ?? []).includes('avoid_heavy_lower_body');",
)

# Effective activeDose must survive simulator trace/history/corpus evidence.
replace_once(
    "app/src/engine/simulation/analyze.ts",
    """        templateId: string;
        category: SessionTemplate['category'];
        modality: SessionTemplate['modality'];
        projectedCost: WorkoutCostProfile;
""",
    """        templateId: string;
        category: SessionTemplate['category'];
        modality: SessionTemplate['modality'];
        durationMin: number;
        durationMax: number;
        stimulusProfile: WorkoutStimulusProfile | null;
        projectedCost: WorkoutCostProfile;
""",
)
replace_once(
    "app/src/engine/simulation/analyze.ts",
    """function recommendationAsDay(date: string, recommendation: Recommendation, phaseName: string): WeekAheadDay {
    return {
        date, dayOffset: 0, confidence: 'provisional', phaseName, template: recommendation.template,
        mode: recommendation.mode === 'recover' ? 'recover' : 'train', rationale: recommendation.rationale, addressesObjectives: [],
    };
}
""",
    """function scaleCostProfile(profile: WorkoutCostProfile, ratio: number): WorkoutCostProfile {
    return {
        systemic: Math.min(1, profile.systemic * ratio),
        cardiovascular: Math.min(1, profile.cardiovascular * ratio),
        lowerBody: Math.min(1, profile.lowerBody * ratio),
        upperBody: Math.min(1, profile.upperBody * ratio),
        impactTissue: Math.min(1, profile.impactTissue * ratio),
        neuromuscular: Math.min(1, profile.neuromuscular * ratio),
    };
}

function scaleStimulusProfile(profile: WorkoutStimulusProfile, ratio: number): WorkoutStimulusProfile {
    return {
        aerobicEndurance: Math.min(1, profile.aerobicEndurance * ratio),
        thresholdPower: Math.min(1, profile.thresholdPower * ratio),
        vo2MaxPower: Math.min(1, profile.vo2MaxPower * ratio),
        repeatedSurges: Math.min(1, profile.repeatedSurges * ratio),
        sprintPower: Math.min(1, profile.sprintPower * ratio),
        fatigueResistance: Math.min(1, profile.fatigueResistance * ratio),
        maxStrength: Math.min(1, profile.maxStrength * ratio),
        hypertrophy: Math.min(1, profile.hypertrophy * ratio),
    };
}

export function materializeEffectiveSimulationTemplate(template: SessionTemplate, activeDose: Recommendation['activeDose']): SessionTemplate {
    if (!activeDose) return template;
    const ratio = activeDose.doseRatio;
    return {
        ...template,
        durationMin: activeDose.durationMin,
        durationMax: activeDose.durationMax,
        systemicCost: Math.min(1, template.systemicCost * ratio),
        costProfile: template.costProfile ? scaleCostProfile(template.costProfile, ratio) : template.costProfile,
        stimulusProfile: template.stimulusProfile ? scaleStimulusProfile(template.stimulusProfile, ratio) : template.stimulusProfile,
    };
}

export function recommendationAsDay(date: string, recommendation: Recommendation, phaseName: string): WeekAheadDay {
    const effectiveTemplate = materializeEffectiveSimulationTemplate(recommendation.template, recommendation.activeDose);
    return {
        date, dayOffset: 0, confidence: 'provisional', phaseName, template: effectiveTemplate,
        mode: recommendation.mode === 'recover' ? 'recover' : 'train', rationale: recommendation.rationale, addressesObjectives: [],
    };
}
""",
)
replace_once(
    "app/src/engine/simulation/analyze.ts",
    "function traceFromRecommendation(weekIndex: number, date: string, recommendation: Recommendation): ScenarioDecisionTrace {\n    const calibration",
    "export function traceFromRecommendation(weekIndex: number, date: string, recommendation: Recommendation): ScenarioDecisionTrace {\n    const effectiveTemplate = materializeEffectiveSimulationTemplate(recommendation.template, recommendation.activeDose);\n    const calibration",
)
replace_once(
    "app/src/engine/simulation/analyze.ts",
    """            templateId: recommendation.template.id,
            category: recommendation.template.category,
            modality: recommendation.template.modality,
            projectedCost: recommendation.template.costProfile ?? ZERO_COST,
""",
    """            templateId: recommendation.template.id,
            category: recommendation.template.category,
            modality: recommendation.template.modality,
            durationMin: effectiveTemplate.durationMin,
            durationMax: effectiveTemplate.durationMax,
            stimulusProfile: effectiveTemplate.stimulusProfile ?? null,
            projectedCost: effectiveTemplate.costProfile ?? ZERO_COST,
""",
)
replace_once(
    "app/src/engine/simulation/analyze.ts",
    "selected: { templateId: day.template.id, category: day.template.category, modality: day.template.modality, projectedCost: day.template.costProfile ?? ZERO_COST },",
    "selected: { templateId: day.template.id, category: day.template.category, modality: day.template.modality, durationMin: day.template.durationMin, durationMax: day.template.durationMax, stimulusProfile: day.template.stimulusProfile ?? null, projectedCost: day.template.costProfile ?? ZERO_COST },",
)
replace_once(
    "app/src/engine/simulation/analyze.ts",
    "function toCompletedExposure(day: WeekAheadDay): CompletedExposure {",
    "export function toCompletedExposure(day: WeekAheadDay): CompletedExposure {",
)
replace_once(
    "app/scripts/simulate-plan-judge.mjs",
    """        durationMin: template?.durationMin ?? null,
        durationMax: template?.durationMax ?? null,
""",
    """        durationMin: trace.selected.durationMin ?? template?.durationMin ?? null,
        durationMax: trace.selected.durationMax ?? template?.durationMax ?? null,
""",
)
replace_once(
    "app/scripts/simulate-plan-judge.mjs",
    "stimulusProfile: template?.stimulusProfile ?? null,",
    "stimulusProfile: trace.selected.stimulusProfile ?? template?.stimulusProfile ?? null,",
)

write_new(
    "app/src/engine/reviewHardening.test.ts",
    """import { describe, expect, it } from 'vitest';
import { fatigueTierFor, projectedFatigueThresholds } from './planner';
import { buildOptimizationContext, rankCandidates } from './optimizer';
import { resolveAvailability } from './schedule';
import type { FatigueState, InjuryConstraint, SessionTemplate, UserContext, WeeklyObjective, WorkoutCostProfile, WorkoutStimulusProfile } from './models';

const ZERO_COST: WorkoutCostProfile = { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 };
const ZERO_FATIGUE: FatigueState = {
    lastUpdatedDate: '2026-08-24',
    externalLoadFatigue: ZERO_COST,
    internalResponseStrain: ZERO_COST,
    combinedFatigue: ZERO_COST,
};
const STRENGTH_STIMULUS: WorkoutStimulusProfile = {
    aerobicEndurance: 0, thresholdPower: 0, vo2MaxPower: 0, repeatedSurges: 0,
    sprintPower: 0, fatigueResistance: 0, maxStrength: 0.8, hypertrophy: 0.6,
};

function context(): UserContext {
    return {
        goals: { shortTerm: '', midTerm: '', longTerm: '' },
        constraints: {
            hasCableMachine: false,
            hasFreeWeights: true,
            hasTreadmill: false,
            hasIndoorBike: false,
            restrictedModalities: [],
            maxTimeMinutes: 90,
        },
        preferences: {
            avoidedModalities: [],
            deprioritizedModalities: [],
            preferredModalities: [],
            conservativeBias: false,
        },
    };
}

function strengthTemplate(id: string, category: SessionTemplate['category']): SessionTemplate {
    return {
        id,
        category,
        modality: 'Strength',
        durationMin: 40,
        durationMax: 50,
        title: id,
        description: id,
        requiredEquipment: [],
        environment: 'either',
        safetyTags: [],
        systemicCost: 0.4,
        objectiveTransferable: true,
        stimulusProfile: STRENGTH_STIMULUS,
        costProfile: { systemic: 0.4, cardiovascular: 0.1, lowerBody: category === 'Upper-body Strength' ? 0.1 : 0.6, upperBody: category === 'Upper-body Strength' ? 0.6 : 0.1, impactTissue: 0.1, neuromuscular: 0.4 },
    };
}

describe('PR review hardening', () => {
    it('uses the same conservative thresholds for projected candidate gating and fatigue tier', () => {
        const thresholds = projectedFatigueThresholds(true);
        expect(thresholds.recover).toBeCloseTo(0.572, 6);
        expect(thresholds.modify).toBeCloseTo(0.528, 6);
        expect(fatigueTierFor(0.58, thresholds)).toBe('recover');
        expect(fatigueTierFor(0.54, thresholds)).toBe('modify');
        expect(fatigueTierFor(0.50, thresholds)).toBe('train');
    });

    it(\"normalizes a user-level 'either' environment to no day-wide override\", () => {
        const ctx = context() as UserContext & { environment?: 'either' };
        ctx.environment = 'either';
        expect(resolveAvailability('2026-08-24', null, [], ctx).environmentOverride).toBeNull();
    });

    it('propagates structured lower-body injury guardrails into ranking preferences', () => {
        const ctx = context();
        (ctx.constraints as UserContext['constraints'] & { injuries?: InjuryConstraint[] }).injuries = [{
            id: 'hamstring-review',
            region: 'hamstring',
            severity: 'exclude',
            reviewBy: '2026-09-01',
        }];
        const objective: WeeklyObjective = {
            id: 'strength-dev',
            key: 'strength_development',
            title: 'Strength development',
            targetExposures: 1,
            completedExposures: 0,
            targetStimulus: { maxStrength: 0.7 },
            qualification: { minimumStimulus: { maxStrength: 0.5 }, allowedModalities: ['Strength'] },
        };
        const optimization = buildOptimizationContext(
            { unresolvedObjectives: [objective], fatigue: ZERO_FATIGUE },
            ctx,
            null,
            '2026-08-24',
        );

        expect(optimization.guardrails).toContain('avoid_heavy_lower_body');
        expect(optimization.options.guardrails).toContain('avoid_heavy_lower_body');

        const upper = strengthTemplate('upper-safe', 'Upper-body Strength');
        const lower = strengthTemplate('lower-heavy', 'Lower-body Strength');
        const ranked = rankCandidates(
            [lower, upper],
            optimization.unresolvedObjectives,
            optimization.fatigueState,
            optimization.availability,
            optimization.injuryConstraints,
            optimization.preferences,
            optimization.options,
        );
        const upperScore = ranked.all.find(item => item.template.id === upper.id)?.utilityScore ?? 0;
        const lowerScore = ranked.all.find(item => item.template.id === lower.id)?.utilityScore ?? 0;
        expect(upperScore).toBeGreaterThan(lowerScore);
    });
});
""",
)

write_new(
    "app/src/engine/simulation/effectiveDoseSimulation.test.ts",
    """import { describe, expect, it } from 'vitest';
import type { Recommendation } from '../models';
import { ENRICHED_TEMPLATES } from '../templates';
import { materializeEffectiveSimulationTemplate, recommendationAsDay, toCompletedExposure, traceFromRecommendation } from './analyze';

describe('effective-dose simulation evidence', () => {
    it('carries an automatic easier dose into traces and accumulated simulation history', () => {
        const template = ENRICHED_TEMPLATES.find(item => item.id === 'mob_01');
        expect(template?.easierDose).toBeDefined();
        if (!template?.easierDose) throw new Error('mob_01 must expose easierDose for this regression fixture');

        const recommendation = {
            template,
            activeDose: template.easierDose,
            mode: 'modify',
            rationale: 'modify-tier regression fixture',
        } as Recommendation;

        const effective = materializeEffectiveSimulationTemplate(template, template.easierDose);
        expect(effective.durationMin).toBe(template.easierDose.durationMin);
        expect(effective.durationMax).toBe(template.easierDose.durationMax);
        expect(effective.costProfile?.systemic).toBeCloseTo((template.costProfile?.systemic ?? 0) * template.easierDose.doseRatio, 6);

        const day = recommendationAsDay('2026-08-24', recommendation, 'Build');
        const exposure = toCompletedExposure(day);
        expect(day.template.durationMin).toBe(template.easierDose.durationMin);
        expect(exposure.trainingRecordLike.duration_min).toBe(template.easierDose.durationMin);
        expect(exposure.costProfile.systemic).toBeCloseTo((template.costProfile?.systemic ?? 0) * template.easierDose.doseRatio, 6);
        if (template.stimulusProfile) {
            expect(exposure.stimulusProfile?.aerobicEndurance).toBeCloseTo(template.stimulusProfile.aerobicEndurance * template.easierDose.doseRatio, 6);
        }

        const trace = traceFromRecommendation(0, '2026-08-24', recommendation);
        expect(trace.mode).toBe('modify');
        expect(trace.selected.durationMin).toBe(template.easierDose.durationMin);
        expect(trace.selected.projectedCost.systemic).toBeCloseTo(exposure.costProfile.systemic, 6);
        expect(trace.selected.stimulusProfile).toEqual(exposure.stimulusProfile ?? null);
    });
});
""",
)

write_new(
    "app/src/engine/judgeDriftScript.test.ts",
    """import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../../scripts/check-plan-judge-drift.mjs', import.meta.url));
const roots: string[] = [];

afterEach(() => {
    while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

function summary(commit: string, promptSha256 = 'prompt-a') {
    return {
        schema: 'adaptive-training-recommender/ai-plan-judge-summary@3',
        provenance: {
            corpusCommit: commit,
            judgeModel: 'judge-model',
            judgeProvider: 'local',
            promptSha256,
            responseSchemaSha256: 'schema-a',
            caseSetSha256: 'case-set-a',
        },
        familyCount: 1,
        caseCount: 1,
        meanSensitivityQuality: 5,
        scoreAverages: { overall: 5 },
        familySensitivity: [{ familyId: 'family-a', sensitivityQuality: 5 }],
    };
}

function setup() {
    const root = mkdtempSync(join(tmpdir(), 'judge-drift-'));
    roots.push(root);
    const appDir = join(root, 'app');
    const currentPath = join(appDir, 'artifacts/ai-plan-judge/latest/judge-summary.json');
    const baselinePath = join(root, 'docs/analysis/plan-judge-baseline.json');
    mkdirSync(dirname(currentPath), { recursive: true });
    mkdirSync(dirname(baselinePath), { recursive: true });
    writeFileSync(currentPath, JSON.stringify(summary('current')));
    writeFileSync(baselinePath, JSON.stringify(summary('baseline')));
    return { appDir };
}

function run(appDir: string) {
    return spawnSync(process.execPath, [SCRIPT, '--previous'], { cwd: appDir, encoding: 'utf8' });
}

describe('judge:diff:prev provenance hardening', () => {
    it('fails closed when no previous artifact exists', () => {
        const { appDir } = setup();
        const result = run(appDir);
        expect(result.status).toBe(1);
        expect(result.stderr).toContain('cannot compare with --previous');
    });

    it('does not borrow the current prompt hash for a historical diff artifact', () => {
        const { appDir } = setup();
        const historyDir = join(appDir, 'artifacts/ai-plan-judge/history');
        mkdirSync(historyDir, { recursive: true });
        writeFileSync(join(historyDir, 'diff-2026-08-23T10-00-00-000Z.json'), JSON.stringify({
            comparedAt: '2026-08-23T10:00:00.000Z',
            current: {
                corpusCommit: 'previous',
                judgeModel: 'judge-model',
                judgeProvider: 'local',
                promptSha256: 'prompt-b',
                responseSchemaSha256: 'schema-a',
                caseSetSha256: 'case-set-a',
                familyCount: 1,
                caseCount: 1,
                meanSensitivityQuality: 5,
                scoreAverages: { overall: 5 },
            },
            familyDeltas: { 'family-a': { current: 5 } },
        }));

        const result = run(appDir);
        expect(result.status).toBe(1);
        expect(result.stderr).toContain('Judge prompt hash changed');
    });

    it('rejects legacy previous artifacts that lack immutable case-set provenance', () => {
        const { appDir } = setup();
        const historyDir = join(appDir, 'artifacts/ai-plan-judge/history');
        mkdirSync(historyDir, { recursive: true });
        writeFileSync(join(historyDir, 'diff-2026-08-23T10-00-00-000Z.json'), JSON.stringify({
            comparedAt: '2026-08-23T10:00:00.000Z',
            current: {
                corpusCommit: 'previous',
                judgeModel: 'judge-model',
                judgeProvider: 'local',
                promptSha256: 'prompt-a',
                responseSchemaSha256: 'schema-a',
                familyCount: 1,
                caseCount: 1,
                meanSensitivityQuality: 5,
                scoreAverages: { overall: 5 },
            },
            familyDeltas: { 'family-a': { current: 5 } },
        }));

        const result = run(appDir);
        expect(result.status).toBe(1);
        expect(result.stderr).toContain('missing case-set provenance');
    });
});
""",
)

# Document evidence semantics and judge uncertainty policy.
replace_once(
    "docs/analysis/ai-plan-judge.md",
    """This matters when interpreting judge rationales. Statements such as “the athlete was severely fatigued for the entire 14-day plan” overstate what the packet establishes. Acute-versus-persistent daily recovery trajectories are valuable future corpus coverage, but adding them changes the evidence contract and should be reviewed/re-baselined explicitly rather than smuggled into an engine-calibration PR.

## Analyze and compare
""",
    """This matters when interpreting judge rationales. Statements such as “the athlete was severely fatigued for the entire 14-day plan” overstate what the packet establishes. Acute-versus-persistent daily recovery trajectories are valuable future corpus coverage, but adding them changes the evidence contract and should be reviewed/re-baselined explicitly rather than smuggled into an engine-calibration PR.

### Effective prescribed dose in simulation

When production returns an automatic `activeDose` (for example an easier variant on a `modify` day), the simulator materializes that effective prescription before it writes the day trace, accumulated history, or judge packet. Duration, cost and stimulus therefore represent the prescribed reduced dose rather than the catalog template's nominal full dose. Template identity remains stable so workout/coverage identity is not lost.

This is an evidence-integrity rule: a judge must not see `mode: modify` paired with full-dose load, and the following simulated week must not inherit fatigue/objective credit as though the dose reduction never happened.

## Analyze and compare
""",
)
replace_once(
    "docs/analysis/ai-plan-judge.md",
    """LLM scores are noisy. Prefer deterministic invariants, repeated family/case patterns, a same-model rerun, and direct plan inspection over one-off decimal deltas.

## Calibration interpretation guardrails
""",
    """LLM scores are noisy. Prefer deterministic invariants, repeated family/case patterns, a same-model rerun, and direct plan inspection over one-off decimal deltas.

To compare with the most recent compatible historical run rather than the committed baseline:

```bash
npm run judge:diff:prev
```

`judge:diff:prev` fails closed when there is no eligible prior artifact. New diff artifacts persist the previous run's own model/provider, prompt hash, response-schema hash, exact family/case-set fingerprint and counts. Legacy diff artifacts that do not carry that immutable provenance are intentionally treated as non-comparable; the checker never fills missing historical provenance from the current candidate.

### Judge uncertainty before gating

Do not turn a one-off decimal movement into a merge gate. Before using `--fail-on-regression` as a consequential policy gate, characterize same-model repeatability on the frozen baseline (multiple fresh runs with the same prompt/schema/model), then interpret family-level movement relative to that observed run-to-run variation. A change smaller than ordinary judge variation should be reported as inconclusive rather than as a physiological or algorithmic regression.

For high-impact behavior changes, prefer repeated same-model scoring plus the blinded A/B helper and direct plan inspection. This uncertainty procedure is evaluation policy only; it must not be converted into production recovery thresholds.

## Calibration interpretation guardrails
""",
)

print("Applied PR 214 review hardening transformations successfully.")
