import { describe, expect, it } from 'vitest';
import { createEmptyFatigue } from './fatigue';
import type { ScheduleOverlay, UserContext } from './models';
import { generateWeeklyObjectives } from './microcycle';
import { evaluatePeriodizationPhase } from './periodization';
import { evaluateProjectedDate, NEUTRAL_PREFERENCES } from './planner';

describe('projected availability authority', () => {
    it('passes the exact overlay-aware resolved availability into optimization', () => {
        const date = '2026-09-10';
        const context: UserContext = {
            goals: { shortTerm: '', midTerm: '', longTerm: '' },
            constraints: {
                hasCableMachine: false,
                hasFreeWeights: true,
                hasTreadmill: false,
                hasIndoorBike: true,
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
        const overlay: ScheduleOverlay = {
            id: 'limited-window',
            userId: 'u1',
            title: 'Limited training window',
            category: 'limited_availability',
            startDate: date,
            endDate: date,
            dailyAvailabilityMinutes: 30,
            volumeScale: 1,
            intensityScale: 1,
            expectedCost: {
                systemic: 0,
                cardiovascular: 0,
                lowerBody: 0,
                upperBody: 0,
                impactTissue: 0,
                neuromuscular: 0,
            },
            createdAt: '2026-09-01T00:00:00Z',
            updatedAt: '2026-09-01T00:00:00Z',
        };
        const phase = evaluatePeriodizationPhase([], date, date).phase;
        const evaluation = evaluateProjectedDate(
            date,
            {
                microcycle: generateWeeklyObjectives(phase, date, null),
                externalFatigue: createEmptyFatigue(date),
                projectedHistory: [],
            },
            {
                context,
                preferences: NEUTRAL_PREFERENCES,
                events: [],
                fixedActivities: [],
                authoredPlanBlocks: [],
                scheduleOverlays: [overlay],
                anchors: { eventSpecificAnchorDate: null, qualityAnchorDate: null },
                internalStrain: {
                    systemic: 0,
                    cardiovascular: 0,
                    lowerBody: 0,
                    upperBody: 0,
                    impactTissue: 0,
                    neuromuscular: 0,
                },
                internalStrainAsOf: date,
                todayDate: date,
            },
        );

        expect(evaluation.availability.maxTimeMinutes).toBe(30);
        expect(evaluation.optimizationContext.availability).toBe(evaluation.availability);
    });
});
