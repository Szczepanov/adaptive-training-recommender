import { describe, expect, it } from 'vitest';
import {
    DAILY_LEDGER_CAPACITY_BLOCKER,
    resolveWeeklyRoleReservations,
    type AllocationDateEvaluator,
    type RequiredRoleOccurrence,
} from './weeklyAllocation';

const occurrence: RequiredRoleOccurrence = {
    id: 'september_cycling_event|2026-08-03|2026-09-01|build|sustained_quality|september_cycling_event:sustained_quality|0',
    coverageSetId: 'september_cycling_event',
    coverageKey: 'sustained_quality',
    authoredSessionIdentity: 'september_cycling_event:sustained_quality',
    phase: 'build',
    windowStart: '2026-08-03',
    windowEnd: '2026-09-01',
    ordinal: 0,
    label: 'Sustained quality',
    eligibleTemplateIds: ['threshold'],
    eligibleWorkoutIds: [],
};

describe('weekly allocation D-LEDGER diagnostics', () => {
    it('does not report a ledger-blocked exact candidate as no_exact_candidate', () => {
        const date = '2026-08-11';
        const evaluator: AllocationDateEvaluator = {
            forecastDates: [date],
            evaluate: () => ({
                date,
                fatigueTier: 'train',
                acceptedTemplateIds: [],
                fatigueExcludedTemplateIds: [],
                exclusionReasons: new Map([
                    ['threshold', [DAILY_LEDGER_CAPACITY_BLOCKER]],
                ]),
            }),
        };

        const result = resolveWeeklyRoleReservations([occurrence], evaluator);

        expect(result.outcomes[0]).toMatchObject({
            status: 'missed',
            reason: 'daily_ledger_capacity',
        });
        expect(result.outcomes[0].observedBlockers).toContain(`${date}:${DAILY_LEDGER_CAPACITY_BLOCKER}`);
    });
});
