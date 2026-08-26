import { beforeEach, describe, expect, it } from 'vitest';
import { usabilityMetrics } from './usabilityMetrics';

describe('usabilityMetrics task-based evaluation', () => {
    beforeEach(() => {
        usabilityMetrics.clear();
    });

    it('records recommendation view and tracks action selection duration (TTR)', () => {
        const userId = 'athlete-test';
        const date = '2026-08-26';

        usabilityMetrics.recordRecommendationView(userId, date);
        const durationMs = usabilityMetrics.recordActionSelected(userId, date, 'start_workout');

        expect(typeof durationMs).toBe('number');
        const report = usabilityMetrics.generateSummaryReport();
        expect(report.totalViews).toBe(1);
        expect(report.totalActions).toBe(1);
        expect(report.actionBreakdown.start_workout).toBe(1);
    });

    it('computes override rate and error rate accurately', () => {
        const userId = 'athlete-test';
        const date = '2026-08-26';

        usabilityMetrics.recordRecommendationView(userId, date);
        usabilityMetrics.recordActionSelected(userId, date, 'adjust_harder');
        usabilityMetrics.recordOverrideAttempt(userId, date, 'Athlete requested harder load', true);

        const report = usabilityMetrics.generateSummaryReport();
        expect(report.overrideRate).toBe(1);
        expect(report.errorRate).toBe(1);
    });
});
