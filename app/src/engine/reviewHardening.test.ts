import { describe, expect, it } from 'vitest';
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

    it("normalizes a user-level 'either' environment to no day-wide override", () => {
        const ctx = context() as UserContext & { environment?: 'either' };
        ctx.environment = 'either';
        expect(resolveAvailability('2026-08-24', null, [], ctx).environmentOverride).toBeNull();
    });

    it('propagates structured lower-body injury guardrails into ranking preferences', () => {
        const ctx = context();
        (ctx.constraints as UserContext['constraints'] & { injuries?: InjuryConstraint[] }).injuries = [{
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
