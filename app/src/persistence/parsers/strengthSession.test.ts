import { describe, expect, it } from 'vitest';
import { parseStrengthSession } from './strengthSession';

const validSet = {
    setIndex: 1, weightKg: 80, reps: 3, isWarmup: false,
    completedAt: '2026-08-17T18:02:00Z', gauge: { scale: 'rir', value: 3 },
};

const session = {
    userId: 'u1', sessionId: 's-1', date: '2026-08-17', startedAt: '2026-08-17T18:00:00Z',
    updatedAt: '2026-08-17T18:05:00Z', state: 'in_progress', schemaVersion: 1,
    exercises: [{ exerciseId: 'hang_power_clean', sets: [validSet] }],
};

describe('parseStrengthSession', () => {
    it('accepts a well-formed session', () => {
        const parsed = parseStrengthSession(session, 'users/u1/strength_sessions/s-1', 's-1', 'u1');
        expect(parsed).toMatchObject({
            status: 'AVAILABLE',
            data: { sessionId: 's-1', state: 'in_progress', exercises: [{ exerciseId: 'hang_power_clean', sets: [{ reps: 3, weightKg: 80 }] }] },
        });
    });

    it('rejects a missing sessionId instead of weakening the rules path binding', () => {
        const rest: Record<string, unknown> = { ...session };
        delete rest.sessionId;
        const parsed = parseStrengthSession(rest, 'users/u1/strength_sessions/s-1', 's-1', 'u1');
        expect(parsed).toMatchObject({ status: 'INVALID', issues: [{ code: 'session-id-mismatch', field: 'sessionId' }] });
    });

    it('rejects a stored sessionId that disagrees with the document path', () => {
        const parsed = parseStrengthSession({ ...session, sessionId: 'other' }, 'p', 's-1', 'u1');
        expect(parsed).toMatchObject({ status: 'INVALID', issues: [{ code: 'session-id-mismatch', field: 'sessionId' }] });
    });

    it('rejects a document whose stored userId does not match the expected owner', () => {
        const parsed = parseStrengthSession(session, 'p', 's-1', 'someone-else');
        expect(parsed).toMatchObject({ status: 'INVALID', issues: [{ code: 'user-id-mismatch', field: 'userId' }] });
    });

    it('rejects a non-object payload', () => {
        expect(parseStrengthSession('nope', 'p', 's-1', 'u1')).toMatchObject({ status: 'INVALID', issues: [{ code: 'not-an-object' }] });
    });

    it('rejects an unsupported schema version', () => {
        const parsed = parseStrengthSession({ ...session, schemaVersion: 2 }, 'p', 's-1', 'u1');
        expect(parsed).toMatchObject({ status: 'INVALID', issues: [{ code: 'unsupported-schema-version', schemaVersion: 2, field: 'schemaVersion' }] });
    });

    it('rejects a malformed calendar date instead of normalizing it', () => {
        const parsed = parseStrengthSession({ ...session, date: '2026-02-30' }, 'p', 's-1', 'u1');
        expect(parsed).toMatchObject({ status: 'INVALID', issues: [{ code: 'invalid-date', field: 'date' }] });
    });

    it('rejects a session with no startedAt instant', () => {
        const parsed = parseStrengthSession({ ...session, startedAt: 'not-a-timestamp' }, 'p', 's-1', 'u1');
        expect(parsed).toMatchObject({ status: 'INVALID', issues: [{ code: 'invalid-type', field: 'startedAt' }] });
    });

    it('rejects a valid date that is not the Warsaw-local date of startedAt', () => {
        const parsed = parseStrengthSession({
            ...session,
            date: '2026-08-17',
            startedAt: '2026-08-17T23:30:00Z',
            updatedAt: '2026-08-17T23:35:00Z',
        }, 'p', 's-1', 'u1');
        expect(parsed).toMatchObject({ status: 'INVALID', issues: [{ code: 'date-start-mismatch', field: 'date' }] });
    });

    it('rejects an unrecognised state', () => {
        const parsed = parseStrengthSession({ ...session, state: 'paused' }, 'p', 's-1', 'u1');
        expect(parsed).toMatchObject({ status: 'INVALID', issues: [{ code: 'invalid-type', field: 'state' }] });
    });

    it('rejects a non-array exercises field', () => {
        const parsed = parseStrengthSession({ ...session, exercises: 'none' }, 'p', 's-1', 'u1');
        expect(parsed).toMatchObject({ status: 'INVALID', issues: [{ code: 'invalid-type', field: 'exercises' }] });
    });

    it('drops a malformed set but keeps the rest of the session AVAILABLE (D-SETLOG)', () => {
        const corruptSet = { setIndex: 'two', reps: 3, isWarmup: false, completedAt: '2026-08-17T18:04:00Z' };
        const parsed = parseStrengthSession({
            ...session,
            exercises: [{ exerciseId: 'hang_power_clean', sets: [validSet, corruptSet] }],
        }, 'p', 's-1', 'u1');
        expect(parsed).toMatchObject({ status: 'AVAILABLE', data: { exercises: [{ sets: [{ setIndex: 1 }] }] } });
    });

    it('drops a malformed exercise but keeps the rest of the session AVAILABLE', () => {
        const parsed = parseStrengthSession({
            ...session,
            exercises: [{ exerciseId: 'hang_power_clean', sets: [validSet] }, { exerciseId: 42, sets: [] }],
        }, 'p', 's-1', 'u1');
        expect(parsed).toMatchObject({ status: 'AVAILABLE', data: { exercises: [{ exerciseId: 'hang_power_clean' }] } });
    });

    it('accepts explicit null weightKg as bodyweight', () => {
        const parsed = parseStrengthSession({
            ...session,
            exercises: [{ exerciseId: 'pull_up', sets: [{ ...validSet, weightKg: null, gauge: undefined }] }],
        }, 'p', 's-1', 'u1');
        expect(parsed).toMatchObject({ status: 'AVAILABLE', data: { exercises: [{ sets: [{ weightKg: null }] }] } });
    });

    it('drops a set with a corrupt (non-null, non-numeric) weight rather than coercing it to bodyweight', () => {
        const parsed = parseStrengthSession({
            ...session,
            exercises: [{ exerciseId: 'pull_up', sets: [{ ...validSet, weightKg: 'eighty' }] }],
        }, 'p', 's-1', 'u1');
        expect(parsed).toMatchObject({ status: 'AVAILABLE', data: { exercises: [{ sets: [] }] } });
    });

    it('requires completedAt exactly for completed sessions', () => {
        expect(parseStrengthSession({ ...session, state: 'completed' }, 'p', 's-1', 'u1'))
            .toMatchObject({ status: 'INVALID', issues: [{ code: 'invalid-lifecycle', field: 'completedAt' }] });
        expect(parseStrengthSession({ ...session, completedAt: '2026-08-17T19:00:00Z' }, 'p', 's-1', 'u1'))
            .toMatchObject({ status: 'INVALID', issues: [{ code: 'invalid-lifecycle', field: 'completedAt' }] });
    });

    it('rejects lifecycle timestamps that run backwards', () => {
        expect(parseStrengthSession({ ...session, updatedAt: '2026-08-17T17:00:00Z' }, 'p', 's-1', 'u1'))
            .toMatchObject({ status: 'INVALID', issues: [{ code: 'invalid-order', field: 'updatedAt' }] });
        expect(parseStrengthSession({
            ...session,
            state: 'completed',
            completedAt: '2026-08-17T19:00:00Z',
            updatedAt: '2026-08-17T18:30:00Z',
        }, 'p', 's-1', 'u1')).toMatchObject({ status: 'INVALID', issues: [{ code: 'invalid-order', field: 'completedAt' }] });
    });

    it('drops fractional/out-of-range reps and weights at the persistence boundary', () => {
        const parsed = parseStrengthSession({
            ...session,
            exercises: [{
                exerciseId: 'pull_up',
                sets: [
                    { ...validSet, setIndex: 1.5 },
                    { ...validSet, setIndex: 2, reps: 1001 },
                    { ...validSet, setIndex: 3, weightKg: 1001 },
                ],
            }],
        }, 'p', 's-1', 'u1');
        expect(parsed).toMatchObject({ status: 'AVAILABLE', data: { exercises: [{ sets: [] }] } });
    });

    it('keeps only the first set when corrupt data repeats a set index', () => {
        const parsed = parseStrengthSession({
            ...session,
            exercises: [{ exerciseId: 'pull_up', sets: [validSet, { ...validSet, reps: 99 }] }],
        }, 'p', 's-1', 'u1');
        expect(parsed).toMatchObject({ status: 'AVAILABLE', data: { exercises: [{ sets: [{ reps: 3 }] }] } });
    });

    it('degrades out-of-range gauge values to absent', () => {
        for (const gauge of [
            { scale: 'rir', value: -1 },
            { scale: 'rpe_rts', value: 11 },
            { scale: 'velocity_loss', percent: 101 },
        ]) {
            const parsed = parseStrengthSession({
                ...session,
                exercises: [{ exerciseId: 'hang_power_clean', sets: [{ ...validSet, gauge }] }],
            }, 'p', 's-1', 'u1');
            const data = parsed.status === 'AVAILABLE' ? parsed.data : undefined;
            expect(data?.exercises[0]?.sets[0]?.gauge).toBeUndefined();
        }
    });

    it('degrades a malformed gauge to absent without dropping the set', () => {
        const parsed = parseStrengthSession({
            ...session,
            exercises: [{ exerciseId: 'hang_power_clean', sets: [{ ...validSet, gauge: { scale: 'rir', value: 'a lot' } }] }],
        }, 'p', 's-1', 'u1');
        expect(parsed).toMatchObject({ status: 'AVAILABLE', data: { exercises: [{ sets: [{ setIndex: 1 }] }] } });
        const parsedData = parsed.status === 'AVAILABLE' ? parsed.data : undefined;
        expect(parsedData?.exercises[0]?.sets[0]?.gauge).toBeUndefined();
    });

    it('accepts each intensity gauge scale, tagged and unconverted', () => {
        const scales = [
            { scale: 'rir', value: 2 },
            { scale: 'rpe_rts', value: 8 },
            { scale: 'velocity_loss', percent: 15 },
            { scale: 'technical', met: true },
        ] as const;
        for (const gauge of scales) {
            const parsed = parseStrengthSession({
                ...session,
                exercises: [{ exerciseId: 'hang_power_clean', sets: [{ ...validSet, gauge }] }],
            }, 'p', 's-1', 'u1');
            expect(parsed.status).toBe('AVAILABLE');
            const data = parsed.status === 'AVAILABLE' ? parsed.data : undefined;
            expect(data?.exercises[0]?.sets[0]?.gauge).toEqual(gauge);
        }
    });

    it('never treats rir and rpe_rts as interchangeable at parse time', () => {
        const parsed = parseStrengthSession({
            ...session,
            exercises: [{ exerciseId: 'hang_power_clean', sets: [{ ...validSet, gauge: { scale: 'rpe_rts', value: 8 } }] }],
        }, 'p', 's-1', 'u1');
        const data = parsed.status === 'AVAILABLE' ? parsed.data : undefined;
        expect(data?.exercises[0]?.sets[0]?.gauge).toEqual({ scale: 'rpe_rts', value: 8 });
    });

    it('accepts a null exerciseId (free-text lift) without requiring freeTextName', () => {
        const parsed = parseStrengthSession({
            ...session,
            exercises: [{ exerciseId: null, sets: [validSet] }],
        }, 'p', 's-1', 'u1');
        expect(parsed).toMatchObject({ status: 'AVAILABLE', data: { exercises: [{ exerciseId: null }] } });
    });

    it('ignores unrecognised top-level keys', () => {
        const parsed = parseStrengthSession({ ...session, somethingFuture: true }, 'p', 's-1', 'u1');
        expect(parsed.status).toBe('AVAILABLE');
    });

    it('rejects session RPE outside the Borg CR-10 range rather than clamping it', () => {
        const parsed = parseStrengthSession({ ...session, sessionRpe: 15 }, 'p', 's-1', 'u1');
        const data = parsed.status === 'AVAILABLE' ? parsed.data : undefined;
        expect(data?.sessionRpe).toBeUndefined();
    });

    it('uses updatedAt as the read-layer revision', () => {
        const parsed = parseStrengthSession(session, 'p', 's-1', 'u1');
        expect(parsed).toMatchObject({ revision: '2026-08-17T18:05:00Z' });
    });
});
