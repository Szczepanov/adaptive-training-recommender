import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExternalPlanSessionOccurrence, ManualOccurrenceRef } from '../sessions/models';

const firestore = vi.hoisted(() => ({
    doc: vi.fn((...parts: string[]) => ({ path: parts.slice(1).join('/') })),
    runTransaction: vi.fn(),
}));
const parsers = vi.hoisted(() => ({
    parseDailyRecommendation: vi.fn(),
    parseSessionOccurrenceDocument: vi.fn(),
}));

vi.mock('firebase/firestore', () => firestore);
vi.mock('../firebase', () => ({ getDb: vi.fn(() => ({})) }));
vi.mock('../persistence/parsers/trainingHistory', () => ({
    parseDailyRecommendation: parsers.parseDailyRecommendation,
}));
vi.mock('../persistence/parsers/sessionDefinition', () => ({
    parseSessionOccurrenceDocument: parsers.parseSessionOccurrenceDocument,
}));

import { ManualRecommendationReplacementService } from './manualRecommendationReplacementService';

const definitionRef: ManualOccurrenceRef = {
    definitionId: 'manual-def',
    revision: 3,
    contentHash: 'm'.repeat(64),
};

const externalOccurrence: ExternalPlanSessionOccurrence = {
    userId: 'u1',
    occurrenceId: 'occ-external-1',
    date: '2026-10-05',
    authority: 'external_plan',
    externalPlanRef: {
        planId: 'coach-plan',
        revision: 7,
        sessionId: 'am-ride',
        contentHash: 'e'.repeat(64),
    },
    state: 'scheduled',
    placementOrder: 0,
    windowBinding: {
        windowId: 'am',
        bundleId: 'two-a-day',
        order: 0,
        boundStartLocal: '06:00',
        boundEndLocal: '07:30',
        startInstant: '2026-10-05T04:00:00.000Z',
        endInstant: '2026-10-05T05:30:00.000Z',
    },
    createdAt: '2026-10-05T03:30:00.000Z',
    updatedAt: '2026-10-05T03:30:00.000Z',
};

type Snapshot = { exists: () => boolean; data: () => unknown };

function snapshot(data?: unknown): Snapshot {
    return {
        exists: () => data !== undefined,
        data: () => data,
    };
}

describe('ManualRecommendationReplacementService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        parsers.parseDailyRecommendation.mockReturnValue({
            status: 'AVAILABLE',
            data: { primarySession: { occurrenceId: externalOccurrence.occurrenceId } },
        });
        parsers.parseSessionOccurrenceDocument.mockReturnValue({
            status: 'AVAILABLE',
            data: externalOccurrence,
        });
    });

    it('supersedes only the exact prepared primary and releases its owned window atomically', async () => {
        const writes = new Map<string, unknown>();
        const deletes: string[] = [];
        const tx = {
            get: vi.fn(async (ref: { path: string }) => {
                if (ref.path.endsWith(`/daily_recommendations/${externalOccurrence.date}`)) {
                    return snapshot({ recommendation: true });
                }
                if (ref.path.endsWith(`/session_occurrences/${externalOccurrence.occurrenceId}`)) {
                    return snapshot({ occurrence: true });
                }
                if (ref.path.includes('/session_occurrence_windows/')) {
                    return snapshot({ occurrenceId: externalOccurrence.occurrenceId });
                }
                return snapshot();
            }),
            set: vi.fn((ref: { path: string }, value: unknown) => writes.set(ref.path, value)),
            delete: vi.fn((ref: { path: string }) => deletes.push(ref.path)),
        };
        firestore.runTransaction.mockImplementation(async (_db: unknown, cb: (tx: typeof tx) => unknown) => cb(tx));

        const service = new ManualRecommendationReplacementService({} as never);
        const replacement = await service.replaceRecommendationOccurrence(
            'u1',
            externalOccurrence.date,
            definitionRef,
            '2026-10-05T05:00:00.000Z',
        );

        expect(replacement.authority).toBe('replace_recommendation');
        expect(replacement.state).toBe('scheduled');
        expect(replacement.occurrenceId).not.toBe(externalOccurrence.occurrenceId);
        expect(writes.get(`users/u1/session_occurrences/${externalOccurrence.occurrenceId}`)).toEqual(
            expect.objectContaining({ occurrenceId: externalOccurrence.occurrenceId, state: 'superseded' }),
        );
        expect([...writes.values()]).toContainEqual(
            expect.objectContaining({ occurrenceId: replacement.occurrenceId, authority: 'replace_recommendation' }),
        );
        expect(deletes).toHaveLength(1);
        expect(deletes[0]).toContain('session_occurrence_windows/2026-10-05__am');
    });

    it('fails closed instead of superseding an occurrence that has already started', async () => {
        parsers.parseSessionOccurrenceDocument.mockReturnValue({
            status: 'AVAILABLE',
            data: { ...externalOccurrence, state: 'active' },
        });
        const tx = {
            get: vi.fn(async (ref: { path: string }) => ref.path.includes('/daily_recommendations/')
                ? snapshot({ recommendation: true })
                : snapshot({ occurrence: true })),
            set: vi.fn(),
            delete: vi.fn(),
        };
        firestore.runTransaction.mockImplementation(async (_db: unknown, cb: (tx: typeof tx) => unknown) => cb(tx));

        const service = new ManualRecommendationReplacementService({} as never);
        await expect(service.replaceRecommendationOccurrence('u1', externalOccurrence.date, definitionRef))
            .rejects.toThrow("already 'active'");
        expect(tx.set).not.toHaveBeenCalled();
        expect(tx.delete).not.toHaveBeenCalled();
    });

    it('does not guess a displaced external occurrence when the saved recommendation has no primary binding', async () => {
        parsers.parseDailyRecommendation.mockReturnValue({ status: 'AVAILABLE', data: {} });
        const tx = {
            get: vi.fn(async () => snapshot({ recommendation: true })),
            set: vi.fn(),
            delete: vi.fn(),
        };
        firestore.runTransaction.mockImplementation(async (_db: unknown, cb: (tx: typeof tx) => unknown) => cb(tx));

        const service = new ManualRecommendationReplacementService({} as never);
        const replacement = await service.replaceRecommendationOccurrence('u1', externalOccurrence.date, definitionRef);

        expect(replacement.authority).toBe('replace_recommendation');
        expect(tx.get).toHaveBeenCalledTimes(1);
        expect(tx.delete).not.toHaveBeenCalled();
        expect(tx.set).toHaveBeenCalledTimes(1);
    });
});
