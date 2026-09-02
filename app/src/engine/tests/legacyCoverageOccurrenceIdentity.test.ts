import { describe, expect, it } from 'vitest';
import { buildCoverageState, resolveCoverageHistory } from '../coverage';
import type { PlanDefinition } from '../planSchedule';

const PLAN: PlanDefinition = {
    id: 'legacy-occurrence-identity-plan',
    eventId: 'event-1',
    coverageSetId: 'evergreen_general',
    blocks: [{
        id: 'block-1',
        phase: 'general',
        startDate: '2026-08-25',
        endDate: '2026-09-10',
        volumeScale: 1,
        intensityScale: 1,
    }],
    objectives: [{
        key: 'strength_maintenance',
        coverageKey: 'primary_strength',
        blockId: 'block-1',
        requiredCredit: 2,
        priority: 'must_have',
        coverageMinimumSessions: 1,
        coverageTargetSessions: 2,
    }],
    sequencingRules: [],
};

describe('legacy coverage occurrence identity', () => {
    it('keeps two distinct same-day executions of the same workout as two credits', () => {
        const history = resolveCoverageHistory(undefined, [
            {
                occurrenceKey: 'legacy-occ-1',
                date: '2026-09-01',
                workoutId: 'strength_full_body_maintenance_01',
            },
            {
                occurrenceKey: 'legacy-occ-2',
                date: '2026-09-01',
                workoutId: 'strength_full_body_maintenance_01',
            },
        ]);

        const state = buildCoverageState(PLAN, '2026-09-03', history);
        const requirement = state.requirements.find(item => item.key === 'primary_strength');

        expect(requirement?.completedSessions).toBe(2);
        expect(requirement?.credits.map(credit => credit.occurrenceKey)).toEqual([
            'legacy-occ-1',
            'legacy-occ-2',
        ]);
    });

    it('deduplicates replay of the same legacy occurrence key', () => {
        const history = resolveCoverageHistory(undefined, [
            {
                occurrenceKey: 'legacy-occ-replayed',
                date: '2026-09-01',
                workoutId: 'strength_full_body_maintenance_01',
            },
            {
                occurrenceKey: 'legacy-occ-replayed',
                date: '2026-09-01',
                workoutId: 'strength_full_body_maintenance_01',
            },
        ]);

        const state = buildCoverageState(PLAN, '2026-09-03', history);
        const requirement = state.requirements.find(item => item.key === 'primary_strength');

        expect(requirement?.completedSessions).toBe(1);
        expect(requirement?.credits).toHaveLength(1);
    });
});
