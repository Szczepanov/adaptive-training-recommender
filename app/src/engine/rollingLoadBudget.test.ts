import { describe, expect, it } from 'vitest';
import type { SessionHistoryEntry, WorkoutCostProfile } from './models';
import {
    DEFAULT_ROLLING_LOAD_BUDGET_LIMITS,
    ROLLING_LOAD_BUDGET_BASELINE_DAYS,
    ROLLING_LOAD_BUDGET_HEADROOM_MULTIPLIER,
    ROLLING_LOAD_BUDGET_MIN_BASELINE_EXPOSURES,
    ROLLING_LOAD_BUDGET_MIN_BASELINE_SPAN_DAYS,
    ROLLING_LOAD_BUDGET_WINDOW_DAYS,
    evaluateRollingLoadBudget,
    resolveRollingLoadBudgetForecastHorizon,
    resolveRollingLoadBudgetProfile,
    type RollingLoadBudgetEntry,
} from './rollingLoadBudget';
import { getActiveKnowledgeClaim, KNOWLEDGE_CLAIM_IDS } from '../knowledge/sportsKnowledgeRegistry';

const hardCyclingCost: WorkoutCostProfile = {
    systemic: 0.6,
    cardiovascular: 0.7,
    lowerBody: 0.2,
    upperBody: 0.05,
    impactTissue: 0.05,
    neuromuscular: 0.35,
};

function history(date: string, occurrenceKey: string, costProfile = hardCyclingCost): SessionHistoryEntry {
    return {
        date,
        modality: 'Cycling',
        category: 'Hard Endurance',
        role: 'supporting',
        intensityClass: 'hard',
        systemicCost: costProfile.systemic,
        lowerBodyCost: costProfile.lowerBody,
        costProfile,
        occurrenceKey,
    } as SessionHistoryEntry;
}

function entry(date: string, occurrenceKey: string, costProfile = hardCyclingCost): RollingLoadBudgetEntry {
    return { date, occurrenceKey, source: 'completed', costProfile };
}

