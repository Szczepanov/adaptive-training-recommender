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
        expect(claim.statement).toContain(`${ROLLING_LOAD_BUDGET_BASELINE_DAYS}-day pre-window`);
        expect(claim.statement).toContain(`at least ${ROLLING_LOAD_BUDGET_MIN_BASELINE_EXPOSURES} completed exposures`);
        expect(claim.statement).toContain(`at least ${ROLLING_LOAD_BUDGET_MIN_BASELINE_SPAN_DAYS} calendar days`);
        expect(claim.statement).toContain(`${Math.round((ROLLING_LOAD_BUDGET_HEADROOM_MULTIPLIER - 1) * 100)}% headroom`);
        expect(claim.statement).toContain(`${DEFAULT_ROLLING_LOAD_BUDGET_LIMITS.systemic}`);
        expect(claim.limitations.join(' ')).toContain('as physiological constants');
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
});
