import { beforeEach, describe, expect, it, vi } from 'vitest';

const firestore = vi.hoisted(() => ({ doc: vi.fn(), getDoc: vi.fn(), setDoc: vi.fn() }));

vi.mock('firebase/firestore', () => firestore);
vi.mock('../firebase', () => ({ getDb: vi.fn(() => ({})) }));

import { PreferencesService } from './preferencesService';
import type { StrengthSession } from '../engine/models';

const USER_ID = 'u1';

/** Only S2.2's applyOneRepMaxDerivations is covered here -- this service otherwise has no
 *  existing test file, and adding coverage for the rest of it is out of scope for this
 *  plan; consistent with how every other new method added in this plan is tested without
 *  taking on unrelated pre-existing gaps. */
function sessionWithExercise(exerciseId: string, weightKg: number, reps: number, rir: number): StrengthSession {
    return {
        userId: USER_ID, sessionId: 's1', date: '2026-08-17', startedAt: '2026-08-17T18:00:00Z',
        updatedAt: '2026-08-17T18:10:00Z', state: 'completed', schemaVersion: 1,
        exercises: [{ exerciseId, sets: [{ setIndex: 1, weightKg, reps, isWarmup: false, completedAt: '2026-08-17T18:10:00Z', gauge: { scale: 'rir', value: rir } }] }],
    };
}

function existingDoc(data: Record<string, unknown>) {
    firestore.getDoc.mockResolvedValue({ exists: () => true, data: () => data });
}

function missingDoc() {
    firestore.getDoc.mockResolvedValue({ exists: () => false });
}

describe('PreferencesService.applyOneRepMaxDerivations', () => {
    let service: PreferencesService;

    beforeEach(() => {
        vi.clearAllMocks();
        service = new PreferencesService();
        firestore.doc.mockReturnValue({ path: `users/${USER_ID}/preferences/profile` });
        firestore.setDoc.mockResolvedValue(undefined);
    });

    it('writes a derived value to both estimated1RmKg locations and records provenance when nothing existed before', async () => {
        missingDoc();
        const outcomes = await service.applyOneRepMaxDerivations(USER_ID, sessionWithExercise('front_squat', 100, 5, 2), '2026-08-17T18:15:00Z');

        expect(outcomes).toMatchObject([{ exerciseId: 'front_squat', result: { updated: true, source: 'derived' } }]);
        expect(firestore.setDoc).toHaveBeenCalledTimes(1);
        const [, payload] = firestore.setDoc.mock.calls[0] as [unknown, { performanceProfile: { estimated1RmKg: Record<string, number>; strength: { estimated1RmKg: Record<string, number> }; estimated1RmSources: Record<string, { source: string; computedAt?: string }> } }];
        expect(payload.performanceProfile.estimated1RmKg.front_squat).toBeCloseTo(116.7, 1);
        expect(payload.performanceProfile.strength.estimated1RmKg.front_squat).toBeCloseTo(116.7, 1);
        expect(payload.performanceProfile.estimated1RmSources.front_squat).toMatchObject({ source: 'derived', computedAt: '2026-08-17T18:15:00Z' });
    });

    it('never writes when the existing value is manual, and reports why', async () => {
        existingDoc({
            userId: USER_ID,
            performanceProfile: { estimated1RmKg: { front_squat: 120 }, estimated1RmSources: { front_squat: { source: 'manual' } } },
        });

        const outcomes = await service.applyOneRepMaxDerivations(USER_ID, sessionWithExercise('front_squat', 130, 5, 1), '2026-08-17T18:15:00Z');

        expect(outcomes).toMatchObject([{ result: { updated: false, estimatedOneRmKg: 120, source: 'manual' } }]);
        expect(firestore.setDoc).not.toHaveBeenCalled();
    });

    it('reads strength.estimated1RmKg ahead of the legacy top-level field, matching prescription.ts', async () => {
        existingDoc({
            userId: USER_ID,
            performanceProfile: {
                estimated1RmKg: { front_squat: 999 }, // legacy, should be ignored in favour of strength.*
                strength: { estimated1RmKg: { front_squat: 120 } },
                estimated1RmSources: { front_squat: { source: 'coach' } },
            },
        });

        const outcomes = await service.applyOneRepMaxDerivations(USER_ID, sessionWithExercise('front_squat', 200, 5, 1), '2026-08-17T18:15:00Z');

        // Protected because the effective (strength.*) source is coach, not because of the legacy value.
        expect(outcomes).toMatchObject([{ result: { updated: false, estimatedOneRmKg: 120, source: 'coach' } }]);
        expect(firestore.setDoc).not.toHaveBeenCalled();
    });

    it('does not write at all when no exercise produced an admissible estimate', async () => {
        missingDoc();
        const noGaugeSession: StrengthSession = {
            userId: USER_ID, sessionId: 's1', date: '2026-08-17', startedAt: '2026-08-17T18:00:00Z',
            updatedAt: '2026-08-17T18:10:00Z', state: 'completed', schemaVersion: 1,
            exercises: [{ exerciseId: 'front_squat', sets: [{ setIndex: 1, weightKg: 100, reps: 5, isWarmup: false, completedAt: '2026-08-17T18:10:00Z' }] }],
        };
        const outcomes = await service.applyOneRepMaxDerivations(USER_ID, noGaugeSession);
        expect(outcomes).toEqual([]);
        expect(firestore.setDoc).not.toHaveBeenCalled();
    });
});
