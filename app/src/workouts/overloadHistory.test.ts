import { describe, expect, it } from 'vitest';
import { distinctLoggedExercises, summarizeExerciseAcrossSessions, summarizeExerciseSession } from './overloadHistory';
import type { LoggedSet, StrengthSession } from '../engine/models';

function set(overrides: Partial<LoggedSet> = {}): LoggedSet {
    return { setIndex: 1, weightKg: 80, reps: 5, isWarmup: false, completedAt: '2026-08-17T18:00:00Z', ...overrides };
}

function session(overrides: Partial<StrengthSession> = {}): StrengthSession {
    return {
        userId: 'u1', sessionId: 's1', date: '2026-08-17', startedAt: '2026-08-17T18:00:00Z',
        updatedAt: '2026-08-17T18:00:00Z', state: 'in_progress', exercises: [], schemaVersion: 1,
        ...overrides,
    };
}

describe('summarizeExerciseSession', () => {
    it('returns null when the exercise was not logged this session', () => {
        const s = session({ exercises: [{ exerciseId: 'pull_up', sets: [set()] }] });
        expect(summarizeExerciseSession(s, { exerciseId: 'front_squat' })).toBeNull();
    });

    it('returns null when the exercise is present but has no sets', () => {
        const s = session({ exercises: [{ exerciseId: 'front_squat', sets: [] }] });
        expect(summarizeExerciseSession(s, { exerciseId: 'front_squat' })).toBeNull();
    });

    it('computes tonnage from working sets only, excluding warm-ups', () => {
        const s = session({ exercises: [{ exerciseId: 'front_squat', sets: [
            set({ setIndex: 1, weightKg: 40, reps: 5, isWarmup: true }),
            set({ setIndex: 2, weightKg: 100, reps: 5, isWarmup: false }),
            set({ setIndex: 3, weightKg: 100, reps: 5, isWarmup: false }),
        ] }] });
        const summary = summarizeExerciseSession(s, { exerciseId: 'front_squat' });
        expect(summary?.tonnageKg).toBe(1000); // 100*5 + 100*5, the 40kg warm-up excluded
        expect(summary?.totalReps).toBe(15); // all three sets, including the warm-up
        expect(summary?.workingSetCount).toBe(2);
        expect(summary?.setCount).toBe(3);
    });

    it('contributes 0kg tonnage for a bodyweight working set rather than dropping it', () => {
        const s = session({ exercises: [{ exerciseId: 'pull_up', sets: [set({ weightKg: null, reps: 8, isWarmup: false })] }] });
        const summary = summarizeExerciseSession(s, { exerciseId: 'pull_up' });
        expect(summary?.tonnageKg).toBe(0);
        expect(summary?.totalReps).toBe(8);
    });

    it('picks the heaviest working set, ties broken by more reps', () => {
        const s = session({ exercises: [{ exerciseId: 'front_squat', sets: [
            set({ setIndex: 1, weightKg: 100, reps: 5 }),
            set({ setIndex: 2, weightKg: 105, reps: 3 }),
            set({ setIndex: 3, weightKg: 105, reps: 5 }),
        ] }] });
        expect(summarizeExerciseSession(s, { exerciseId: 'front_squat' })?.heaviestSet).toMatchObject({ setIndex: 3, weightKg: 105, reps: 5 });
    });

    it('excludes a warm-up from heaviest-set consideration even if it was the heaviest weight moved', () => {
        const s = session({ exercises: [{ exerciseId: 'front_squat', sets: [
            set({ setIndex: 1, weightKg: 150, reps: 1, isWarmup: true }),
            set({ setIndex: 2, weightKg: 100, reps: 5, isWarmup: false }),
        ] }] });
        expect(summarizeExerciseSession(s, { exerciseId: 'front_squat' })?.heaviestSet).toMatchObject({ setIndex: 2 });
    });

    it('returns a null heaviestSet when every working set was bodyweight', () => {
        const s = session({ exercises: [{ exerciseId: 'pull_up', sets: [set({ weightKg: null })] }] });
        expect(summarizeExerciseSession(s, { exerciseId: 'pull_up' })?.heaviestSet?.weightKg).toBeNull();
    });

    it('never conflates two distinct free-text exercises that share exerciseId: null', () => {
        const s = session({ exercises: [
            { exerciseId: null, freeTextName: 'Farmer carry', sets: [set({ weightKg: 60 })] },
            { exerciseId: null, freeTextName: 'Sled push', sets: [set({ weightKg: 90 })] },
        ] });
        const farmerCarry = summarizeExerciseSession(s, { exerciseId: null, freeTextName: 'Farmer carry' });
        const sledPush = summarizeExerciseSession(s, { exerciseId: null, freeTextName: 'Sled push' });
        expect(farmerCarry?.tonnageKg).toBe(60 * 5);
        expect(sledPush?.tonnageKg).toBe(90 * 5);
    });
});

describe('summarizeExerciseAcrossSessions', () => {
    it('includes only sessions that logged the exercise, sorted oldest first', () => {
        const s1 = session({ sessionId: 's1', date: '2026-08-10', exercises: [{ exerciseId: 'front_squat', sets: [set({ weightKg: 90 })] }] });
        const s2 = session({ sessionId: 's2', date: '2026-08-03', exercises: [{ exerciseId: 'front_squat', sets: [set({ weightKg: 80 })] }] });
        const s3 = session({ sessionId: 's3', date: '2026-08-05', exercises: [{ exerciseId: 'pull_up', sets: [set()] }] }); // different exercise
        const history = summarizeExerciseAcrossSessions([s1, s2, s3], { exerciseId: 'front_squat' });
        expect(history.map(entry => entry.sessionId)).toEqual(['s2', 's1']);
    });

    it('includes sessions in every state -- an abandoned session still did real work', () => {
        const abandoned = session({ sessionId: 's1', state: 'abandoned', exercises: [{ exerciseId: 'front_squat', sets: [set()] }] });
        expect(summarizeExerciseAcrossSessions([abandoned], { exerciseId: 'front_squat' })).toHaveLength(1);
    });

    it('returns an empty history when the exercise was never logged', () => {
        const s = session({ exercises: [{ exerciseId: 'pull_up', sets: [set()] }] });
        expect(summarizeExerciseAcrossSessions([s], { exerciseId: 'front_squat' })).toEqual([]);
    });
});

describe('distinctLoggedExercises', () => {
    it('lists each catalog exercise once even if logged across several sessions', () => {
        const s1 = session({ sessionId: 's1', exercises: [{ exerciseId: 'front_squat', sets: [set()] }] });
        const s2 = session({ sessionId: 's2', exercises: [{ exerciseId: 'front_squat', sets: [set()] }, { exerciseId: 'pull_up', sets: [set()] }] });
        expect(distinctLoggedExercises([s1, s2])).toEqual([{ exerciseId: 'front_squat' }, { exerciseId: 'pull_up' }]);
    });

    it('keeps two free-text exercises with different names distinct', () => {
        const s = session({ exercises: [
            { exerciseId: null, freeTextName: 'Farmer carry', sets: [set()] },
            { exerciseId: null, freeTextName: 'Sled push', sets: [set()] },
        ] });
        expect(distinctLoggedExercises([s])).toEqual([
            { exerciseId: null, freeTextName: 'Farmer carry' },
            { exerciseId: null, freeTextName: 'Sled push' },
        ]);
    });

    it('excludes an exercise entry that was added but never had a set logged', () => {
        const s = session({ exercises: [{ exerciseId: 'front_squat', sets: [] }] });
        expect(distinctLoggedExercises([s])).toEqual([]);
    });
});
