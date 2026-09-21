import { describe, expect, it } from 'vitest';
import type { UserContext } from './models';
import { createEmptyFatigue } from './fatigue';
import { evaluatePeriodizationPhase } from './periodization';
import { generateWeeklyObjectives } from './microcycle';
import { effectiveTemplateForProjection, evaluateProjectedDate, NEUTRAL_PREFERENCES } from './planner';
import { ENRICHED_TEMPLATES } from './templates';
import {
    evaluateRollingLoadBudget,
    ROLLING_LOAD_BUDGET_POLICY_VERSION,
    type RollingLoadBudgetProfile,
} from './rollingLoadBudget';

const TODAY = '2026-09-13';
const DATE = '2026-09-14';

function context(): UserContext {
    return {
        goals: { shortTerm: '', midTerm: '', longTerm: '' },
        constraints: {
            hasCableMachine: false, hasFreeWeights: true, hasTreadmill: false, hasIndoorBike: true,
            restrictedModalities: [], maxTimeMinutes: 90,
        },
        preferences: { avoidedModalities: [], deprioritizedModalities: [], preferredModalities: [], conservativeBias: false },
    };
}

function profile(): RollingLoadBudgetProfile {
    return {
        policyVersion: ROLLING_LOAD_BUDGET_POLICY_VERSION,
        confidence: 'established',
        baselineSessionCount: 3,
        baselineWindowStartDate: '2026-07-20',
        baselineWindowEndDate: '2026-08-30',
        limits: { systemic: 0.7, cardiovascular: 0.9, lowerBody: 0.6, upperBody: 0.6, impactTissue: 0.6, neuromuscular: 0.6 },
    };
}

function evaluateFor(conservativeBias: boolean) {
    const phase = evaluatePeriodizationPhase([], TODAY, TODAY).phase;
    return evaluateProjectedDate(DATE, {
        microcycle: generateWeeklyObjectives(phase, DATE, null),
        externalFatigue: createEmptyFatigue(TODAY),
        projectedHistory: [],
    }, {
        context: context(),
        preferences: { ...NEUTRAL_PREFERENCES, conservativeBias },
        events: [], fixedActivities: [], authoredPlanBlocks: [], scheduleOverlays: [],
        anchors: { eventSpecificAnchorDate: null, qualityAnchorDate: null },
        internalStrain: { systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0 },
        internalStrainAsOf: TODAY,
        todayDate: TODAY,
        rollingLoadBudgetProfile: profile(),
        rollingLoadBudgetHorizonStartDate: DATE,
        rollingLoadBudgetHorizonEndDate: '2026-09-20',
    });
}

describe('rolling-budget planner policy boundaries', () => {
    it('keeps budget admission and reservation topology preference-independent at a constant dose', () => {
        const neutral = evaluateFor(false);
        const conservative = evaluateFor(true);

        expect(conservative.fatigueTier).toBe(neutral.fatigueTier);
        expect(conservative.loadBudgetExcludedTemplateIds).toEqual(neutral.loadBudgetExcludedTemplateIds);
        expect(conservative.fatigueGated.map(template => template.id)).toEqual(neutral.fatigueGated.map(template => template.id));
    });

    it('charges a modify dose differently without changing the budget policy or limits', () => {
        const template = ENRICHED_TEMPLATES.find(candidate => candidate.easierDose && candidate.costProfile);
        if (!template?.easierDose || !template.costProfile) throw new Error('dose fixture missing');
        const reduced = effectiveTemplateForProjection(template, template.easierDose);
        const baseProfile = profile();
        const common = {
            asOfDate: DATE,
            horizonStartDate: DATE,
            horizonEndDate: '2026-09-20',
            profile: baseProfile,
            entries: [],
        } as const;
        const full = evaluateRollingLoadBudget({
            ...common,
            candidate: { date: DATE, occurrenceKey: 'full', source: 'projected', costProfile: template.costProfile },
        });
        const modified = evaluateRollingLoadBudget({
            ...common,
            candidate: { date: DATE, occurrenceKey: 'modified', source: 'projected', costProfile: reduced.costProfile! },
        });

        expect(modified.candidate.systemic).toBeLessThanOrEqual(full.candidate.systemic);
        expect(modified.policyVersion).toBe(full.policyVersion);
        expect(modified.remaining.systemic).toBeCloseTo(baseProfile.limits.systemic - modified.candidate.systemic);
    });
});
