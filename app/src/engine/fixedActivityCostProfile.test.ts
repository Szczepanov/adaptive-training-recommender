import { describe, expect, it } from 'vitest';
import { sumFixedActivityCostProfiles, ZERO_COST_PROFILE } from './fixedActivityCostProfile';
import type { FixedActivity } from './models';

function activity(overrides: Partial<FixedActivity> = {}): FixedActivity {
    return {
        id: 'a1', userId: 'athlete-1', title: 'Fixed commitment', date: '2026-08-09', durationMin: 60,
        isCompleted: false, fixed: true, environment: 'either', equipment: [],
        createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z',
        ...overrides,
    };
}

// ADR-0036 D-LEDGER: this reduce was previously duplicated near-verbatim in
// schedule.ts/planner.ts/rules.ts. These tests protect the shared behavior directly;
// each call site's own date/completion filtering is protected separately by that call
// site's existing tests (architecture.test.ts, planner.test.ts's Phase 6.2b block, and
// the rules.ts next-day-projection tests).

describe('sumFixedActivityCostProfiles', () => {
    it('returns the zero profile for no activities', () => {
        expect(sumFixedActivityCostProfiles([])).toEqual(ZERO_COST_PROFILE);
    });

    it('sums each of the six dimensions independently across multiple activities', () => {
        const result = sumFixedActivityCostProfiles([
            activity({ id: 'a1', expectedCost: { systemic: 0.2, lowerBody: 0.3 } }),
            activity({ id: 'a2', expectedCost: { systemic: 0.1, cardiovascular: 0.4, neuromuscular: 0.05 } }),
        ]);

        expect(result.systemic).toBeCloseTo(0.3);
        expect(result.cardiovascular).toBeCloseTo(0.4);
        expect(result.lowerBody).toBeCloseTo(0.3);
        expect(result.upperBody).toBe(0);
        expect(result.impactTissue).toBe(0);
        expect(result.neuromuscular).toBeCloseTo(0.05);
    });

    // D6-C: a missing expectedCost is "unknown/not modelled" and contributes zero -- it
    // must never fall back to an invented default cost.
    it('contributes zero for an activity with no expectedCost at all', () => {
        const result = sumFixedActivityCostProfiles([activity({ expectedCost: undefined })]);
        expect(result).toEqual(ZERO_COST_PROFILE);
    });

    it('does not filter by date or completion -- callers are responsible for pre-scoping the list', () => {
        const result = sumFixedActivityCostProfiles([
            activity({ date: '2026-08-09', isCompleted: true, expectedCost: { systemic: 0.5 } }),
            activity({ date: '2026-09-01', isCompleted: false, expectedCost: { systemic: 0.5 } }),
        ]);
        expect(result.systemic).toBe(1);
    });
});
