import { describe, expect, it } from 'vitest';
import type { FixedActivity, UserContext } from './models';
import { dedupeFixedActivitiesByLedgerIdentity, pendingFixedActivityLedgerEntries } from './fixedActivityLedger';
import { resolveAvailability } from './schedule';

function activity({ id, ...overrides }: Partial<FixedActivity> & Pick<FixedActivity, 'id'>): FixedActivity {
    return {
        id,
        userId: 'u1', title: 'Fixed activity', date: '2026-09-10', durationMin: 30,
        fixed: true, environment: 'either', equipment: [], isCompleted: false,
        createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z',
        ...overrides,
    };
}

const context: UserContext = {
    goals: { shortTerm: '', midTerm: '', longTerm: '' },
    constraints: { hasCableMachine: false, hasFreeWeights: false, hasTreadmill: false, hasIndoorBike: false, maxTimeMinutes: 90 },
    preferences: { avoidedModalities: [], deprioritizedModalities: [], preferredModalities: [], conservativeBias: false },
};

describe('fixed activity D-LEDGER adapter', () => {
    it('uses the newest occurrence revision once across schedule time and ledger cost', () => {
        const stale = activity({ id: 'football', durationMin: 60, expectedCost: { systemic: 0.6 }, updatedAt: '2026-09-01T00:00:00Z' });
        const current = activity({ id: 'football', durationMin: 30, expectedCost: { systemic: 0.2 }, updatedAt: '2026-09-02T00:00:00Z' });

        expect(dedupeFixedActivitiesByLedgerIdentity([stale, current])).toEqual([current]);
        expect(pendingFixedActivityLedgerEntries([stale, current])).toEqual([{
            occurrenceId: 'fixed:football', revision: Date.parse(current.updatedAt),
            reservedMinutes: 30, reservedSystemicCost: 0.2, state: 'reserved',
        }]);
        expect(resolveAvailability('2026-09-10', null, [stale, current], context).maxTimeMinutes).toBe(60);
    });

    it('reconciles an occurrence before date filtering when a newer revision moves it', () => {
        const stale = activity({
            id: 'football', date: '2026-09-10', durationMin: 30,
            expectedCost: { systemic: 0.2 }, updatedAt: '2026-09-01T00:00:00Z',
        });
        const current = activity({
            id: 'football', date: '2026-09-11', durationMin: 30,
            expectedCost: { systemic: 0.2 }, updatedAt: '2026-09-02T00:00:00Z',
        });

        const oldDate = resolveAvailability('2026-09-10', null, [stale, current], context);
        const newDate = resolveAvailability('2026-09-11', null, [stale, current], context);

        expect(oldDate.fixedActivities).toEqual([]);
        expect(oldDate.maxTimeMinutes).toBe(90);
        expect(newDate.fixedActivities).toEqual([current]);
        expect(newDate.maxTimeMinutes).toBe(60);
    });

    it('canonicalizes occurrence order and ignores representation-only ordering differences', () => {
        const zeta = activity({ id: 'zeta', equipment: ['bike', 'trainer'] });
        const alpha = activity({
            id: 'alpha', equipment: ['trainer', 'bike'],
            expectedCost: { lowerBody: 0.3, systemic: 0.2 },
        });
        const alphaEquivalent = activity({
            id: 'alpha', equipment: ['bike', 'trainer'],
            expectedCost: { systemic: 0.2, lowerBody: 0.3 },
        });

        expect(dedupeFixedActivitiesByLedgerIdentity([zeta, alphaEquivalent, alpha]))
            .toEqual([alphaEquivalent, zeta]);
        expect(dedupeFixedActivitiesByLedgerIdentity([alpha, zeta, alphaEquivalent]))
            .toEqual([alpha, zeta]);
    });

    it('fails closed when equal revisions disagree on decision-bearing fields', () => {
        const left = activity({ id: 'football', startTime: '08:00', durationMin: 30, expectedCost: { systemic: 0.2 } });
        const right = activity({ id: 'football', startTime: '18:00', durationMin: 30, expectedCost: { systemic: 0.2 } });

        expect(() => dedupeFixedActivitiesByLedgerIdentity([left, right]))
            .toThrow("Conflicting fixed-activity revisions for occurrence 'fixed:football'");
    });
});
