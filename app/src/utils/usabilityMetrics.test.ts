import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usabilityMetrics } from './usabilityMetrics';

const STORAGE_KEY = 'adaptive_training_usability_events_v1';

function installLocalStorage() {
    const storage = new Map<string, string>();
    const localStorageMock = {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, String(value)),
        removeItem: (key: string) => storage.delete(key),
        clear: () => storage.clear(),
    };
    vi.stubGlobal('window', { localStorage: localStorageMock });
    return storage;
}

describe('usabilityMetrics task-based evaluation', () => {
    beforeEach(() => {
        usabilityMetrics.clear();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
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

    it('times only the first action after a recommendation view', () => {
        const userId = 'athlete-test';
        const date = '2026-08-26';

        usabilityMetrics.recordRecommendationView(userId, date);
        const firstDuration = usabilityMetrics.recordActionSelected(userId, date, 'open_details');
        const laterDuration = usabilityMetrics.recordActionSelected(userId, date, 'start_workout');

        expect(typeof firstDuration).toBe('number');
        expect(laterDuration).toBeUndefined();
        expect(usabilityMetrics.generateSummaryReport().totalActions).toBe(2);
    });

    it('does not restart the TTR clock when the same recommendation is viewed again before action', () => {
        const userId = 'athlete-test';
        const date = '2026-08-26';

        usabilityMetrics.recordRecommendationView(userId, date);
        usabilityMetrics.recordRecommendationView(userId, date);
        const durationMs = usabilityMetrics.recordActionSelected(userId, date, 'start_workout');

        expect(typeof durationMs).toBe('number');
        expect(usabilityMetrics.generateSummaryReport().totalViews).toBe(2);
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

    it('records wizard completion and skip outcomes including the skip stage', () => {
        const userId = 'athlete-test';
        const date = '2026-08-26';

        usabilityMetrics.recordWizardCompleted(userId, date, 'completed', 12000, 'equipment');
        usabilityMetrics.recordWizardCompleted(userId, date, 'skipped', 3000, 'focus');

        const report = usabilityMetrics.generateSummaryReport();
        expect(report.wizardCompletions).toBe(1);
        expect(report.wizardSkips).toBe(1);
        expect(report.wizardSkipsByStage).toEqual({ focus: 1 });
        // Wizard telemetry is additive: recommendation TTR reporting is unchanged.
        expect(report.totalViews).toBe(0);
        expect(report.totalActions).toBe(0);
    });

    it('keeps session telemetry available when localStorage reads work but writes fail', () => {
        vi.stubGlobal('window', {
            localStorage: {
                getItem: () => null,
                setItem: () => { throw new Error('storage blocked'); },
                removeItem: () => undefined,
            },
        });

        usabilityMetrics.recordWizardCompleted('athlete-test', '2026-08-26', 'skipped', 3000, 'welcome');

        const report = usabilityMetrics.generateSummaryReport();
        expect(report.wizardSkips).toBe(1);
        expect(report.wizardSkipsByStage).toEqual({ welcome: 1 });
    });

    it('does not classify malformed wizard outcomes as completions', () => {
        const storage = installLocalStorage();
        storage.set(STORAGE_KEY, JSON.stringify([
            null,
            { malformed: true },
            {
                id: 'evt-wizard-malformed',
                timestamp: '2026-08-26T10:00:00.000Z',
                eventType: 'wizard_completed',
                userId: 'athlete-test',
                date: '2026-08-26',
                details: { outcome: 'unknown' },
            },
        ]));

        const report = usabilityMetrics.generateSummaryReport();
        expect(report.totalViews).toBe(0);
        expect(report.totalActions).toBe(0);
        expect(report.wizardCompletions).toBe(0);
        expect(report.wizardSkips).toBe(0);
        expect(report.wizardSkipsByStage).toEqual({});
    });
});
