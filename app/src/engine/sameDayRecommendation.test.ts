import { describe, expect, it } from 'vitest';
import { sameDayRecommendationArguments } from './sameDayRecommendation';

describe('same-day recommendation call shape', () => {
    it('keeps the Home evaluator arguments in their current positional contract', () => {
        const userId = 'user';
        const readiness = { subjective: {}, objective: {} } as never;
        const context = {} as never;
        const events = [] as never[];
        const previousMode = 'recover' as const;
        const provider = {} as never;
        const snapshot = {} as never;
        const fixedActivities = [] as never[];
        const planBlocks = [] as never[];
        const profile = null;
        const preferences = null;
        const externalPlan = {} as never;
        const externalRest = {} as never;
        const overlays = [] as never[];
        const progression = new Map<string, number>();
        const checkins = [] as never[];

        expect(sameDayRecommendationArguments({
            userId, readiness, context, events, date: '2026-09-28', previousMode,
            historyProvider: provider, preparedHistorySnapshot: snapshot,
            fixedActivities, authoredPlanBlocks: planBlocks, trainingIntentProfile: profile,
            preferences, externalPlan, externalRest, scheduleOverlays: overlays,
            confirmedProgressionOverrides: progression, mechanicalCheckinHistory: checkins,
        })).toEqual([
            userId, readiness, context, events, '2026-09-28', previousMode, provider, snapshot,
            fixedActivities, planBlocks, profile, preferences, 'max', externalPlan,
            undefined, undefined, externalRest, false, overlays, progression, undefined, checkins,
        ]);
    });
});
