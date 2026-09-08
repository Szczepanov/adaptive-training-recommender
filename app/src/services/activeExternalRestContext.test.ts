import { describe, expect, it } from 'vitest';
import type { ExternalPlanHeader, ExternalPlanSession } from '../engine/models';
import type { ActiveExternalPlan } from './activeExternalPlanService';
import { externalRestContextForDate } from './activeExternalPlanService';

const session: ExternalPlanSession = {
    id: 'w1-easy',
    title: 'Easy spin',
    priority: 'supporting',
    placement: { week: 1, preferredDay: 'thursday', flexibility: 'preferred', ifMissed: 'drop' },
    gating: {
        modality: 'cycling', intensity: 'easy', durationMin: 45, durationMax: 60,
        environment: 'either', equipment: [],
    },
    prescription: { summary: 'Zone 2.' },
};

const header: ExternalPlanHeader = {
    userId: 'u1', planId: 'autumn-block', revision: 3, title: 'Autumn block',
    startDate: '2026-08-17', weekCount: 1, contentHash: 'stored-v3-hash',
    importedAt: '2026-08-16T10:00:00Z', supersededFrom: null, updatedAt: '2026-08-16T10:00:00Z',
};

function active(placed: ActiveExternalPlan['placed'] = []): ActiveExternalPlan {
    return {
        header,
        plan: {
            schema: 'adaptive-training-recommender/external-plan@3',
            planId: 'autumn-block', revision: 3, title: 'Autumn block',
            startDate: '2026-08-17', weekCount: 1,
            sessions: [session],
            restDays: [{ id: 'w1-tue-rest', week: 1, day: 'tuesday' }],
        } as unknown as ActiveExternalPlan['plan'],
        placement: null,
        placed,
    };
}

describe('externalRestContextForDate (ADR-0035 production projection)', () => {
    it('projects a v3 rest directive with the stored immutable content hash', () => {
        expect(externalRestContextForDate(active(), '2026-08-18')).toEqual({
            planId: 'autumn-block',
            revision: 3,
            directive: { id: 'w1-tue-rest', week: 1, day: 'tuesday' },
            date: '2026-08-18',
            contentHash: 'stored-v3-hash',
        });
    });

    it('returns null on an unplanned date', () => {
        expect(externalRestContextForDate(active(), '2026-08-19')).toBeNull();
    });

    it('lets an already-confirmed placed-session overlay win over rest on the same date', () => {
        expect(externalRestContextForDate(active([
            { session, date: '2026-08-18', status: 'moved', moved: true },
        ]), '2026-08-18')).toBeNull();
    });
});
