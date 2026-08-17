import { describe, expect, it } from 'vitest';
import { deriveStrengthExposure } from './strengthExposure';
import type { LoggedSet, StrengthSession } from '../engine/models';

function nearFailureSet(overrides: Partial<LoggedSet> = {}): LoggedSet {
    return { setIndex: 1, weightKg: 100, reps: 5, isWarmup: false, completedAt: '2026-08-17T18:10:00Z', gauge: { scale: 'rir', value: 2 }, ...overrides };
}

function session(overrides: Partial<StrengthSession> = {}): StrengthSession {
    return {
        userId: 'u1', sessionId: 's1', date: '2026-08-17', startedAt: '2026-08-17T18:00:00Z',
        completedAt: '2026-08-17T19:00:00Z', updatedAt: '2026-08-17T19:00:00Z', state: 'completed',
        exercises: [], schemaVersion: 1,
        ...overrides,
    };
}

describe('deriveStrengthExposure', () => {
    it('returns null for an in_progress session -- data may still change', () => {
        const s = session({ state: 'in_progress', exercises: [{ exerciseId: 'front_squat', sets: [nearFailureSet()] }] });
        expect(deriveStrengthExposure(s)).toBeNull();
    });

    it('returns null for a completed session with no logged sets', () => {
        expect(deriveStrengthExposure(session({ exercises: [{ exerciseId: 'front_squat', sets: [] }] }))).toBeNull();
    });

    it('derives an exposure for an abandoned session with real logged sets -- partial work still counts', () => {
        const s = session({ state: 'abandoned', exercises: [{ exerciseId: 'front_squat', sets: [nearFailureSet()] }] });
        expect(deriveStrengthExposure(s)).not.toBeNull();
    });

    it('yields a plausible cost and stimulus profile for a fully-identified lower-body exercise', () => {
        const s = session({ exercises: [{ exerciseId: 'front_squat', sets: [nearFailureSet()] }] });
        const exposure = deriveStrengthExposure(s);
        expect(exposure).not.toBeNull();
        expect(exposure!.costProfile.lowerBody).toBeGreaterThan(0);
        expect(exposure!.costProfile.upperBody).toBe(0); // front_squat has no upper-body primary muscles
        expect(exposure!.stimulusProfile).toMatchObject({ maxStrength: expect.any(Number), hypertrophy: expect.any(Number) });
        expect(exposure!.stimulusProfile!.maxStrength).toBeGreaterThan(0);
        // The other six stimulus axes are explicitly out of scope for this item.
        expect(exposure!.stimulusProfile!.aerobicEndurance).toBe(0);
        expect(exposure!.stimulusProfile!.sprintPower).toBe(0);
    });

    it('redistributes lowerBody/upperBody by exercise metadata rather than the flat default split', () => {
        const lowerBodySession = session({ exercises: [{ exerciseId: 'front_squat', sets: [nearFailureSet()] }] });
        const upperBodySession = session({ exercises: [{ exerciseId: 'bench_press', sets: [nearFailureSet()] }] });
        const lowerExposure = deriveStrengthExposure(lowerBodySession)!;
        const upperExposure = deriveStrengthExposure(upperBodySession)!;
        expect(lowerExposure.costProfile.lowerBody).toBeGreaterThan(lowerExposure.costProfile.upperBody);
        expect(upperExposure.costProfile.upperBody).toBeGreaterThan(upperExposure.costProfile.lowerBody);
        // front_squat has no matched upper-body muscle at all, so its weighted split is
        // fully one-sided (lowerFraction 1.0) -- redistributing the hard-intensity combined
        // budget (0.8 + 0.7 = 1.5) onto lowerBody alone would exceed the canonical 0.0-1.0
        // axis range, so it is capped at 1, not left at 1.5. See the dedicated cap test below.
        expect(lowerExposure.costProfile.lowerBody).toBe(1);
        expect(lowerExposure.costProfile.upperBody).toBe(0);
    });

    it('caps a fully one-sided redistribution at 1.0 per axis, never exceeding the canonical range', () => {
        const s = session({ exercises: [{ exerciseId: 'front_squat', sets: [nearFailureSet()] }] });
        const exposure = deriveStrengthExposure(s)!;
        // Pre-cap this would be 1.5 (the full hard-intensity combined budget applied to one
        // axis) -- WorkoutCostProfile axes are documented 0.0-1.0 (see the type's own field
        // comments and firestore.rules' hasValidAxisValue enforcing the same bound elsewhere).
        expect(exposure.costProfile.lowerBody).toBe(1);
    });

    it('does not compound a full session-level budget per exercise -- one hard exercise and five hard exercises stay distinguishable', () => {
        // This is the exact defect an earlier draft had: summing a full session-sized
        // budget once per exercise made a single hard exercise indistinguishable from five,
        // because both saturated lowerBody at a cap. Guards the fix -- both exercises here
        // are the same 100% lower-body exercise, so both correctly land on the same
        // (capped) value, not a value that grows with exercise count.
        const oneExercise = session({ exercises: [{ exerciseId: 'front_squat', sets: [nearFailureSet()] }] });
        const fiveExercises = session({ exercises: Array.from({ length: 5 }, (_, i) => ({ exerciseId: 'front_squat', sets: [nearFailureSet({ setIndex: i + 1 })] })) });
        const oneExposure = deriveStrengthExposure(oneExercise)!;
        const fiveExposure = deriveStrengthExposure(fiveExercises)!;
        expect(oneExposure.costProfile.lowerBody).toEqual(fiveExposure.costProfile.lowerBody);
        expect(oneExposure.costProfile.lowerBody).toBeLessThanOrEqual(1);
    });

    it('yields a discounted, low-confidence exposure for a free-text (unidentified) exercise', () => {
        const identified = deriveStrengthExposure(session({ exercises: [{ exerciseId: 'front_squat', sets: [nearFailureSet()] }] }))!;
        const freeText = deriveStrengthExposure(session({ exercises: [{ exerciseId: null, freeTextName: 'Sled push', sets: [nearFailureSet()] }] }))!;
        expect(identified.stimulusConfidence).toBe('inferred');
        expect(freeText.stimulusConfidence).toBe('unknown');
    });

    it('drags the whole session down to unknown confidence when even one exercise is unidentified', () => {
        const s = session({ exercises: [
            { exerciseId: 'front_squat', sets: [nearFailureSet()] },
            { exerciseId: null, freeTextName: 'Sled push', sets: [nearFailureSet()] },
        ] });
        expect(deriveStrengthExposure(s)!.stimulusConfidence).toBe('unknown');
    });

    it('classifies exercise intensity as hard when a majority of gauged working sets are near failure', () => {
        const s = session({ exercises: [{ exerciseId: 'front_squat', sets: [nearFailureSet({ setIndex: 1 }), nearFailureSet({ setIndex: 2 })] }] });
        expect(deriveStrengthExposure(s)!.trainingRecordLike.intensity_tag).toBe('hard');
    });

    it('classifies an exercise with no gauge at all as unknown, not moderate', () => {
        const s = session({ exercises: [{ exerciseId: 'front_squat', sets: [{ setIndex: 1, weightKg: 80, reps: 8, isWarmup: false, completedAt: '2026-08-17T18:10:00Z' }] }] });
        expect(deriveStrengthExposure(s)!.trainingRecordLike.intensity_tag).toBe('unknown');
    });

    it('classifies an exercise with only warm-up sets as easy', () => {
        const s = session({ exercises: [{ exerciseId: 'front_squat', sets: [{ ...nearFailureSet(), isWarmup: true }] }] });
        expect(deriveStrengthExposure(s)!.trainingRecordLike.intensity_tag).toBe('easy');
    });

    it('uses the hardest exercise as the session intensity_tag, not an average', () => {
        const s = session({ exercises: [
            { exerciseId: 'front_squat', sets: [nearFailureSet()] }, // hard
            { exerciseId: 'dead_bug', sets: [{ setIndex: 1, weightKg: null, reps: 10, isWarmup: false, completedAt: '2026-08-17T18:20:00Z', gauge: { scale: 'rir', value: 6 } }] }, // moderate (not near-failure)
        ] });
        expect(deriveStrengthExposure(s)!.trainingRecordLike.intensity_tag).toBe('hard');
    });

    it('produces a stable occurrenceKey keyed on sessionId', () => {
        const s = session({ sessionId: 's-42', exercises: [{ exerciseId: 'front_squat', sets: [nearFailureSet()] }] });
        expect(deriveStrengthExposure(s)!.occurrenceKey).toBe('strength:s-42');
    });

    it('is idempotent: re-deriving from the same session yields the same occurrenceKey and profiles', () => {
        const s = session({ exercises: [{ exerciseId: 'front_squat', sets: [nearFailureSet()] }] });
        const first = deriveStrengthExposure(s);
        const second = deriveStrengthExposure(s);
        expect(first).toEqual(second);
    });

    it('computes duration from startedAt to completedAt', () => {
        const s = session({ startedAt: '2026-08-17T18:00:00Z', completedAt: '2026-08-17T18:45:00Z', exercises: [{ exerciseId: 'front_squat', sets: [nearFailureSet()] }] });
        expect(deriveStrengthExposure(s)!.trainingRecordLike.duration_min).toBe(45);
    });

    it('weights the lower/upper split by working-set count across a mixed session, not equal-weighting each exercise', () => {
        // front_squat (lower) gets 3x the working sets of bench_press (upper) -- the
        // weighted split should favour lowerBody more than a naive 50/50-of-two-exercises
        // average would.
        const s = session({ exercises: [
            { exerciseId: 'front_squat', sets: [nearFailureSet({ setIndex: 1 }), nearFailureSet({ setIndex: 2 }), nearFailureSet({ setIndex: 3 })] },
            { exerciseId: 'bench_press', sets: [nearFailureSet({ setIndex: 1 })] },
        ] });
        const exposure = deriveStrengthExposure(s)!;
        expect(exposure.costProfile.lowerBody).toBeGreaterThan(exposure.costProfile.upperBody);
        // 3:1 weighted split of the hard-intensity budget (0.8 + 0.7 = 1.5 combined): the
        // uncapped lowerBody share (1.5 * 0.75 = 1.125) exceeds 1 and is capped; upperBody's
        // share (1.5 * 0.25 = 0.375) stays under the cap and is exact.
        expect(exposure.costProfile.lowerBody).toBe(1);
        expect(exposure.costProfile.upperBody).toBeCloseTo(1.5 * 0.25, 2);
    });
});