describe('rolling load budget', () => {
    it('is aligned with the active knowledge claim and keeps policy numbers explicit', () => {
        const claim = getActiveKnowledgeClaim(KNOWLEDGE_CLAIM_IDS.rollingLoadBudgetPolicy);
        expect(claim.statement).toContain('Product rolling-load budget v2:');
        expect(claim.statement).toContain(`${ROLLING_LOAD_BUDGET_BASELINE_DAYS}-day pre-window`);
        expect(claim.statement).toContain(`at least ${ROLLING_LOAD_BUDGET_MIN_BASELINE_EXPOSURES} completed exposures`);
        expect(claim.statement).toContain(`at least ${ROLLING_LOAD_BUDGET_MIN_BASELINE_SPAN_DAYS} calendar days`);
        expect(claim.statement).toContain(`${Math.round((ROLLING_LOAD_BUDGET_HEADROOM_MULTIPLIER - 1) * 100)}% headroom`);
        expect(claim.statement).toContain(`${DEFAULT_ROLLING_LOAD_BUDGET_LIMITS.systemic}`);
        expect(claim.statement).toContain('pre-existing exceedance in an unrelated dimension does not veto a candidate with zero contribution');
        expect(claim.limitations.join(' ')).toContain('as physiological constants');
        expect(claim.limitations.join(' ')).toContain('isolates exact-zero contributions only');
        expect(claim.version).toBe(2);
    });

    it('derives an individual profile from the stable history before the current window', () => {
        const profile = resolveRollingLoadBudgetProfile([
            history('2026-07-01', 'old-1'),
            history('2026-07-08', 'old-2'),
            history('2026-07-15', 'old-3'),
            history('2026-07-22', 'old-4'),
        ], '2026-08-01');

        expect(profile.confidence).toBe('established');
        expect(profile.baselineSessionCount).toBe(4);
        expect(profile.baselineWindowStartDate).toBe('2026-06-14');
        expect(profile.baselineWindowEndDate).toBe('2026-07-25');
        expect(profile.limits.systemic).toBeGreaterThan(0);
    });

    it('fails conservatively with a provisional profile when stable history is absent', () => {
        const profile = resolveRollingLoadBudgetProfile([history('2026-07-30', 'recent')], '2026-08-01');

        expect(profile.confidence).toBe('provisional');
        expect(profile.baselineSessionCount).toBe(0);
    });

    it('deduplicates occurrence identity and rejects a candidate that overspends the live envelope', () => {
        const profile = resolveRollingLoadBudgetProfile([], '2026-08-01');
        const duplicate = entry('2026-08-01', 'same-occurrence');
        const result = evaluateRollingLoadBudget({
            asOfDate: '2026-08-01',
            horizonStartDate: '2026-08-01',
            horizonEndDate: '2026-08-07',
            profile,
            entries: [duplicate, duplicate, entry('2026-08-02', 'second'), entry('2026-08-03', 'third')],
            candidate: entry('2026-08-04', 'candidate'),
        });

        expect(result.uniqueEntryCount).toBe(3);
        expect(result.admitted).toBe(false);
        expect(result.reason).toBe('LOAD_BUDGET_EXCEEDED');
        expect(result.remaining.systemic).toBeLessThan(0);
        expect(result.blockingDimensions).toContain('systemic');
    });

    it('keeps the horizon fixed so rest does not replenish the same forecast budget', () => {
        const profile = resolveRollingLoadBudgetProfile([], '2026-08-01');
        const entries = Array.from({ length: 3 }, (_, index) => entry(`2026-08-0${index + 1}`, `load-${index}`));
        const beforeRest = evaluateRollingLoadBudget({
            asOfDate: '2026-08-04',
            horizonStartDate: '2026-08-01',
            horizonEndDate: '2026-08-07',
            profile,
            entries,
            candidate: entry('2026-08-04', 'candidate'),
        });
        const afterRest = evaluateRollingLoadBudget({
            asOfDate: '2026-08-07',
            horizonStartDate: '2026-08-01',
            horizonEndDate: '2026-08-07',
            profile,
            entries,
            candidate: entry('2026-08-07', 'candidate-later'),
        });

        expect(beforeRest.total.systemic).toBe(afterRest.total.systemic);
        expect(beforeRest.admitted).toBe(afterRest.admitted);
        expect(ROLLING_LOAD_BUDGET_WINDOW_DAYS).toBe(7);
        expect(resolveRollingLoadBudgetForecastHorizon('2026-08-01', ROLLING_LOAD_BUDGET_WINDOW_DAYS)).toEqual({
            startDate: '2026-08-02',
            endDate: '2026-08-08',
        });
        expect(resolveRollingLoadBudgetForecastHorizon('2026-08-01')).toEqual({
            startDate: '2026-08-02',
            endDate: '2026-08-08',
        });
    });

    describe('candidate-specific dimensional admission (#705)', () => {
        const ZERO_COST: WorkoutCostProfile = {
            systemic: 0, cardiovascular: 0, lowerBody: 0, upperBody: 0, impactTissue: 0, neuromuscular: 0,
        };

        const establishedProfile = {
            policyVersion: '2026-09-rolling-load-budget-v2' as const,
            confidence: 'established' as const,
            baselineSessionCount: 4,
            baselineWindowStartDate: '2026-07-01',
            baselineWindowEndDate: '2026-08-11',
            limits: { systemic: 5.0, cardiovascular: 3.0, lowerBody: 2.0, upperBody: 3.0, impactTissue: 2.0, neuromuscular: 3.0 },
        };

        it('admits a candidate with exact zero cost in an already-over budget dimension', () => {
            // Lower body is already exhausted by prior entries (2.4 consumed vs 2.0 limit)
            const priorLowerBodyEntry: RollingLoadBudgetEntry = {
                date: '2026-08-15',
                occurrenceKey: 'heavy-squat-day',
                source: 'completed',
                costProfile: { ...ZERO_COST, lowerBody: 2.4, systemic: 1.0 },
            };
            // Candidate has lowerBody: 0 (e.g. upper body strength), while contributed dimensions fit easily
            const upperBodyCandidate: RollingLoadBudgetEntry = {
                date: '2026-08-17',
                occurrenceKey: 'candidate-upper',
                source: 'projected',
                costProfile: { ...ZERO_COST, upperBody: 0.9, neuromuscular: 0.5, systemic: 0.4, lowerBody: 0 },
            };

            const result = evaluateRollingLoadBudget({
                asOfDate: '2026-08-14',
                horizonStartDate: '2026-08-15',
                horizonEndDate: '2026-08-21',
                profile: establishedProfile,
                entries: [priorLowerBodyEntry],
                candidate: upperBodyCandidate,
            });

            expect(result.exceededDimensionsBefore).toEqual(['lowerBody']);
            expect(result.exceededDimensionsAfter).toEqual(['lowerBody']);
            expect(result.blockingDimensions).toEqual([]);
            expect(result.admitted).toBe(true);
            expect(result.candidateInHorizon).toBe(true);
            expect(result.reason).toBeUndefined();
        });

        it('rejects a candidate that has positive contribution to an already-over dimension', () => {
            // Cardiovascular is already over (3.2 consumed vs 3.0 limit)
            const priorCardioEntry: RollingLoadBudgetEntry = {
                date: '2026-08-15',
                occurrenceKey: 'long-ride',
                source: 'completed',
                costProfile: { ...ZERO_COST, cardiovascular: 3.2, systemic: 1.0 },
            };
            // Candidate has positive cardiovascular cost (0.2), worsening the deficit
            const candidateWithCardio: RollingLoadBudgetEntry = {
                date: '2026-08-17',
                occurrenceKey: 'candidate-with-cardio',
                source: 'projected',
                costProfile: { ...ZERO_COST, upperBody: 0.9, cardiovascular: 0.2, systemic: 0.4 },
            };

            const result = evaluateRollingLoadBudget({
                asOfDate: '2026-08-14',
                horizonStartDate: '2026-08-15',
                horizonEndDate: '2026-08-21',
                profile: establishedProfile,
                entries: [priorCardioEntry],
                candidate: candidateWithCardio,
            });

            expect(result.exceededDimensionsBefore).toEqual(['cardiovascular']);
            expect(result.exceededDimensionsAfter).toEqual(['cardiovascular']);
            expect(result.blockingDimensions).toEqual(['cardiovascular']);
            expect(result.admitted).toBe(false);
            expect(result.reason).toBe('LOAD_BUDGET_EXCEEDED');
        });

        it('rejects a candidate when its positive contribution causes a new crossing over the limit', () => {
            // Lower body has 1.8 consumed vs 2.0 limit (headroom = 0.2)
            const priorEntry: RollingLoadBudgetEntry = {
                date: '2026-08-15',
                occurrenceKey: 'moderate-squats',
                source: 'completed',
                costProfile: { ...ZERO_COST, lowerBody: 1.8, systemic: 0.8 },
            };
            // Candidate contributes lowerBody: 0.6, pushing total to 2.4 > 2.0
            const candidatePushesOver: RollingLoadBudgetEntry = {
                date: '2026-08-16',
                occurrenceKey: 'candidate-lower',
                source: 'projected',
                costProfile: { ...ZERO_COST, lowerBody: 0.6, systemic: 0.4 },
            };

            const result = evaluateRollingLoadBudget({
                asOfDate: '2026-08-14',
                horizonStartDate: '2026-08-15',
                horizonEndDate: '2026-08-21',
                profile: establishedProfile,
                entries: [priorEntry],
                candidate: candidatePushesOver,
            });

            expect(result.exceededDimensionsBefore).toEqual([]);
            expect(result.exceededDimensionsAfter).toEqual(['lowerBody']);
            expect(result.blockingDimensions).toEqual(['lowerBody']);
            expect(result.admitted).toBe(false);
            expect(result.reason).toBe('LOAD_BUDGET_EXCEEDED');
        });

        it('identifies only dimensions with positive candidate contribution as blocking among multiple over dimensions', () => {
            // Two dimensions are already over: lowerBody (2.5 vs 2.0) and impactTissue (2.2 vs 2.0)
            const priorEntry: RollingLoadBudgetEntry = {
                date: '2026-08-15',
                occurrenceKey: 'heavy-run',
                source: 'completed',
                costProfile: { ...ZERO_COST, lowerBody: 2.5, impactTissue: 2.2, systemic: 1.5 },
            };
            // Candidate contributes to lowerBody (0.3) but has impactTissue: 0
            const candidate: RollingLoadBudgetEntry = {
                date: '2026-08-17',
                occurrenceKey: 'candidate-cycling',
                source: 'projected',
                costProfile: { ...ZERO_COST, lowerBody: 0.3, impactTissue: 0, systemic: 0.5 },
            };

            const result = evaluateRollingLoadBudget({
                asOfDate: '2026-08-14',
                horizonStartDate: '2026-08-15',
                horizonEndDate: '2026-08-21',
                profile: establishedProfile,
                entries: [priorEntry],
                candidate,
            });

            expect(result.exceededDimensionsBefore).toEqual(['lowerBody', 'impactTissue']);
            expect(result.exceededDimensionsAfter).toEqual(['lowerBody', 'impactTissue']);
            expect(result.blockingDimensions).toEqual(['lowerBody']);
            expect(result.admitted).toBe(false);
        });

        it('does not reject candidates outside the forecast horizon even if the horizon is over budget', () => {
            // Horizon is 2026-08-15..2026-08-21 and already over budget in lowerBody
            const priorEntry: RollingLoadBudgetEntry = {
                date: '2026-08-16',
                occurrenceKey: 'over-budget-entry',
                source: 'completed',
                costProfile: { ...ZERO_COST, lowerBody: 3.0, systemic: 1.0 },
            };
            // Candidate is on 2026-08-22 (D+8, outside the horizon)
            const outsideCandidate: RollingLoadBudgetEntry = {
                date: '2026-08-22',
                occurrenceKey: 'd8-candidate',
                source: 'projected',
                costProfile: { ...ZERO_COST, lowerBody: 1.0, systemic: 0.5 },
            };

            const result = evaluateRollingLoadBudget({
                asOfDate: '2026-08-14',
                horizonStartDate: '2026-08-15',
                horizonEndDate: '2026-08-21',
                profile: establishedProfile,
                entries: [priorEntry],
                candidate: outsideCandidate,
            });

            expect(result.candidateInHorizon).toBe(false);
            expect(result.blockingDimensions).toEqual([]);
            expect(result.admitted).toBe(true);
            expect(result.exceededDimensionsAfter).toEqual(['lowerBody']);
        });

        it('preserves envelope-only over-budget reporting when no candidate is supplied', () => {
            const priorEntry: RollingLoadBudgetEntry = {
                date: '2026-08-16',
                occurrenceKey: 'over-budget-envelope',
                source: 'completed',
                costProfile: { ...ZERO_COST, lowerBody: 3.0 },
            };

            const result = evaluateRollingLoadBudget({
                asOfDate: '2026-08-14',
                horizonStartDate: '2026-08-15',
                horizonEndDate: '2026-08-21',
                profile: establishedProfile,
                entries: [priorEntry],
            });

            expect(result.candidateInHorizon).toBe(false);
            expect(result.candidate).toEqual(ZERO_COST);
            expect(result.blockingDimensions).toEqual([]);
            expect(result.exceededDimensionsAfter).toEqual(['lowerBody']);
            expect(result.admitted).toBe(false);
            expect(result.reason).toBe('LOAD_BUDGET_EXCEEDED');
        });
    });
});
