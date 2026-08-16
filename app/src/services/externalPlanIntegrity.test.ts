import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EXTERNAL_PLAN_SCHEMA, type ExternalPlanHeader, type ExternalPlanPlacement, type ExternalTrainingPlan } from '../engine/models';
import type { DataState } from '../engine/dataState';

const firestore = vi.hoisted(() => ({
    collection: vi.fn(), doc: vi.fn(), getDoc: vi.fn(), getDocs: vi.fn(), setDoc: vi.fn(),
}));

vi.mock('firebase/firestore', () => firestore);
vi.mock('../firebase', () => ({ getDb: vi.fn(() => ({})) }));

import { ActiveExternalPlanService } from './activeExternalPlanService';
import { ExternalPlanService } from './externalPlanService';

function plan(overrides: Partial<ExternalTrainingPlan> = {}): ExternalTrainingPlan {
    return {
        schema: EXTERNAL_PLAN_SCHEMA,
        planId: 'autumn-block', revision: 1, title: 'Autumn block',
        startDate: '2026-08-17', weekCount: 1,
        sessions: [{
            id: 'threshold', title: 'Threshold', priority: 'key',
            placement: { week: 1, preferredDay: 'tuesday', flexibility: 'preferred', ifMissed: 'drop' },
            gating: { modality: 'cycling', intensity: 'hard', durationMin: 60, durationMax: 75, environment: 'either', equipment: [] },
            prescription: { summary: '3x12.' },
        }],
        ...overrides,
    };
}

function header(overrides: Partial<ExternalPlanHeader> = {}): ExternalPlanHeader {
    return {
        userId: 'u1', planId: 'autumn-block', revision: 1, title: 'Autumn block',
        startDate: '2026-08-17', weekCount: 1, contentHash: 'a'.repeat(64),
        importedAt: '2026-08-16T08:00:00.000Z', supersededFrom: null, updatedAt: '2026-08-16T08:00:00.000Z',
        ...overrides,
    };
}

function placement(overrides: Partial<ExternalPlanPlacement> = {}): ExternalPlanPlacement {
    return {
        userId: 'u1', planId: 'autumn-block', revision: 1, assignments: [],
        updatedAt: '2026-08-16T08:00:00.000Z',
        ...overrides,
    };
}

describe('external plan path identity', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        firestore.doc.mockImplementation((_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }));
        firestore.collection.mockImplementation((_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }));
    });

    it('rejects valid revision bytes whose identity disagrees with the path requested by replay', async () => {
        firestore.getDoc.mockResolvedValue({
            exists: () => true,
            data: () => plan({ planId: 'different-plan' }),
        });

        const state = await new ExternalPlanService().getRevisionState('u1', 'autumn-block', 1);
        expect(state.status).toBe('INVALID');
        if (state.status !== 'INVALID') throw new Error('unreachable');
        expect(state.issues[0]).toMatchObject({ code: 'path-identity-mismatch', field: 'planId' });
    });

    it('rejects a header whose embedded plan id disagrees with its document id', async () => {
        firestore.getDoc.mockResolvedValue({
            exists: () => true,
            data: () => header({ planId: 'different-plan' }),
        });

        const state = await new ExternalPlanService().getHeaderState('u1', 'autumn-block');
        expect(state.status).toBe('INVALID');
        if (state.status !== 'INVALID') throw new Error('unreachable');
        expect(state.issues[0]).toMatchObject({ code: 'path-identity-mismatch', field: 'planId' });
    });
});

describe('active external placement revision integrity', () => {
    it('does not apply a stale overlay to a newer immutable revision', async () => {
        const stale = placement({ revision: 1 });
        const currentHeader = header({ revision: 2 });
        const currentPlan = plan({ revision: 2 });
        const plans = {
            listPlanIds: vi.fn(async () => ({ status: 'AVAILABLE', data: ['autumn-block'], revision: null } as DataState<string[]>)),
            getHeaderState: vi.fn(async () => ({ status: 'AVAILABLE', data: currentHeader, revision: currentHeader.contentHash } as DataState<ExternalPlanHeader>)),
            getRevisionState: vi.fn(async () => ({ status: 'AVAILABLE', data: currentPlan, revision: '2' } as DataState<ExternalTrainingPlan>)),
            getPlacementState: vi.fn(async () => ({ status: 'AVAILABLE', data: stale, revision: stale.updatedAt } as DataState<ExternalPlanPlacement>)),
        } as unknown as ExternalPlanService;

        const state = await new ActiveExternalPlanService(plans).getActivePlanState('u1', '2026-08-18');
        expect(state.status).toBe('INVALID');
        if (state.status !== 'INVALID') throw new Error('unreachable');
        expect(state.issues[0]).toMatchObject({ code: 'placement-revision-mismatch', field: 'revision' });
    });
});
